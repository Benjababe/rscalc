import { useDeferredValue, useMemo, useState } from "react";
import type { Opportunity, Ranking, SellMode } from "../../src/types";
import { planWithBudget, type BudgetPlan } from "../../src/domain/budget";
import { wikiUrl } from "../../src/util/wiki";
import { AccessBadge } from "./AccessBadge";
import { accessFor } from "./access";
import { BudgetPanel, TravelFields } from "./BudgetPanel";
import { FilterCheck, FilterNumber, FilterToolbar } from "./FilterToolbar";
import { formatGp } from "./format";
import { matchesQuery, normaliseQuery } from "./matching";
import { sellableAcrossWorlds, toShopRow } from "./opportunity";
import { ShopBasketPanel } from "./ShopBasket";
import { useBudgetSettings, useTravelSettings } from "./settings";
import { currentViewState, pickOne, useShareableView } from "./viewState";
import { sortByMeasure, useSort } from "./sorting";
import { DataTable, type DataColumn } from "./DataTable";
import { Stat } from "./ui";
import { usePagedRows } from "./paging";

import payload from "../../data/opportunities.json";

/** Every sortable column. Also the allowlist for a shared link. */
const SORT_KEYS = [
  "gpPer4h",
  "gpPerHour",
  "margin",
  "volume4h",
  "avgCost",
  "sellPrice",
  "units",
  "profit",
  "spend",
  "worlds",
  "banks",
  "itemName",
] as const;

type SortKey = (typeof SORT_KEYS)[number];

interface OpportunitiesPayload {
  generatedAt: string;
  pessimistic: Ranking;
  patient: Ranking;
}

/**
 * The shop -> GE columns, keyed so each mode picks its own set.
 *
 * Both views share the identity and pricing columns and differ after them: the
 * budget view answers "what does my gold buy", the shop view answers "what does one
 * visit yield". `allColumns()` keeps both sets for the picker, so hiding a column in
 * one mode does not silently unhide it in the other.
 */
type ShopColumnKey =
  | "item"
  | "shop"
  | "location"
  | "unitCost"
  | "sellPrice"
  | "tax"
  | "margin"
  | "volume4h"
  | "buy"
  | "spend"
  | "worlds"
  | "banks"
  | "profit"
  | "qty"
  | "sellable"
  | "gpPer4h"
  | "gpPerHour";

function makeColumns(
  onSelectShop: (shopPage: string) => void,
): Record<ShopColumnKey, DataColumn<RowData>> {
  return {
    item: {
      key: "item",
      label: "Item",
      width: 210,
      required: true,
      sortKey: "itemName",
      title: "Item name; click to sort",
      cellClassName: "item",
      cell: (row) => (
        <>
          <a
            className="name wiki-link"
            href={wikiUrl(row.itemName)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.itemName}
          </a>
          {row.members && <span className="badge">P2P</span>}
        </>
      ),
    },
    shop: {
      key: "shop",
      label: "Shop",
      width: 220,
      cellClassName: "shop",
      cell: (row) => (
        <span title={row.shopPage}>
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
        </span>
      ),
    },
    location: {
      key: "location",
      label: "Location",
      width: 150,
      headerClassName: "loc-col",
      cellClassName: "loc loc-col",
      cell: (row) => row.location ?? "—",
    },
    unitCost: {
      key: "unitCost",
      label: "Unit cost",
      width: 100,
      sortKey: "avgCost",
      align: "right",
      title:
        "Average price paid per unit across the quantity you would take; a — means there was no budget plan at this gold",
      cellClassName: "right mono",
      cell: (row) => {
        const plan = row.plan;
        if (plan !== undefined && plan.units === 0) {
          const reason =
            row.volume4h === 0
              ? "no 4h volume"
              : plan.marginLimited
                ? "no margin"
                : plan.budgetLimited
                  ? "gold too low"
                  : "no plan";
          return (
            <>
              —
              <span
                className="cell-note"
                title={`No budget plan (${reason}). One full shop visit averages ${formatGp(
                  Math.round(row.avgCost),
                )} gp per unit.`}
              >
                {reason}
              </span>
            </>
          );
        }
        return formatGp(
          Math.round(plan !== undefined ? plan.avgCost : row.avgCost),
        );
      },
    },
    sellPrice: {
      key: "sellPrice",
      label: "Sell",
      width: 90,
      sortKey: "sellPrice",
      align: "right",
      title: "GE price used for this mode",
      cellClassName: "right mono",
      cell: (row) => formatGp(row.sellPrice),
    },
    tax: {
      key: "tax",
      label: "Tax",
      width: 70,
      align: "right",
      title: "GE tax per unit at this price",
      headerClassName: "tax-col",
      cellClassName: "right mono dim tax-col",
      cell: (row) => formatGp(row.taxPerUnit),
    },
    margin: {
      key: "margin",
      label: "Margin",
      width: 90,
      sortKey: "margin",
      align: "right",
      title: "Net sell price minus average unit cost",
      cellClassName: "right mono pos",
      cell: (row) => formatGp(Math.round(row.margin)),
    },
    volume4h: {
      key: "volume4h",
      label: "4h volume",
      width: 90,
      sortKey: "volume4h",
      align: "right",
      title:
        "GE sell-side 24h volume divided by 6, floored to whole units; the 4h sale cap used by the planner",
      cellClassName: "right mono",
      cell: (row) => (
        <span
          className={row.volume4h === 0 ? "dim" : undefined}
          title="GE sell-side 24h volume divided by 6, floored to whole units"
        >
          {row.volume4h.toLocaleString()}
        </span>
      ),
    },
    buy: {
      key: "buy",
      label: "Buy",
      width: 90,
      sortKey: "units",
      align: "right",
      title:
        "Total units your gold covers; the smaller line is one full-stock world's quantity",
      cellClassName: "right mono strong",
      cell: ({ plan }) => (
        <>
          {plan?.units.toLocaleString() ?? 0}
          <span className="cell-note">
            {formatGp(plan?.unitsPerWorld ?? 0)}/world
          </span>
        </>
      ),
    },
    spend: {
      key: "spend",
      label: "Spend",
      width: 110,
      sortKey: "spend",
      align: "right",
      title: "Coins spent",
      cellClassName: "right mono",
      cell: ({ plan }) => formatGp(Math.round(plan?.totalCost ?? 0)),
    },
    worlds: {
      key: "worlds",
      label: "Worlds",
      width: 70,
      sortKey: "worlds",
      align: "right",
      title: "Shop visits needed, assuming full default stock each world",
      cellClassName: "right mono dim",
      cell: ({ plan }) => plan?.worlds ?? 0,
    },
    banks: {
      key: "banks",
      label: "Banks",
      width: 150,
      sortKey: "banks",
      align: "right",
      title:
        "Bank trips needed for non-stackable goods; the bank used is shown beneath",
      cellClassName: "right mono dim",
      cell: (row) => {
        const plan = row.plan;
        const trips = plan?.bankTrips ?? 0;
        return (
          <span
            title={
              row.bankTiles === null
                ? "No bank distance available for this shop"
                : `${row.nearestBank ?? "Bank"} · ${Math.round(row.bankTiles)} tiles each way`
            }
          >
            {trips}
            {trips > 0 && (
              <span className="dim">
                {" · "}
                {plan?.bankTimeKnown === false
                  ? "?"
                  : `${Math.round(plan?.bankSecondsPerTrip ?? 0)}s`}
              </span>
            )}
            {trips > 0 && (
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
          </span>
        );
      },
    },
    profit: {
      key: "profit",
      label: "Profit",
      width: 110,
      sortKey: "profit",
      align: "right",
      title: "Net revenue minus spend",
      cellClassName: "right mono pos",
      cell: ({ plan }) => formatGp(Math.round(plan?.profit ?? 0)),
    },
    qty: {
      key: "qty",
      label: "Qty / visit",
      width: 90,
      sortKey: "units",
      align: "right",
      title: "Units one shop visit yields before the margin closes",
      cellClassName: "right mono",
      cell: (row) => row.units,
    },
    sellable: {
      key: "sellable",
      label: "Sellable",
      width: 90,
      align: "right",
      title: "One shop visit's units, capped by the 4h volume column",
      cellClassName: "right mono dim",
      cell: (row) => row.sellablePer4h.toLocaleString(),
    },
    gpPer4h: {
      key: "gpPer4h",
      label: "gp / 4h",
      width: 110,
      sortKey: "gpPer4h",
      align: "right",
      title:
        "Profit from one shop visit's sellable units, not the full 4h volume. Use gp / hour for the gold-sized rate.",
      cellClassName: "right mono strong",
      cell: (row) => formatGp(Math.round(row.gpPer4h)),
    },
    gpPerHour: {
      key: "gpPerHour",
      label: "gp / hour",
      width: 110,
      sortKey: "gpPerHour",
      align: "right",
      title:
        "Profit per hour at your current gold, including world hops, bank trips and the GE sell time",
      cellClassName: "right mono strong",
      cell: ({ plan }) => (
        <span
          title={
            plan === undefined
              ? "Enter gold available to compute gp / hour"
              : plan.gpPerHour === null
                ? "Bank distance unknown for this shop, so travel time cannot be computed"
                : undefined
          }
        >
          {plan?.gpPerHour != null ? formatGp(Math.round(plan.gpPerHour)) : "—"}
        </span>
      ),
    },
  };
}

/** The columns every mode shows, in table order. */
const SHOP_TO_GE_BASE_KEYS: readonly ShopColumnKey[] = [
  "item",
  "shop",
  "location",
  "unitCost",
  "sellPrice",
  "tax",
  "margin",
  "volume4h",
];
const BUDGET_KEYS: readonly ShopColumnKey[] = [
  "buy",
  "spend",
  "worlds",
  "banks",
  "profit",
  "gpPerHour",
];
const SHOP_KEYS: readonly ShopColumnKey[] = [
  "qty",
  "sellable",
  "gpPer4h",
  "gpPerHour",
];

/** The column list one mode renders. */
function columnsForMode(
  columns: Record<ShopColumnKey, DataColumn<RowData>>,
  budgetMode: boolean,
): DataColumn<RowData>[] {
  const keys = budgetMode
    ? [...SHOP_TO_GE_BASE_KEYS, ...BUDGET_KEYS]
    : [...SHOP_TO_GE_BASE_KEYS, ...SHOP_KEYS];
  return keys.map((key) => columns[key]);
}

/** Every column either mode can show, for the picker's list and storage validation. */
function allColumns(
  columns: Record<ShopColumnKey, DataColumn<RowData>>,
): DataColumn<RowData>[] {
  const keys: ShopColumnKey[] = [
    ...SHOP_TO_GE_BASE_KEYS,
    ...BUDGET_KEYS.filter((key) => key !== "gpPerHour"),
    ...SHOP_KEYS.filter((key) => key !== "gpPerHour"),
    "gpPerHour",
  ];
  return keys.map((key) => columns[key]);
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

const MODES = ["pessimistic", "patient"] as const;

const BUDGET_SORTS: ReadonlySet<SortKey> = new Set<SortKey>([
  "gpPerHour",
  "profit",
  "spend",
  "worlds",
  "banks",
]);

export function ShopToGePage(): JSX.Element {
  // A shared link carries the view; gold and column choices stay in storage.
  const [shared] = useState(() => currentViewState());
  const [mode, setMode] = useState<SellMode>(
    shared.mode === "patient" ? "patient" : "pessimistic",
  );
  const [query, setQuery] = useState(shared.q ?? "");
  const [membersOnly, setMembersOnly] = useState(shared.members === true);
  const [hideLocked, setHideLocked] = useState(shared.hideLocked === true);
  const [minVolume, setMinVolume] = useState(shared.minVolume ?? 0);
  const [selectedShop, setSelectedShop] = useState<string | null>(null);
  const { gold, setGold, view, setView } = useBudgetSettings();
  const {
    hopSeconds,
    setHopSeconds,
    maxWorlds,
    setMaxWorlds,
    secondsPerTile,
    setSecondsPerTile,
  } = useTravelSettings();
  const { sortKey, descending, toggle: toggleSort } = useSort<SortKey>(
    pickOne(shared.sort, SORT_KEYS, "gpPerHour"),
    shared.desc ?? true,
  );
  // Typing must stay responsive: the input updates immediately, and the rows
  // (which plan a budget each) recompute in a deferred, interruptible render.
  const deferredQuery = useDeferredValue(query);
  const filtering = query !== deferredQuery;

  useShareableView("shop-to-ge", {
    mode,
    sort: sortKey,
    desc: descending,
    q: query,
    members: membersOnly,
    hideLocked,
    minVolume,
  });

  const ranking = DATA[mode];
  const budgetMode = gold > 0 && view === "budget";

  const rows = useMemo<RowData[]>(() => {
    const needle = normaliseQuery(deferredQuery);

    const filtered = ranking.opportunities.filter((opp) => {
      if (membersOnly && !opp.members) return false;
      if (hideLocked && accessFor(opp.shopPage) !== undefined) return false;
      if (opp.sellablePer4h < minVolume) return false;
      return matchesQuery(needle, [
        opp.itemName,
        opp.shopName,
        opp.location,
      ]);
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

    if (key === "itemName") {
      return [...withPlans].sort((a, b) =>
        descending
          ? b.itemName.localeCompare(a.itemName)
          : a.itemName.localeCompare(b.itemName),
      );
    }

    // Ties keep their ranked order (a stable sort), which is what the pages
    // have always done for the shop-to-GE table.
    return sortByMeasure(withPlans, measure, descending);
  }, [
    ranking,
    deferredQuery,
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

  const paged = usePagedRows(rows);

  // The basket button inside the shop cell needs this page's handler, so the column
  // set is built here rather than at module scope.
  const columnSet = useMemo(() => makeColumns(setSelectedShop), []);

  // Derived from the rows only: without this, every keystroke that re-renders
  // the page also re-scanned and re-sorted the whole result set for the stats.
  const summary = useMemo(() => {
    const bestPlanRow = rows.reduce<RowData | undefined>((best, row) => {
      const gp = row.plan?.gpPerHour;
      if (gp == null) return best;
      if (best === undefined) return row;
      return gp > (best.plan?.gpPerHour ?? Number.NEGATIVE_INFINITY)
        ? row
        : best;
    }, undefined);

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

    return {
      bestPlanRow,
      bestSummary: budgetPlanSummary(bestPlanRow),
      bestGp4hRow,
      medianMargin,
      shopCount: new Set(rows.map((row) => row.shopPage)).size,
    };
  }, [rows]);
  const { bestPlanRow, bestSummary, bestGp4hRow, medianMargin, shopCount } =
    summary;

  /** Reset every filter, leaving the mode, sort and budget settings alone. */
  const clearFilters = (): void => {
    setQuery("");
    setMembersOnly(false);
    setHideLocked(false);
    setMinVolume(0);
  };
  const filtersActive =
    query.trim() !== "" || membersOnly || hideLocked || minVolume > 0;

  return (
    <div className="page">
      <FilterToolbar
        modeGroupLabel="Sell mode"
        modes={MODES.map((id) => ({ id, label: MODE_LABEL[id] }))}
        mode={mode}
        onMode={setMode}
        query={query}
        onQuery={setQuery}
        placeholder="Filter by item, shop or location…"
        searchLabel="Filter"
        pricesAsOf={ranking.pricesAsOf}
        generatedAt={DATA.generatedAt}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
      >
        <FilterCheck
          label="Members only"
          checked={membersOnly}
          onChange={setMembersOnly}
        />
        <FilterCheck
          label="Hide locked"
          title="Hide shops with a known access requirement from the curated, wiki-sourced access table"
          checked={hideLocked}
          onChange={setHideLocked}
        />
        <FilterNumber
          label="Min sellable"
          title="One shop visit's units, capped by 24h traded volume"
          ariaLabel="Minimum sellable units per shop visit"
          step={1}
          value={minVolume}
          onChange={setMinVolume}
        />
      </FilterToolbar>

      <BudgetPanel
        gold={gold}
        onGold={setGold}
        hint={
          budgetMode ? (
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
          )
        }
      >
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

        <TravelFields
          hopSeconds={hopSeconds}
          onHopSeconds={setHopSeconds}
          maxWorlds={maxWorlds}
          onMaxWorlds={setMaxWorlds}
          secondsPerTile={secondsPerTile}
          onSecondsPerTile={setSecondsPerTile}
        />
      </BudgetPanel>

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

      <DataTable<RowData>
        tableId="shop-to-ge"
        label="Shop to Grand Exchange opportunities"
        caption={`Shop to Grand Exchange opportunities, ranked by ${sortKey}`}
        noun="opportunities"
        columns={columnsForMode(columnSet, budgetMode)}
        allColumns={allColumns(columnSet)}
        paged={paged}
        sort={{
          key: sortKey,
          descending,
          toggle: (key) => toggleSort(key as SortKey),
        }}
        rowKey={(row) => `${row.shopPage}|${row.itemName}`}
        rank
        busy={filtering}
        emptyText="No opportunities match these filters."
        onClearFilters={clearFilters}
      />

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
