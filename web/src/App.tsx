import { useEffect, useMemo, useState } from "react";
import type { Opportunity, Ranking, SellMode } from "../../src/types";
import {
  DEFAULT_SECONDS_PER_TILE,
  planWithBudget,
  type BudgetPlan,
} from "../../src/domain/budget";
import type { ShopRow } from "../../src/domain/shopPrice";
import { wikiUrl } from "../../src/util/wiki";
import {
  BUDGET_STORAGE_KEY,
  parseBudgetState,
  serialiseBudgetState,
  type BudgetState,
  type BudgetView,
} from "./storage";

import payload from "../../data/opportunities.json";

type SortKey =
  | "gpPer4h"
  | "gpPerHour"
  | "margin"
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

function readStoredBudget(): BudgetState {
  if (typeof window === "undefined") return parseBudgetState(null);
  try {
    return parseBudgetState(window.localStorage.getItem(BUDGET_STORAGE_KEY));
  } catch {
    return parseBudgetState(null);
  }
}

/** Rebuild the shop price curve from the payload's pricing parameters. */
function toShopRow(opp: Opportunity): ShopRow {
  return {
    itemValue: opp.itemValue,
    sellMultiplier: opp.sellMultiplier,
    buyMultiplier: opp.buyMultiplier,
    delta: opp.delta,
    baseStock: opp.baseStock ?? 0,
    infiniteStock: opp.infiniteStock,
  };
}

/**
 * Units the GE can absorb in a 4h window, no matter how many shops you visit.
 *
 * `sellablePer4h` is additionally capped by one shop visit's stock, so using it
 * as the budget cap would make world-hopping pointless. The cross-world bound is
 * the GE buy limit and the 24h volume slice the engine already computed.
 */
function sellableAcrossWorlds(opp: Opportunity): number {
  return Math.min(opp.geBuyLimit ?? Number.POSITIVE_INFINITY, opp.volume4h);
}

export function App(): JSX.Element {
  const [mode, setMode] = useState<SellMode>("pessimistic");
  const [query, setQuery] = useState("");
  const [membersOnly, setMembersOnly] = useState(false);
  const [minVolume, setMinVolume] = useState(0);
  const [initialBudget] = useState<BudgetState>(readStoredBudget);
  const [gold, setGold] = useState(initialBudget.gold);
  const [view, setView] = useState<BudgetView>(initialBudget.view);
  const [hopSeconds, setHopSeconds] = useState(DEFAULT_HOP_SECONDS);
  const [secondsPerTile, setSecondsPerTile] = useState(
    DEFAULT_SECONDS_PER_TILE,
  );
  const [sortKey, setSortKey] = useState<SortKey>("gpPerHour");
  const [descending, setDescending] = useState(true);

  const ranking = DATA[mode];
  const budgetMode = gold > 0 && view === "budget";

  useEffect(() => {
    try {
      window.localStorage.setItem(
        BUDGET_STORAGE_KEY,
        serialiseBudgetState({ gold, view }),
      );
    } catch {
      // localStorage can be unavailable (private mode); the UI still works.
    }
  }, [gold, view]);

  const rows = useMemo<RowData[]>(() => {
    const needle = query.trim().toLowerCase();

    const filtered = ranking.opportunities.filter((opp) => {
      if (membersOnly && !opp.members) return false;
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
        case "avgCost":
          return row.avgCost;
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
    minVolume,
    budgetMode,
    gold,
    hopSeconds,
    secondsPerTile,
    sortKey,
    descending,
  ]);

  const best = rows[0];
  const bestSummary = budgetPlanSummary(
    rows.find((row) => row.plan?.gpPerHour != null),
  );
  const medianMargin =
    rows.length > 0
      ? ([...rows].map((r) => r.margin).sort((a, b) => a - b)[
          Math.floor(rows.length / 2)
        ] ?? 0)
      : 0;

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>rscalc</h1>
          <p className="sub">
            Buy from a shop, sell on the Grand Exchange. Prices from the OSRS
            Wiki real-time API.
          </p>
        </div>
        <div className="asof">
          <span className="label">GE prices as of</span>
          <strong>{formatTime(ranking.pricesAsOf)}</strong>
          <span className="label">built {formatTime(DATA.generatedAt)}</span>
        </div>
      </header>

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

        <label className="toggle">
          Min units / 4h
          <input
            className="num"
            type="number"
            min={0}
            step={1}
            value={minVolume}
            onChange={(event) => setMinVolume(Number(event.target.value) || 0)}
          />
        </label>
      </section>

      <section className="controls budget">
        <div className="budget-inputs">
          <label className="toggle">
            <span className="label">Gold available</span>
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
            gp
          </label>

          <label
            className="toggle"
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
            s
          </label>

          <label className="toggle">
            <span className="label">Travel speed</span>
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
            s / tile
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

        <p className="hint">
          {budgetMode ? (
            <>
              Sizing buys for <strong>{formatGp(gold)} gp</strong>, assuming{" "}
              <strong>full default stock on every world</strong>,{" "}
              <strong>{hopSeconds}s per world hop</strong> and a bank trip at
              each shop's own distance to its nearest bank, travelling at{" "}
              <strong>{secondsPerTile}s per tile</strong>. Prices rise as you
              buy, so this walks the curve rather than dividing your gold by one
              unit price. Non-stackable items fill 27 inventory slots per load;
              shops with no bank on their map show “—” for gp/hour.
            </>
          ) : gold > 0 ? (
            <>
              Showing per-shop-visit quantities. The <strong>gp / hour</strong>{" "}
              column is sized to your <strong>{formatGp(gold)} gp</strong> at{" "}
              <strong>{secondsPerTile}s per tile</strong>. Tick{" "}
              <strong>Size buys to gold</strong> for the Buy / Spend / Worlds
              columns.
            </>
          ) : (
            <>
              Enter gold to size buys across world hops. Showing per-shop-visit
              quantities; gp / hour needs a gold amount.
            </>
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
              accent
            />
            <Stat
              label="Profit on best"
              value={`${formatGp(Math.round(bestSummary?.profit ?? 0))} gp`}
            />
            <Stat
              label="Spend on best"
              value={`${formatGp(Math.round(bestSummary?.totalCost ?? 0))} gp`}
            />
            <Stat
              label="World hops on best"
              value={String(bestSummary?.worlds ?? 0)}
            />
            <Stat
              label="Bank trips on best"
              value={String(bestSummary?.bankTrips ?? 0)}
            />
          </>
        ) : (
          <>
            <Stat
              label="Best gp / 4h"
              value={formatGp(Math.round(best?.gpPer4h ?? 0))}
              accent
            />
            <Stat
              label="Median margin"
              value={`${formatGp(medianMargin)} gp`}
            />
            <Stat label="Shops scanned" value="593" />
          </>
        )}
      </section>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th className="num-col">#</th>
              <Th
                label="Item"
                onClick={() => toggleSort("itemName")}
                active={sortKey === "itemName"}
                desc={descending}
              />
              <th>Shop</th>
              <th>Location</th>
              <Th
                label="Unit cost"
                onClick={() => toggleSort("avgCost")}
                active={sortKey === "avgCost"}
                desc={descending}
                right
              />
              <Th
                label="Sell"
                onClick={() => toggleSort("sellPrice")}
                active={sortKey === "sellPrice"}
                desc={descending}
                right
              />
              <th className="right">Tax</th>
              <Th
                label="Margin"
                onClick={() => toggleSort("margin")}
                active={sortKey === "margin"}
                desc={descending}
                right
              />

              {budgetMode ? (
                <>
                  <Th
                    label="Buy"
                    onClick={() => toggleSort("units")}
                    active={sortKey === "units"}
                    desc={descending}
                    right
                  />
                  <Th
                    label="Spend"
                    onClick={() => toggleSort("spend")}
                    active={sortKey === "spend"}
                    desc={descending}
                    right
                  />
                  <Th
                    label="Worlds"
                    onClick={() => toggleSort("worlds")}
                    active={sortKey === "worlds"}
                    desc={descending}
                    right
                  />
                  <Th
                    label="Banks"
                    onClick={() => toggleSort("banks")}
                    active={sortKey === "banks"}
                    desc={descending}
                    right
                  />
                  <Th
                    label="Profit"
                    onClick={() => toggleSort("profit")}
                    active={sortKey === "profit"}
                    desc={descending}
                    right
                  />
                  <Th
                    label="gp / hour"
                    onClick={() => toggleSort("gpPerHour")}
                    active={sortKey === "gpPerHour"}
                    desc={descending}
                    right
                  />
                </>
              ) : (
                <>
                  <Th
                    label="Qty"
                    onClick={() => toggleSort("units")}
                    active={sortKey === "units"}
                    desc={descending}
                    right
                  />
                  <th className="right">Units / 4h</th>
                  <Th
                    label="gp / 4h"
                    onClick={() => toggleSort("gpPer4h")}
                    active={sortKey === "gpPer4h"}
                    desc={descending}
                    right
                  />
                  <Th
                    label="gp / hour"
                    onClick={() => toggleSort("gpPerHour")}
                    active={sortKey === "gpPerHour"}
                    desc={descending}
                    right
                  />
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
        {budgetMode ? (
          <p>
            <strong>Buy</strong> is how many units your gold actually covers,{" "}
            <strong>Spend</strong> is what leaves your inventory,{" "}
            <strong>Worlds</strong> is how many shop visits that takes, and{" "}
            <strong>Banks</strong> is how many trips to the bank the loads need;
            the seconds beside it are that shop's own round trip, and the line
            below names the bank used. Each world is
            assumed to be at full default stock, so the price curve restarts
            every hop. A backpack holds 28 items; coins take one slot, so a load
            carries 27 non-stackable items. Distances come from the wiki map and
            are travelled at <strong>{secondsPerTile}s per tile</strong>;
            stackable items never need a bank. Where the wiki map gives no bank
            for a shop, gp / hour is shown as <strong>—</strong> rather than
            assuming a trip. <strong>gp / hour</strong> = profit ÷ max(world
            hops + bank trips, GE sell time) and excludes travel to the shop.
          </p>
        ) : (
          <p>
            <strong>Unit cost</strong> is the average price across the quantity
            you would take; shop prices rise with every unit bought.{" "}
            <strong>Qty</strong> is what one shop visit yields before the next
            unit stops being profitable. <strong>Units / 4h</strong> is capped
            by the GE buy limit and 24h traded volume.{" "}
            <strong>gp / hour</strong> uses your current gold available and the
            same per-shop bank time as budget mode; it shows <strong>—</strong>{" "}
            when gold is 0 or the bank distance is unknown.
          </p>
        )}
        <p>
          Gross margin is net of the 2% GE tax (capped at 5,000,000 gp, items
          under 50 gp exempt). Shop stock is per-world in reality; restock times
          are not modelled. Items whose wiki page does not state stackability
          are treated as non-stackable, the pessimistic direction. Bank
          distances are straight-line tiles from the wiki map, not a walking
          route, so corners and obstacles add time; raise the seconds-per-tile
          value to allow for that. Your gold amount and the budget/shop view are
          saved in this browser. Item names and icons are © Jagex; wiki data is
          CC BY-SA.
        </p>
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
}: {
  row: RowData;
  rank: number;
  budgetMode: boolean;
}): JSX.Element {
  const plan = row.plan;
  return (
    <tr>
      <td className="num-col">{rank}</td>
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
      <td className="shop" title={row.shopPage}>
        <a
          className="wiki-link"
          href={wikiUrl(row.shopPage)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {row.shopName}
        </a>
        {row.soldBy !== null && <span className="vendor"> · {row.soldBy}</span>}
      </td>
      <td className="loc">{row.location ?? "—"}</td>
      <td className="right mono">
        {formatGp(
          Math.round(
            plan !== undefined && budgetMode ? plan.avgCost : row.avgCost,
          ),
        )}
      </td>
      <td className="right mono">{formatGp(row.sellPrice)}</td>
      <td className="right mono dim">{formatGp(row.taxPerUnit)}</td>
      <td className="right mono pos">{formatGp(Math.round(row.margin))}</td>

      {budgetMode ? (
        <>
          <td className="right mono strong">
            {plan?.units.toLocaleString() ?? 0}
          </td>
          <td className="right mono">
            {formatGp(Math.round(plan?.totalCost ?? 0))}
          </td>
          <td className="right mono dim">{plan?.worlds ?? 0}</td>
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
                {row.nearestBank ?? "Unknown bank"}
              </span>
            )}
          </td>
          <td className="right mono pos">
            {formatGp(Math.round(plan?.profit ?? 0))}
          </td>
          <GpPerHourCell plan={plan} />
        </>
      ) : (
        <>
          <td className="right mono">{row.units}</td>
          <td className="right mono dim">
            {row.sellablePer4h.toLocaleString()}
          </td>
          <td className="right mono strong">
            {formatGp(Math.round(row.gpPer4h))}
          </td>
          <GpPerHourCell plan={plan} />
        </>
      )}
    </tr>
  );
}

function Th(props: {
  label: string;
  onClick: () => void;
  active: boolean;
  desc: boolean;
  right?: boolean;
}): JSX.Element {
  return (
    <th className={props.right ? "right sortable" : "sortable"}>
      <button type="button" onClick={props.onClick}>
        {props.label}
        {props.active && (
          <span className="arrow">{props.desc ? "▾" : "▴"}</span>
        )}
      </button>
    </th>
  );
}

function Stat(props: {
  label: string;
  value: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className={props.accent ? "stat accent" : "stat"}>
      <span className="label">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

/**
 * `shopPage` is the wiki page title verbatim (e.g. `Bob's Brilliant Axes.`,
 * trailing full stop included, because that IS the page name).
 */
function formatGp(value: number): string {
  return value.toLocaleString("en-US");
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}m`;
  if (value >= 1_000) return `${value / 1_000}k`;
  return String(value);
}

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}
