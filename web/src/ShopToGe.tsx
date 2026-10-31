import { useEffect, useMemo, useState } from "react";
import type { Opportunity, Ranking, SellMode } from "../../src/types";
import {
  DEFAULT_MAX_WORLDS,
  DEFAULT_SECONDS_PER_TILE,
  planWithBudget,
  type BudgetPlan,
} from "../../src/domain/budget";
import { wikiUrl } from "../../src/util/wiki";
import { AccessBadge } from "./AccessBadge";
import { accessFor } from "./access";
import { compact, formatGp, formatSourceDateTime, formatTime } from "./format";
import { sellableAcrossWorlds, toShopRow } from "./opportunity";
import { ShopBasketPanel } from "./ShopBasket";
import {
  browserStore,
  readStoredBudget,
  writeStoredBudget,
  type BudgetState,
  type BudgetView,
} from "./storage";
import { Stat, Th } from "./ui";
import {
  ColumnPicker,
  useColumnVisibility,
  type ColumnDef,
} from "./columns";

import payload from "../../data/opportunities.json";

/** Every column the shop -> GE table can show, with its default width. */
const SHOP_TO_GE_COLUMN_DEFS = {
  rank: { key: "rank", label: "#", width: 44 },
  item: { key: "item", label: "Item", width: 210, required: true },
  shop: { key: "shop", label: "Shop", width: 220 },
  location: { key: "location", label: "Location", width: 150 },
  unitCost: { key: "unitCost", label: "Unit cost", width: 100 },
  sellPrice: { key: "sellPrice", label: "Sell", width: 90 },
  tax: { key: "tax", label: "Tax", width: 70 },
  margin: { key: "margin", label: "Margin", width: 90 },
  volume4h: { key: "volume4h", label: "4h volume", width: 90 },
  buy: { key: "buy", label: "Buy", width: 90 },
  spend: { key: "spend", label: "Spend", width: 110 },
  worlds: { key: "worlds", label: "Worlds", width: 70 },
  banks: { key: "banks", label: "Banks", width: 150 },
  profit: { key: "profit", label: "Profit", width: 110 },
  gpPerHour: { key: "gpPerHour", label: "gp / hour", width: 110 },
  qty: { key: "qty", label: "Qty / visit", width: 90 },
  sellable: { key: "sellable", label: "Sellable", width: 90 },
  gpPer4h: { key: "gpPer4h", label: "gp / 4h", width: 110 },
} as const satisfies Record<string, ColumnDef>;

const SHOP_TO_GE_BASE: readonly ColumnDef[] = [
  SHOP_TO_GE_COLUMN_DEFS.rank,
  SHOP_TO_GE_COLUMN_DEFS.item,
  SHOP_TO_GE_COLUMN_DEFS.shop,
  SHOP_TO_GE_COLUMN_DEFS.location,
  SHOP_TO_GE_COLUMN_DEFS.unitCost,
  SHOP_TO_GE_COLUMN_DEFS.sellPrice,
  SHOP_TO_GE_COLUMN_DEFS.tax,
  SHOP_TO_GE_COLUMN_DEFS.margin,
  SHOP_TO_GE_COLUMN_DEFS.volume4h,
];

/** Union used for storage validation; the picker receives the current mode. */
const SHOP_TO_GE_ALL: readonly ColumnDef[] = [
  ...SHOP_TO_GE_BASE,
  SHOP_TO_GE_COLUMN_DEFS.buy,
  SHOP_TO_GE_COLUMN_DEFS.spend,
  SHOP_TO_GE_COLUMN_DEFS.worlds,
  SHOP_TO_GE_COLUMN_DEFS.banks,
  SHOP_TO_GE_COLUMN_DEFS.profit,
  SHOP_TO_GE_COLUMN_DEFS.qty,
  SHOP_TO_GE_COLUMN_DEFS.sellable,
  SHOP_TO_GE_COLUMN_DEFS.gpPer4h,
  SHOP_TO_GE_COLUMN_DEFS.gpPerHour,
];

function columnsForMode(budgetMode: boolean): readonly ColumnDef[] {
  return budgetMode
    ? [
        ...SHOP_TO_GE_BASE,
        SHOP_TO_GE_COLUMN_DEFS.buy,
        SHOP_TO_GE_COLUMN_DEFS.spend,
        SHOP_TO_GE_COLUMN_DEFS.worlds,
        SHOP_TO_GE_COLUMN_DEFS.banks,
        SHOP_TO_GE_COLUMN_DEFS.profit,
        SHOP_TO_GE_COLUMN_DEFS.gpPerHour,
      ]
    : [
        ...SHOP_TO_GE_BASE,
        SHOP_TO_GE_COLUMN_DEFS.qty,
        SHOP_TO_GE_COLUMN_DEFS.sellable,
        SHOP_TO_GE_COLUMN_DEFS.gpPer4h,
        SHOP_TO_GE_COLUMN_DEFS.gpPerHour,
      ];
}

type SortKey =
  | "gpPer4h"
  | "gpPerHour"
  | "margin"
  | "volume4h"
  | "avgCost"
  | "sellPrice"
  | "units"
  | "profit"
  | "spend"
  | "worlds"
  | "banks"
  | "itemName";

interface OpportunitiesPayload {
  generatedAt: string;
  pessimistic: Ranking;
  patient: Ranking;
}

interface RowData extends Opportunity {
  plan?: BudgetPlan;
}

/**
 * The bundle is a static snapshot. There are no network calls in this component,
 * by design: `pnpm build:data` produces the JSON and the browser only reads it.
 */
const DATA = payload as OpportunitiesPayload;

const MODE_LABEL: Record<SellMode, string> = {
  pessimistic: "Instant sell (GE low)",
  patient: "Patient (GE high)",
};

const BUDGET_SORTS: ReadonlySet<SortKey> = new Set<SortKey>([
  "gpPerHour",
  "profit",
  "spend",
  "worlds",
  "banks",
]);

const DEFAULT_HOP_SECONDS = 10;

export function ShopToGePage(): JSX.Element {
  const [mode, setMode] = useState<SellMode>("pessimistic");
  const [query, setQuery] = useState("");
  const [membersOnly, setMembersOnly] = useState(false);
  const [hideLocked, setHideLocked] = useState(false);
  const [minVolume, setMinVolume] = useState(0);
  const [selectedShop, setSelectedShop] = useState<string | null>(null);
  const [initialBudget] = useState<BudgetState>(() =>
    readStoredBudget(browserStore()),
  );
  const [gold, setGold] = useState(initialBudget.gold);
  const [view, setView] = useState<BudgetView>(initialBudget.view);
  const [hopSeconds, setHopSeconds] = useState(DEFAULT_HOP_SECONDS);
  const [maxWorlds, setMaxWorlds] = useState(DEFAULT_MAX_WORLDS);
  const [secondsPerTile, setSecondsPerTile] = useState(
    DEFAULT_SECONDS_PER_TILE,
  );
  const [sortKey, setSortKey] = useState<SortKey>("gpPerHour");
  const [descending, setDescending] = useState(true);
  const {
    visible,
    toggle: toggleColumn,
    reset: resetColumns,
  } = useColumnVisibility("shop-to-ge", SHOP_TO_GE_ALL);

  const ranking = DATA[mode];
  const budgetMode = gold > 0 && view === "budget";
  const currentColumns = columnsForMode(budgetMode);

  useEffect(() => {
    writeStoredBudget({ gold, view }, browserStore());
  }, [gold, view]);

  const rows = useMemo<RowData[]>(() => {
    const needle = query.trim().toLowerCase();

    const filtered = ranking.opportunities.filter((opp) => {
      if (membersOnly && !opp.members) return false;
      if (hideLocked && accessFor(opp.shopPage) !== undefined) return false;
      if (opp.sellablePer4h < minVolume) return false;
      if (needle === "") return true;
      return (
        opp.itemName.toLowerCase().includes(needle) ||
        opp.shopName.toLowerCase().includes(needle) ||
        (opp.location ?? "").toLowerCase().includes(needle)
      );
    });

    const withPlans: RowData[] =
      gold > 0
        ? filtered.map((opp) => ({
            ...opp,
            // Cap by the GE's 4h throughput across worlds: without a cap the
            // planner will happily recommend buying an illiquid item whose GE
            // "price" is a stale trade, yielding fantasy gp/hour.
            plan: planWithBudget(toShopRow(opp), opp.netSellPerUnit, gold, {
              hopSeconds,
              maxWorlds,
              bankTiles: opp.bankTiles,
              secondsPerTile,
              stackable: opp.stackable,
              maxUnits: sellableAcrossWorlds(opp),
            }),
          }))
        : filtered;

    const key =
      budgetMode || !BUDGET_SORTS.has(sortKey) ? sortKey : "gpPerHour";
    const measure = (row: RowData): number | null => {
      switch (key) {
        case "gpPerHour":
          return row.plan?.gpPerHour ?? null;
        case "profit":
          return row.plan?.profit ?? 0;
        case "spend":
          return row.plan?.totalCost ?? 0;
        case "worlds":
          return row.plan?.worlds ?? 0;
        case "banks":
          return row.plan?.bankTrips ?? 0;
        case "units":
          return budgetMode ? (row.plan?.units ?? 0) : row.units;
        case "gpPer4h":
          return row.gpPer4h;
        case "margin":
          return row.margin;
        case "volume4h":
          return row.volume4h;
        case "avgCost":
          return budgetMode
            ? row.plan !== undefined && row.plan.units > 0
              ? row.plan.avgCost
              : null
            : row.avgCost;
        case "sellPrice":
          return row.sellPrice;
        case "itemName":
          return 0;
        default:
          return 0;
      }
    };

    return [...withPlans].sort((a, b) => {
      if (key === "itemName") {
        return descending
          ? b.itemName.localeCompare(a.itemName)
          : a.itemName.localeCompare(b.itemName);
      }
      const aValue = measure(a);
      const bValue = measure(b);
      if (aValue === null || bValue === null) {
        if (aValue === bValue) return 0;
        // An unknown bank time is never better than a known one, whichever way
        // the column is sorted.
        return aValue === null ? 1 : -1;
      }
      const delta = bValue - aValue;
      return descending ? delta : -delta;
    });
  }, [
    ranking,
    query,
    membersOnly,
    hideLocked,
    minVolume,
    budgetMode,
    gold,
    hopSeconds,
    maxWorlds,
    secondsPerTile,
    sortKey,
    descending,
  ]);

  const bestPlanRow = rows.reduce<RowData | undefined>((best, row) => {
    const gp = row.plan?.gpPerHour;
    if (gp == null) return best;
    if (best === undefined) return row;
    return gp > (best.plan?.gpPerHour ?? Number.NEGATIVE_INFINITY)
      ? row
      : best;
  }, undefined);
  const bestSummary = budgetPlanSummary(bestPlanRow);

  const bestGp4hRow = rows.reduce<RowData | undefined>((best, row) => {
    if (best === undefined || row.gpPer4h > best.gpPer4h) return row;
    return best;
  }, undefined);

  const medianMargin =
    rows.length > 0
      ? ([...rows].map((r) => r.margin).sort((a, b) => a - b)[
          Math.floor(rows.length / 2)
        ] ?? 0)
      : null;

  const shopCount = new Set(rows.map((row) => row.shopPage)).size;

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  return (
    <div className="page">
      <div className="pagebar">
        <div className="asof">
          <span className="label">GE prices as of</span>
          <strong title={formatSourceDateTime(ranking.pricesAsOf)}>
            {formatTime(ranking.pricesAsOf)}
          </strong>
          <span
            className="label"
            title={formatSourceDateTime(DATA.generatedAt)}
          >
            built {formatTime(DATA.generatedAt)}
          </span>
        </div>
      </div>

      <section className="controls">
        <div className="modes" role="group" aria-label="Sell mode">
          {(["pessimistic", "patient"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? "mode active" : "mode"}
              onClick={() => setMode(m)}
              aria-pressed={m === mode}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <input
          className="search"
          type="search"
          placeholder="Filter by item, shop or location…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter"
        />

        <label className="toggle">
          <input
            type="checkbox"
            checked={membersOnly}
            onChange={(event) => setMembersOnly(event.target.checked)}
          />
          Members only
        </label>

        <label
          className="toggle"
          title="Hide shops with a known access requirement from the curated, wiki-sourced access table"
        >
          <input
            type="checkbox"
            checked={hideLocked}
            onChange={(event) => setHideLocked(event.target.checked)}
          />
          Hide locked
        </label>

        <label
          className="toggle"
          title="One shop visit's units, capped by 24h traded volume"
        >
          Min sellable
          <input
            className="num"
            type="number"
            min={0}
            step={1}
            value={minVolume}
            onChange={(event) => setMinVolume(Number(event.target.value) || 0)}
            aria-label="Minimum sellable units per shop visit"
          />
        </label>

        <ColumnPicker
          columns={currentColumns}
          visible={visible}
          onToggle={toggleColumn}
          onReset={resetColumns}
        />
      </section>

      <section className="controls budget">
        <div className="budget-inputs">
          <div className="gold-compartment">
            <label className="toggle">
              <span className="label">Gold available</span>
              <span className="field-control">
                <input
                  className="num wide"
                  type="number"
                  min={0}
                  step={100_000}
                  value={gold}
                  onChange={(event) =>
                    setGold(Math.max(0, Number(event.target.value) || 0))
                  }
                  aria-label="Gold available"
                />
                <span className="field-unit">gp</span>
              </span>
            </label>

            <div className="presets">
              {[100_000, 1_000_000, 10_000_000, 100_000_000].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={gold === amount ? "preset active" : "preset"}
                  onClick={() => setGold(amount)}
                >
                  {compact(amount)}
                </button>
              ))}
              <button type="button" className="preset" onClick={() => setGold(0)}>
                Clear
              </button>
            </div>
          </div>

          <label
            className="toggle inline"
            title="Show the gold-sized Buy, Spend, Worlds, Banks and Profit columns."
          >
            <input
              type="checkbox"
              checked={budgetMode}
              disabled={gold <= 0}
              onChange={(event) =>
                setView(event.target.checked ? "budget" : "shop")
              }
            />
            Size buys to gold
          </label>

          <label className="toggle">
            <span className="label">World hop</span>
            <span className="field-control">
              <input
                className="num"
                type="number"
                min={0}
                step={1}
                value={hopSeconds}
                onChange={(event) =>
                  setHopSeconds(Math.max(0, Number(event.target.value) || 0))
                }
                aria-label="World hop time in seconds"
              />
              <span className="field-unit">s</span>
            </span>
          </label>

          <label
            className="toggle"
            title="Maximum worlds you are willing to hop. The shop is assumed available on each one."
          >
            <span className="label">Max worlds</span>
            <span className="field-control">
              <input
                className="num"
                type="number"
                min={1}
                step={1}
                value={maxWorlds}
                onChange={(event) =>
                  setMaxWorlds(
                    Math.max(1, Math.floor(Number(event.target.value) || 1)),
                  )
                }
                aria-label="Maximum worlds to hop"
              />
              <span className="field-unit">worlds</span>
            </span>
          </label>

          <label className="toggle">
            <span className="label">Travel speed</span>
            <span className="field-control">
              <input
                className="num"
                type="number"
                min={0}
                step={0.05}
                value={secondsPerTile}
                onChange={(event) =>
                  setSecondsPerTile(Math.max(0, Number(event.target.value) || 0))
                }
                aria-label="Seconds per game tile"
              />
              <span className="field-unit">s / tile</span>
            </span>
          </label>
        </div>

        <p className="hint">
          {budgetMode ? (
            <>
              Sizing buys for <strong>{formatGp(gold)} gp</strong> ·{" "}
              <strong>{hopSeconds}s</strong> hop ·{" "}
              <strong>{secondsPerTile}s</strong> per tile. Each world resets to
              full default stock (up to <strong>{maxWorlds} worlds</strong>);
              stackable goods skip banking.
            </>
          ) : gold > 0 ? (
            <>
              Showing per-shop-visit quantities. <strong>gp / hour</strong> is
              sized to <strong>{formatGp(gold)} gp</strong> at{" "}
              <strong>{secondsPerTile}s</strong> per tile, up to{" "}
              <strong>{maxWorlds} worlds</strong>.
            </>
          ) : (
            <>Enter gold to size buys across world hops.</>
          )}
        </p>
      </section>

      <section className="stats">
        <Stat label="Opportunities" value={rows.length.toLocaleString()} />
        {budgetMode ? (
          <>
            <Stat
              label="Best gp / hour"
              value={
                bestSummary?.gpPerHour != null
                  ? formatGp(Math.round(bestSummary.gpPerHour))
                  : "—"
              }
              title={
                bestPlanRow
                  ? `${bestPlanRow.itemName} at ${bestPlanRow.shopName}`
                  : undefined
              }
              accent
            />
            <Stat
              label="Profit at best rate"
              value={
                bestSummary === null
                  ? "—"
                  : `${formatGp(Math.round(bestSummary.profit))} gp`
              }
              title={
                bestPlanRow
                  ? `${bestPlanRow.itemName} at ${bestPlanRow.shopName}`
                  : undefined
              }
            />
            <Stat
              label="Spend at best rate"
              value={
                bestSummary === null
                  ? "—"
                  : `${formatGp(Math.round(bestSummary.totalCost))} gp`
              }
              title={
                bestPlanRow
                  ? `${bestPlanRow.itemName} at ${bestPlanRow.shopName}`
                  : undefined
              }
            />
          </>
        ) : (
          <>
            <Stat
              label="Best gp / 4h"
              value={
                bestGp4hRow
                  ? formatGp(Math.round(bestGp4hRow.gpPer4h))
                  : "—"
              }
              title={
                bestGp4hRow
                  ? `${bestGp4hRow.itemName} at ${bestGp4hRow.shopName}`
                  : undefined
              }
              accent
            />
            <Stat
              label="Median margin"
              value={
                medianMargin === null
                  ? "—"
                  : `${formatGp(medianMargin)} gp`
              }
            />
            <Stat
              label="Shops with results"
              value={shopCount.toLocaleString()}
              title="Distinct shops in the filtered rows"
            />
          </>
        )}
      </section>

      {selectedShop !== null && (
        <ShopBasketPanel
          shopPage={selectedShop}
          opportunities={ranking.opportunities}
          mode={mode}
          gold={gold}
          hopSeconds={hopSeconds}
          maxWorlds={maxWorlds}
          secondsPerTile={secondsPerTile}
          onClose={() => setSelectedShop(null)}
        />
      )}

      <div className="tablewrap">
        <table className="results-table">
          <colgroup>
            {currentColumns.filter((column) => visible.has(column.key)).map(
              (column) => (
                <col
                  key={column.key}
                  className={
                    column.key === "rank"
                      ? "num-col"
                      : column.key === "location"
                        ? "loc-col"
                        : column.key === "tax"
                          ? "tax-col"
                          : undefined
                  }
                  style={{ width: column.width }}
                />
              ),
            )}
          </colgroup>
          <thead>
            <tr>
              {visible.has("rank") && <th className="num-col">#</th>}
              {visible.has("item") && (
                <Th
                  label="Item"
                  onClick={() => toggleSort("itemName")}
                  active={sortKey === "itemName"}
                  desc={descending}
                  title="Item name; click to sort"
                />
              )}
              {visible.has("shop") && <th>Shop</th>}
              {visible.has("location") && (
                <th className="loc-col">Location</th>
              )}
              {visible.has("unitCost") && (
                <Th
                  label="Unit cost"
                  onClick={() => toggleSort("avgCost")}
                  active={sortKey === "avgCost"}
                  desc={descending}
                  title="Average price paid per unit across the quantity you would take"
                  right
                />
              )}
              {visible.has("sellPrice") && (
                <Th
                  label="Sell"
                  onClick={() => toggleSort("sellPrice")}
                  active={sortKey === "sellPrice"}
                  desc={descending}
                  title="GE price used for this mode"
                  right
                />
              )}
              {visible.has("tax") && (
                <th className="right tax-col">Tax</th>
              )}
              {visible.has("margin") && (
                <Th
                  label="Margin"
                  onClick={() => toggleSort("margin")}
                  active={sortKey === "margin"}
                  desc={descending}
                  title="Net sell price minus average unit cost"
                  right
                />
              )}
              {visible.has("volume4h") && (
                <Th
                  label="4h volume"
                  onClick={() => toggleSort("volume4h")}
                  active={sortKey === "volume4h"}
                  desc={descending}
                  title="GE sell-side 24h volume divided by 6, floored to whole units; the 4h sale cap used by the planner"
                  right
                />
              )}

              {budgetMode ? (
                <>
                  {visible.has("buy") && (
                    <Th
                      label="Buy"
                      onClick={() => toggleSort("units")}
                      active={sortKey === "units"}
                      desc={descending}
                      title="Total units your gold covers; the smaller line is one full-stock world's quantity"
                      right
                    />
                  )}
                  {visible.has("spend") && (
                    <Th
                      label="Spend"
                      onClick={() => toggleSort("spend")}
                      active={sortKey === "spend"}
                      desc={descending}
                      title="Coins spent"
                      right
                    />
                  )}
                  {visible.has("worlds") && (
                    <Th
                      label="Worlds"
                      onClick={() => toggleSort("worlds")}
                      active={sortKey === "worlds"}
                      desc={descending}
                      title="Shop visits needed, assuming full default stock each world"
                      right
                    />
                  )}
                  {visible.has("banks") && (
                    <Th
                      label="Banks"
                      onClick={() => toggleSort("banks")}
                      active={sortKey === "banks"}
                      desc={descending}
                      title="Bank trips needed for non-stackable goods; the bank used is shown beneath"
                      right
                    />
                  )}
                  {visible.has("profit") && (
                    <Th
                      label="Profit"
                      onClick={() => toggleSort("profit")}
                      active={sortKey === "profit"}
                      desc={descending}
                      title="Net revenue minus spend"
                      right
                    />
                  )}
                  {visible.has("gpPerHour") && (
                    <Th
                      label="gp / hour"
                      onClick={() => toggleSort("gpPerHour")}
                      active={sortKey === "gpPerHour"}
                      desc={descending}
                      title="Profit per hour at your current gold, including hops and bank trips"
                      right
                    />
                  )}
                </>
              ) : (
                <>
                  {visible.has("qty") && (
                    <Th
                      label="Qty / visit"
                      onClick={() => toggleSort("units")}
                      active={sortKey === "units"}
                      desc={descending}
                      title="Units one shop visit yields before the margin closes"
                      right
                    />
                  )}
                  {visible.has("sellable") && (
                    <th
                      className="right"
                      title="One shop visit's units, capped by the 4h volume column"
                    >
                      Sellable
                    </th>
                  )}
                  {visible.has("gpPer4h") && (
                    <Th
                      label="gp / 4h"
                      onClick={() => toggleSort("gpPer4h")}
                      active={sortKey === "gpPer4h"}
                      desc={descending}
                      title="Profit from one shop visit's sellable units, not the full 4h volume. Use gp / hour for the gold-sized rate."
                      right
                    />
                  )}
                  {visible.has("gpPerHour") && (
                    <Th
                      label="gp / hour"
                      onClick={() => toggleSort("gpPerHour")}
                      active={sortKey === "gpPerHour"}
                      desc={descending}
                      title="Profit per hour at your current gold, including hops and bank trips"
                      right
                    />
                  )}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((row, index) => (
              <Row
                key={`${row.itemId}-${row.shopPage}`}
                row={row}
                rank={index + 1}
                budgetMode={budgetMode}
                onSelectShop={setSelectedShop}
                visible={visible}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="empty">No opportunities match these filters.</p>
        )}
        {rows.length > 300 && (
          <p className="empty">
            Showing the top 300 of {rows.length.toLocaleString()}.
          </p>
        )}
      </div>

      <footer className="footer">
        <details className="caveats">
          <summary>Assumptions &amp; caveats</summary>
          {budgetMode ? (
            <p>
              <strong>Buy</strong> is how many units your gold actually covers,{" "}
              <strong>Spend</strong> is what leaves your inventory,{" "}
              <strong>Worlds</strong> is how many shop visits that takes, and{" "}
              <strong>Banks</strong> is how many trips to the bank the loads need;
              the seconds beside it are that shop's own round trip, and the bank
              used is shown beneath. Each world is assumed to be at full default
              stock, so the price curve restarts every hop. The plan is capped at
              your <strong>Max worlds</strong> setting ({maxWorlds}). A backpack
              holds 28 items; coins take one slot, so a load carries 27
              non-stackable items. Distances come from the wiki map and are travelled at{" "}
              <strong>{secondsPerTile}s per tile</strong>; stackable items never
              need a bank. Where the wiki map gives no bank for a shop, gp / hour
              is shown as <strong>—</strong> rather than assuming a trip.{" "}
              <strong>gp / hour</strong> = profit ÷ max(world hops + bank trips,
              GE sell time) and excludes travel to the shop. Clicking{" "}
              <strong>basket</strong> beside a shop buys every profitable item
              there together: those world hops and bank loads are shared, so the
              basket's gp / hour is usually higher than any single row's. A{" "}
              <strong>—</strong> unit cost means there was no budget plan at
              this gold, usually because the item has no sellable 4h volume;
              the tooltip and the shop view show the per-visit cost instead.
            </p>
          ) : (
            <p>
              <strong>Unit cost</strong> is the average price across the quantity
              you would take; shop prices rise with every unit bought.{" "}
              <strong>Qty / visit</strong> is what one shop visit yields before
              the next unit stops being profitable. <strong>Sellable</strong> is
              that quantity capped by 24h traded volume; the GE buy limit is a
              per-player purchase cap and does not cap sales.{" "}
              <strong>gp / hour</strong> uses your current gold available and the
              same per-shop bank time as budget mode, capped at your{" "}
              <strong>Max worlds</strong> setting ({maxWorlds}); it shows{" "}
              <strong>—</strong> when gold is 0 or the bank distance is unknown.
              Clicking <strong>basket</strong> beside a shop buys every profitable
              item there together, sharing world hops and bank loads.
            </p>
          )}
          <p>
            <strong>4h volume</strong> is the GE's sell-side 24h volume divided
            by 6, floored to whole units; the plan's Qty and Sellable never
            exceed it. Gross margin is net of the 2% GE tax (capped at 5,000,000
            gp, items under 50 gp exempt). Shop stock is per-world in reality;
            restock times are not modelled. Items whose wiki page does not state
            stackability are treated as non-stackable, the pessimistic direction.
            Bank distances are straight-line tiles from the wiki map, not a
            walking route, so corners and obstacles add time; raise the
            seconds-per-tile value to allow for that. Your gold amount and the
            budget/shop view are saved in this browser.
          </p>
          <p>
            A <strong>locked</strong> badge marks a shop with a known access
            requirement from a curated, wiki-sourced table. Hover or open the
            badge for the requirement and its source. <strong>Hide locked</strong>{" "}
            removes only known-locked shops; a shop with no badge has unknown
            access, not guaranteed access. This is not a check of your account's
            quests or levels.
          </p>
        </details>
      </footer>
    </div>
  );
}

function budgetPlanSummary(row: RowData | undefined): BudgetPlan | null {
  return row?.plan ?? null;
}

function GpPerHourCell({
  plan,
}: {
  plan: BudgetPlan | undefined;
}): JSX.Element {
  let title: string | undefined;
  if (plan === undefined) {
    title = "Enter gold available to compute gp / hour";
  } else if (plan.gpPerHour === null) {
    title =
      "Bank distance unknown for this shop, so travel time cannot be computed";
  }

  return (
    <td className="right mono strong" title={title}>
      {plan?.gpPerHour != null ? formatGp(Math.round(plan.gpPerHour)) : "—"}
    </td>
  );
}

function Row({
  row,
  rank,
  budgetMode,
  onSelectShop,
  visible,
}: {
  row: RowData;
  rank: number;
  budgetMode: boolean;
  onSelectShop: (shopPage: string) => void;
  visible: ReadonlySet<string>;
}): JSX.Element {
  const plan = row.plan;
  return (
    <tr>
      {visible.has("rank") && <td className="num-col">{rank}</td>}
      {visible.has("item") && (
        <td className="item">
          <a
            className="name wiki-link"
            href={wikiUrl(row.itemName)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.itemName}
          </a>
          {row.members && <span className="badge">P2P</span>}
        </td>
      )}
      {visible.has("shop") && (
        <td className="shop" title={row.shopPage}>
          <a
            className="wiki-link"
            href={wikiUrl(row.shopPage)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.shopName}
          </a>
          <div className="shop-actions">
            <button
              type="button"
              className="shop-basket"
              onClick={() => onSelectShop(row.shopPage)}
              aria-label={`Open the multi-item basket for ${row.shopName}`}
              title="Buy every profitable item from this shop in the same visits"
            >
              basket
            </button>
            <AccessBadge shopPage={row.shopPage} />
          </div>
        </td>
      )}
      {visible.has("location") && (
        <td className="loc loc-col">{row.location ?? "—"}</td>
      )}
      {visible.has("unitCost") && (
        <td
          className="right mono"
          title={
            budgetMode && plan !== undefined && plan.units === 0
              ? `No budget plan (${
                  row.volume4h === 0
                    ? "no 4h GE volume"
                    : plan.marginLimited
                      ? "the shop price no longer beats the GE"
                      : plan.budgetLimited
                        ? "available gold is below one unit"
                        : "no plan at this gold"
                }). One full shop visit averages ${formatGp(
                  Math.round(row.avgCost),
                )} gp per unit.`
              : undefined
          }
        >
          {budgetMode && plan !== undefined && plan.units === 0
            ? "—"
            : formatGp(
                Math.round(
                  plan !== undefined && budgetMode ? plan.avgCost : row.avgCost,
                ),
              )}
          {budgetMode && plan !== undefined && plan.units === 0 && (
            <span className="cell-note">
              {row.volume4h === 0
                ? "no 4h volume"
                : plan.marginLimited
                  ? "no margin"
                  : plan.budgetLimited
                    ? "gold too low"
                    : "no plan"}
            </span>
          )}
        </td>
      )}
      {visible.has("sellPrice") && (
        <td className="right mono">{formatGp(row.sellPrice)}</td>
      )}
      {visible.has("tax") && (
        <td className="right mono dim tax-col">
          {formatGp(row.taxPerUnit)}
        </td>
      )}
      {visible.has("margin") && (
        <td className="right mono pos">
          {formatGp(Math.round(row.margin))}
        </td>
      )}
      {visible.has("volume4h") && (
        <td
          className={`right mono${row.volume4h === 0 ? " dim" : ""}`}
          title="GE sell-side 24h volume divided by 6, floored to whole units"
        >
          {row.volume4h.toLocaleString()}
        </td>
      )}

      {budgetMode ? (
        <>
          {visible.has("buy") && (
            <td className="right mono strong">
              {plan?.units.toLocaleString() ?? 0}
              <span className="cell-note">
                {formatGp(plan?.unitsPerWorld ?? 0)}/world
              </span>
            </td>
          )}
          {visible.has("spend") && (
            <td className="right mono">
              {formatGp(Math.round(plan?.totalCost ?? 0))}
            </td>
          )}
          {visible.has("worlds") && (
            <td className="right mono dim">{plan?.worlds ?? 0}</td>
          )}
          {visible.has("banks") && (
            <td
              className="right mono dim"
              title={
                row.bankTiles === null
                  ? "No bank distance available for this shop"
                  : `${row.nearestBank ?? "Bank"} · ${Math.round(row.bankTiles)} tiles each way`
              }
            >
              {plan?.bankTrips ?? 0}
              {(plan?.bankTrips ?? 0) > 0 && (
                <span className="dim">
                  {" · "}
                  {plan?.bankTimeKnown === false
                    ? "?"
                    : `${Math.round(plan?.bankSecondsPerTrip ?? 0)}s`}
                </span>
              )}
              {(plan?.bankTrips ?? 0) > 0 && (
                <span className="bank-loc">
                  {row.nearestBank !== null ? (
                    <a
                      className="wiki-link"
                      href={wikiUrl(row.nearestBank)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.nearestBank}
                    </a>
                  ) : (
                    "Unknown bank"
                  )}
                </span>
              )}
            </td>
          )}
          {visible.has("profit") && (
            <td className="right mono pos">
              {formatGp(Math.round(plan?.profit ?? 0))}
            </td>
          )}
          {visible.has("gpPerHour") && <GpPerHourCell plan={plan} />}
        </>
      ) : (
        <>
          {visible.has("qty") && <td className="right mono">{row.units}</td>}
          {visible.has("sellable") && (
            <td className="right mono dim">
              {row.sellablePer4h.toLocaleString()}
            </td>
          )}
          {visible.has("gpPer4h") && (
            <td className="right mono strong">
              {formatGp(Math.round(row.gpPer4h))}
            </td>
          )}
          {visible.has("gpPerHour") && <GpPerHourCell plan={plan} />}
        </>
      )}
    </tr>
  );
}
