import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_HOP_SECONDS,
  DEFAULT_MAX_WORLDS,
  DEFAULT_SECONDS_PER_TILE,
} from "../../src/domain/budget";
import {
  planShopSink,
  type ShopSinkPlan,
} from "../../src/domain/shopSink";
import type {
  SellMode,
  ShopSinkOpportunity,
  ShopSinksPayload,
} from "../../src/types";
import { wikiUrl } from "../../src/util/wiki";
import { AccessBadge } from "./AccessBadge";
import { accessFor } from "./access";
import { compact, formatDuration, formatGp, formatSourceDateTime, formatTime } from "./format";
import { toSinkShopRow } from "./opportunity";
import { SinkBasketPanel } from "./SinkBasket";
import {
  browserStore,
  readStoredBudget,
  writeStoredBudget,
  type BudgetState,
} from "./storage";
import { Stat, Th } from "./ui";
import {
  ColumnPicker,
  useColumnVisibility,
  type ColumnDef,
} from "./columns";

import payload from "../../data/shop-sinks.json";

/** Column definitions for the table and its visibility picker. */
const GE_TO_SHOP_COLUMNS: readonly ColumnDef[] = [
  { key: "rank", label: "#", width: 44 },
  { key: "item", label: "Item", width: 210, required: true },
  { key: "shop", label: "Shop", width: 220 },
  { key: "location", label: "Location", width: 150 },
  { key: "geBuy", label: "GE buy", width: 90 },
  { key: "shopPays", label: "Shop pays", width: 140 },
  { key: "margin", label: "Margin", width: 90 },
  { key: "units", label: "Qty", width: 80 },
  { key: "batch", label: "Batch", width: 70 },
  { key: "worlds", label: "Worlds", width: 90 },
  { key: "spend", label: "Spend", width: 110 },
  { key: "profit", label: "Profit", width: 110 },
  { key: "trip", label: "Trip", width: 100 },
  { key: "gpPerHour", label: "gp / hour", width: 110 },
];

type SortKey =
  | "gpPerHour"
  | "profit"
  | "spend"
  | "units"
  | "unitsPerWorld"
  | "worlds"
  | "margin"
  | "marginPct"
  | "geBuyPrice"
  | "shopAvgPrice"
  | "geTiles"
  | "itemName";

interface RowData {
  opp: ShopSinkOpportunity;
  plan: ShopSinkPlan;
}

const MODE_LABEL: Record<SellMode, string> = {
  pessimistic: "Instant buy (GE high)",
  patient: "Patient buy (GE low)",
};

/**
 * GE -> shop: buy on the Grand Exchange, sell the noted stack to a shop whose
 * stock table publishes a buy price, hopping worlds so each one resets the
 * shop's stock. The artifact supplies the eligible rows and their pricing
 * parameters; the plan is recomputed here so gold, hop time and travel speed
 * all apply. Static snapshot; no network calls.
 */
// SAFETY: `data/shop-sinks.json` is only written by `scripts/refresh-sinks.ts`,
// which validates the payload with `ShopSinksPayloadSchema` first.
const DATA = payload as unknown as ShopSinksPayload;

export function GeToShopPage(): JSX.Element {
  const [mode, setMode] = useState<SellMode>("pessimistic");
  const [query, setQuery] = useState("");
  const [membersOnly, setMembersOnly] = useState(false);
  const [hideLocked, setHideLocked] = useState(false);
  const [minProfit, setMinProfit] = useState(0);
  const [minVolume, setMinVolume] = useState(0);
  const [hopSeconds, setHopSeconds] = useState(DEFAULT_HOP_SECONDS);
  const [maxWorlds, setMaxWorlds] = useState(DEFAULT_MAX_WORLDS);
  const [secondsPerTile, setSecondsPerTile] = useState(
    DEFAULT_SECONDS_PER_TILE,
  );
  const [initialBudget] = useState<BudgetState>(() =>
    readStoredBudget(browserStore()),
  );
  const [gold, setGold] = useState(initialBudget.gold);
  const [storedView] = useState(initialBudget.view);
  const [sortKey, setSortKey] = useState<SortKey>("gpPerHour");
  const [descending, setDescending] = useState(true);
  const {
    visible,
    toggle: toggleColumn,
    reset: resetColumns,
  } = useColumnVisibility("ge-to-shop", GE_TO_SHOP_COLUMNS);
  const [selectedShop, setSelectedShop] = useState<string | null>(null);

  // The same key as the shop -> GE page: gold is shared, the view is preserved.
  useEffect(() => {
    writeStoredBudget({ gold, view: storedView }, browserStore());
  }, [gold, storedView]);

  const ranking = DATA[mode];

  const rows = useMemo<RowData[]>(() => {
    const needle = query.trim().toLowerCase();

    const planned: RowData[] = [];
    for (const opp of ranking.opportunities) {
      if (membersOnly && !opp.members) continue;
      if (hideLocked && accessFor(opp.shopPage) !== undefined) continue;
      if (opp.purchaseCap4h < minVolume) continue;
      if (needle !== "") {
        const haystack = `${opp.itemName} ${opp.shopName} ${opp.location ?? ""}`;
        if (!haystack.toLowerCase().includes(needle)) continue;
      }

      const plan = planShopSink(toSinkShopRow(opp), {
        geCostPerUnit: opp.geBuyPrice,
        purchaseCap4h: opp.purchaseCap4h,
        geTiles: opp.geTiles,
        secondsPerTile,
        hopSeconds,
        maxWorlds,
        budgetGp: gold,
        startStock: opp.baseStock ?? 0,
      });

      if (plan.units <= 0) continue;
      if (plan.profit < minProfit) continue;
      planned.push({ opp, plan });
    }

    const measure = (entry: RowData): number | null => {
      switch (sortKey) {
        case "gpPerHour":
          return entry.plan.gpPerHour;
        case "profit":
          return entry.plan.profit;
        case "spend":
          return entry.plan.totalCost;
        case "units":
          return entry.plan.units;
        case "unitsPerWorld":
          return entry.plan.unitsPerWorld;
        case "worlds":
          return entry.plan.worlds;
        case "margin":
          return entry.plan.marginPerUnit;
        case "marginPct":
          return (entry.plan.marginPerUnit / entry.opp.geBuyPrice) * 100;
        case "geBuyPrice":
          return entry.opp.geBuyPrice;
        case "shopAvgPrice":
          return entry.plan.totalRevenue / entry.plan.units;
        case "geTiles":
          return entry.plan.geTiles;
        case "itemName":
          return null;
        default:
          return null;
      }
    };

    return planned.sort((a, b) => {
      if (sortKey === "itemName") {
        return descending
          ? b.opp.itemName.localeCompare(a.opp.itemName)
          : a.opp.itemName.localeCompare(b.opp.itemName);
      }

      const aValue = measure(a);
      const bValue = measure(b);
      if (aValue === null || bValue === null) {
        if (aValue !== bValue) {
          // Unknown travel is never better than a known time, whichever way the
          // column is sorted.
          return aValue === null ? 1 : -1;
        }
      } else if (aValue !== bValue) {
        return descending ? bValue - aValue : aValue - bValue;
      }

      const byShop = a.opp.shopName.localeCompare(b.opp.shopName);
      if (byShop !== 0) return byShop;
      return a.opp.itemName.localeCompare(b.opp.itemName);
    });
  }, [
    ranking,
    query,
    membersOnly,
    hideLocked,
    minProfit,
    minVolume,
    hopSeconds,
    maxWorlds,
    secondsPerTile,
    gold,
    sortKey,
    descending,
  ]);

  if (ranking.opportunities.length === 0) {
    return (
      <div className="page">
        <p className="empty">
          {DATA.gePoint === null
            ? "The shop catalogue has no Grand Exchange location, so no flips could be priced."
            : "No GE → shop flips are profitable in this snapshot."}
        </p>
      </div>
    );
  }

  const bestRate = rows.reduce<RowData | undefined>((best, row) => {
    if (row.plan.gpPerHour === null) return best;
    if (best === undefined) return row;
    return row.plan.gpPerHour > (best.plan.gpPerHour ?? Number.NEGATIVE_INFINITY)
      ? row
      : best;
  }, undefined);

  const bestProfit = rows.reduce<RowData | undefined>(
    (best, row) =>
      best === undefined || row.plan.profit > best.plan.profit ? row : best,
    undefined,
  );

  const shopCount = new Set(rows.map((entry) => entry.opp.shopPage)).size;

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  return (
    <div className="page">
      <section className="toolbar" aria-label="Filters">
        <div className="toolbar-row">
          <div className="modes" role="group" aria-label="Buy mode">
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

        <div className="toolbar-row chips">
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
            title="Minimum total profit for the planned sale"
          >
            Min profit
            <input
              className="num"
              type="number"
              min={0}
              step={1000}
              value={minProfit}
              onChange={(event) => setMinProfit(Number(event.target.value) || 0)}
              aria-label="Minimum total profit"
            />
          </label>

          <label
            className="toggle"
            title="Minimum units the GE can supply in a 4h window (buy limit and 24h volume)"
          >
            Min 4h supply
            <input
              className="num"
              type="number"
              min={0}
              step={10}
              value={minVolume}
              onChange={(event) => setMinVolume(Number(event.target.value) || 0)}
              aria-label="Minimum purchasable units per 4 hours"
            />
          </label>

          <span className="toolbar-spacer" />

          <ColumnPicker
            columns={GE_TO_SHOP_COLUMNS}
            visible={visible}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
        </div>
      </section>

      <section className="toolbar budget">
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
          Buy on the GE at{" "}
          <strong>{mode === "pessimistic" ? "high" : "low"}</strong> and sell to
          a shop that publishes a buy price. <strong>General stores are excluded</strong>{" "}
          for now. Items are collected as <strong>banknotes</strong>, so there is
          no banking: one GE↔shop trip plus <strong>{hopSeconds}s</strong> per
          world hop (up to <strong>{maxWorlds} worlds</strong>), with travel at{" "}
          <strong>{secondsPerTile}s</strong> per tile. The shop is assumed
          available on every world you visit.
          The shop's offer falls by its <strong>delta%</strong> for every unit
          sold, which caps the batch on each world.{" "}
          {gold > 0 ? (
            <>
              Sizing plans to <strong>{formatGp(gold)} gp</strong>; clear to 0
              for the uncapped plan.
            </>
          ) : (
            <>Showing the uncapped plan; enter gold to size it.</>
          )}
        </p>
      </section>

      <section className="stats">
        <Stat label="Flips" value={rows.length.toLocaleString()} />
        <Stat
          label="Best gp / hour"
          value={
            bestRate?.plan.gpPerHour != null
              ? formatGp(Math.round(bestRate.plan.gpPerHour))
              : "—"
          }
          title={
            bestRate
              ? `${bestRate.opp.itemName} at ${bestRate.opp.shopName}`
              : "No flip has a known Grand Exchange distance"
          }
          accent
        />
        <Stat
          label="Best profit"
          value={
            bestProfit === undefined
              ? "—"
              : `${formatGp(Math.round(bestProfit.plan.profit))} gp`
          }
          title={
            bestProfit
              ? `${bestProfit.opp.itemName} at ${bestProfit.opp.shopName}`
              : undefined
          }
        />
        <Stat
          label="Shops with results"
          value={shopCount.toLocaleString()}
          title="Distinct shops in the filtered rows"
        />
      </section>

      {selectedShop !== null && (
        <SinkBasketPanel
          shopPage={selectedShop}
          opportunities={ranking.opportunities}
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
            {GE_TO_SHOP_COLUMNS.filter((column) =>
              visible.has(column.key),
            ).map((column) => (
              <col
                key={column.key}
                className={
                  column.key === "rank"
                    ? "num-col"
                    : column.key === "location"
                      ? "loc-col"
                      : undefined
                }
                style={{ width: column.width }}
              />
            ))}
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
              {visible.has("geBuy") && (
                <Th
                  label="GE buy"
                  onClick={() => toggleSort("geBuyPrice")}
                  active={sortKey === "geBuyPrice"}
                  desc={descending}
                  title="What one unit costs on the GE in this mode; purchases carry no tax"
                  right
                />
              )}
              {visible.has("shopPays") && (
                <Th
                  label="Shop pays"
                  onClick={() => toggleSort("shopAvgPrice")}
                  active={sortKey === "shopAvgPrice"}
                  desc={descending}
                  title="Average shop price across the planned units; it falls as the shop fills"
                  right
                />
              )}
              {visible.has("margin") && (
                <Th
                  label="Margin"
                  onClick={() => toggleSort("margin")}
                  active={sortKey === "margin"}
                  desc={descending}
                  title="Average profit per unit after the GE cost"
                  right
                />
              )}
              {visible.has("units") && (
                <Th
                  label="Qty"
                  onClick={() => toggleSort("units")}
                  active={sortKey === "units"}
                  desc={descending}
                  title="Total units across worlds, capped by your gold, the GE 4h supply and the world ceiling"
                  right
                />
              )}
              {visible.has("batch") && (
                <Th
                  label="Batch"
                  onClick={() => toggleSort("unitsPerWorld")}
                  active={sortKey === "unitsPerWorld"}
                  desc={descending}
                  title="Units one fresh world absorbs before its next price stops paying"
                  right
                />
              )}
              {visible.has("worlds") && (
                <Th
                  label="Worlds"
                  onClick={() => toggleSort("worlds")}
                  active={sortKey === "worlds"}
                  desc={descending}
                  title="Worlds hopped; each one resets the shop's stock"
                  right
                />
              )}
              {visible.has("spend") && (
                <Th
                  label="Spend"
                  onClick={() => toggleSort("spend")}
                  active={sortKey === "spend"}
                  desc={descending}
                  title="Coins paid on the GE; never more than your available gold"
                  right
                />
              )}
              {visible.has("profit") && (
                <Th
                  label="Profit"
                  onClick={() => toggleSort("profit")}
                  active={sortKey === "profit"}
                  desc={descending}
                  title="Coins received from the shops minus the GE spend"
                  right
                />
              )}
              {visible.has("trip") && (
                <Th
                  label="Trip"
                  onClick={() => toggleSort("geTiles")}
                  active={sortKey === "geTiles"}
                  desc={descending}
                  title="One Grand Exchange round trip; world hops are separate"
                  right
                />
              )}
              {visible.has("gpPerHour") && (
                <Th
                  label="gp / hour"
                  onClick={() => toggleSort("gpPerHour")}
                  active={sortKey === "gpPerHour"}
                  desc={descending}
                  title="Profit ÷ the slower of travel plus hops and GE supply time; — when the distance is unknown"
                  right
                />
              )}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((entry, index) => (
              <Row
                key={`${entry.opp.itemId}-${entry.opp.shopPage}`}
                data={entry}
                rank={index + 1}
                onSelectShop={setSelectedShop}
                visible={visible}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="empty">
            No flips match these filters. Try raising gold or clearing the
            minimum profit.
          </p>
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
          <p>
            <strong>Buy</strong> is what one unit costs on the GE in the selected
            mode: <strong>instant buy</strong> pays the latest <code>high</code>{" "}
            and is the number to trust; <strong>patient buy</strong> rests an
            offer at the latest <code>low</code> and may never fill. There is no
            GE tax on either leg — the 2% tax applies only to GE sales.
          </p>
          <p>
            <strong>The price falls as you sell.</strong> A shop pays less for
            every unit it takes: the <strong>delta%</strong> is the share of the
            item's value lost per unit (shown under the shop price as the drop
            per unit), and the offer never falls below 10% of value. The batch is
            the marginal sale that still beats the GE cost; a zero-margin unit is
            never sold. The shop is assumed to be at default stock when you
            arrive on each world.
          </p>
          <p>
            <strong>Notes remove banking; worlds reset the shop.</strong> GE
            purchases are collected as banknotes, so the whole quantity takes one
            inventory slot and there is no 27-unit load or bank trip. Instead,
            each fresh world resets that shop's stock, so the same falling price
            curve can be sold again after a hop. <strong>Qty</strong> totals the
            worlds, <strong>Batch</strong> is one world, and <strong>Worlds</strong>{" "}
            shows how many hops that takes. The plan is capped at your{" "}
            <strong>Max worlds</strong> setting (currently{" "}
            <strong>{maxWorlds}</strong>); each world is assumed to have the shop
            available. A row marked <strong>world cap</strong> could sell more if
            you allowed more hops.
          </p>
          <p>
            <strong>Gold available</strong> sizes every plan:{" "}
            <code>
              units = min(GE 4h supply, {maxWorlds} worlds × batch, gold / GE buy
              price)
            </code>
            . Spend never exceeds the amount you enter, and a row marked{" "}
            <strong>budget</strong> was cut by gold rather than by supply.
            Clearing the field to 0 shows the uncapped plan. The amount is the
            same value as the <strong>Shop → GE</strong> page: both read and
            write <code>rscalc.budget</code> in this browser.
          </p>
          <p>
            <strong>Time.</strong> One GE↔shop round trip (this shop's own
            straight-line distance, doubled, plus a 3s interface handover), plus
            the world-hop time you set, versus the GE supplying the units under
            the 4h buy limit and 24h volume. The slower of the two is used. No
            banking time is charged. Where the wiki map gives no GE distance
            (another map, or no coordinates), <strong>gp / hour</strong> is{" "}
            <strong>—</strong> rather than assuming a trip.
          </p>
          <p>
            <strong>Only shops that publish a buy price are included.</strong>{" "}
            The wiki writes <code>N/A</code> when a shop does not buy an item at
            all (Eblis's ancient staff is one), even though its buy multiplier can
            still be non-zero. The stock table only covers items the shop stocks,
            so a specialist buying a related unlisted item is invisible, and{" "}
            <strong>general stores are excluded</strong>: they buy almost
            anything, but their table only describes what they sell. Both are
            known gaps, not silent assumptions.
          </p>
          <p>
            Distances are straight-line tiles, not a walking route, so corners,
            obstacles and teleports are not modelled and the trip is a lower
            bound. Other players competing for the same shop, and destocking
            between visits to the same world, are not modelled either. The{" "}
            <strong>Max worlds</strong> cap is your explicit assumption (200 by
            default), not a sourced count.
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

function Row({
  data,
  rank,
  onSelectShop,
  visible,
}: {
  data: RowData;
  rank: number;
  onSelectShop: (shopPage: string) => void;
  visible: ReadonlySet<string>;
}): JSX.Element {
  const { opp, plan } = data;
  const tripTitle =
    plan.tripSeconds === null
      ? "No Grand Exchange distance on this shop's map, so travel time is unknown"
      : `${Math.round(plan.geTiles ?? 0).toLocaleString()} tiles each way, ${Math.round(
          plan.tripSeconds,
        )}s round trip, plus ${formatDuration(plan.hopSecondsTotal)} hopping`;
  const shopTitle = `Pays ${formatGp(plan.firstUnitRevenue)} for the first unit and ${formatGp(
    plan.lastUnitRevenue,
  )} for the last on a fresh world; average ${formatGp(Math.round(plan.totalRevenue / plan.units))}. Each unit sold lowers the offer by ${plan.priceDropPerUnit.toFixed(1)} gp (${plan.deltaPct.toFixed(1)}% of value).`;
  const gpTitle =
    plan.gpPerHour === null
      ? "The GE distance is unknown, so the hourly rate is not computed"
      : `Total time ${formatDuration(plan.timeSeconds)} for ${plan.units.toLocaleString()} units across ${plan.worlds} worlds`;

  return (
    <tr>
      {visible.has("rank") && <td className="num-col">{rank}</td>}
      {visible.has("item") && (
        <td className="item">
          <a
            className="name wiki-link"
            href={wikiUrl(opp.itemName)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {opp.itemName}
          </a>
          {opp.members && <span className="badge">P2P</span>}
        </td>
      )}
      {visible.has("shop") && (
        <td className="shop" title={opp.shopPage}>
          <a
            className="wiki-link"
            href={wikiUrl(opp.shopPage)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {opp.shopName}
          </a>
          <div className="shop-actions">
            <button
              type="button"
              className="shop-basket"
              onClick={() => onSelectShop(opp.shopPage)}
              aria-label={`Open the GE to shop basket for ${opp.shopName}`}
              title="Buy every profitable item for this shop and sell them in the same worlds"
            >
              basket
            </button>
            <AccessBadge shopPage={opp.shopPage} />
          </div>
        </td>
      )}
      {visible.has("location") && (
        <td className="loc loc-col">{opp.location ?? "—"}</td>
      )}
      {visible.has("geBuy") && (
        <td className="right mono">{formatGp(opp.geBuyPrice)}</td>
      )}
      {visible.has("shopPays") && (
        <td className="right mono" title={shopTitle}>
          {formatGp(Math.round(plan.totalRevenue / plan.units))}
          <span className="cell-note">
            {formatGp(plan.firstUnitRevenue)} → {formatGp(plan.lastUnitRevenue)} · −
            {plan.deltaPct.toFixed(1)}%/unit
          </span>
        </td>
      )}
      {visible.has("margin") && (
        <td
          className="right mono pos"
          title={plan.atFloor ? "The last unit already paid the 10%-of-value floor" : undefined}
        >
          {formatGp(Math.round(plan.marginPerUnit))}
          <span className="cell-note">
            {((plan.marginPerUnit / opp.geBuyPrice) * 100).toFixed(1)}%
          </span>
        </td>
      )}
      {visible.has("units") && (
        <td
          className="right mono strong"
          title="Total across worlds, capped by your gold, the GE 4h supply and the world ceiling"
        >
          {plan.units.toLocaleString()}
        </td>
      )}
      {visible.has("batch") && (
        <td
          className="right mono"
          title="One fresh world's marginal sale before its price stops paying"
        >
          {plan.unitsPerWorld.toLocaleString()}
        </td>
      )}
      {visible.has("worlds") && (
        <td
          className="right mono dim"
          title={
            plan.worldLimited
              ? `World ceiling reached (${plan.worlds} worlds); the GE could supply more`
              : `${plan.worlds} world${plan.worlds === 1 ? "" : "s"} needed`
          }
        >
          {plan.worlds.toLocaleString()}
          {plan.worldLimited && <span className="cell-note">world cap</span>}
        </td>
      )}
      {visible.has("spend") && (
        <td
          className="right mono"
          title={
            plan.budgetLimited
              ? "Capped by your available gold"
              : "Coins paid on the GE"
          }
        >
          {formatGp(Math.round(plan.totalCost))}
          {plan.budgetLimited && <span className="cell-note">budget</span>}
        </td>
      )}
      {visible.has("profit") && (
        <td className="right mono pos">
          {formatGp(Math.round(plan.profit))}
        </td>
      )}
      {visible.has("trip") && (
        <td className="right mono dim" title={tripTitle}>
          {plan.tripSeconds === null ? "—" : formatDuration(plan.tripSeconds)}
        </td>
      )}
      {visible.has("gpPerHour") && (
        <td className="right mono strong" title={gpTitle}>
          {plan.gpPerHour === null ? "—" : formatGp(Math.round(plan.gpPerHour))}
        </td>
      )}
    </tr>
  );
}
