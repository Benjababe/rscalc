/**
 * The gp-earning leaderboard — the front door of the site.
 *
 * This page exists because the three calculators answered three separate
 * questions and left the player to compare them. `buildEarnings` (in
 * `src/domain/earnings.ts`) re-plans every shop run, shop dump and recipe at
 * the player's own gold, so all three families arrive in one comparable list:
 * **what earns the most per hour, what does it cost up front, and how long does
 * a run take?**
 *
 * The numbers are computed by the same pure planners the detail pages use, and
 * each row links to its detail page with the same view (mode + item search), so
 * the leaderboard can never drift from the calculator it is summarising.
 * A row the time model cannot price is excluded and counted, never guessed.
 */

import { useDeferredValue, useMemo, useState } from "react";

import {
  buildEarnings,
  EARN_KIND_LABELS,
  EARN_KIND_TITLES,
} from "../../src/domain/earnings";
import type {
  EarnMethod,
  EarnResult,
  SkillActivityRow,
} from "../../src/domain/earnings";
import type {
  ProcessPayload,
  Ranking,
  SellMode,
  ShopSinkRanking,
  SkillingPayload,
} from "../../src/types";
import { wikiUrl } from "../../src/util/wiki";
import { ACCESS_MAP } from "./access";
import { BudgetPanel, TravelFields } from "./BudgetPanel";
import { FilterCheck, FilterToolbar } from "./FilterToolbar";
import { formatDuration, formatGp } from "./format";
import { matchesQuery, normaliseQuery } from "./matching";
import { usePagedRows } from "./paging";
import {
  buildViewHash,
  currentViewState,
  pickOne,
  useShareableView,
} from "./viewState";
import { useBudgetSettings, useTravelSettings } from "./settings";import { sortByMeasure, useSort } from "./sorting";
import { DataTable, type DataColumn } from "./DataTable";
import { Stat } from "./ui";

import opportunitiesPayload from "../../data/opportunities.json";
import sinksPayload from "../../data/shop-sinks.json";
import processPayload from "../../data/process.json";
import skillingPayload from "../../data/skilling.json";

interface OpportunitiesData {
  generatedAt: string;
  pessimistic: Ranking;
  patient: Ranking;
}

interface SinksData {
  generatedAt: string;
  pessimistic: ShopSinkRanking;
  patient: ShopSinkRanking;
}

/**
 * All three artifacts are static snapshots built by `scripts/`. There is no
 * network call in this component, by design.
 */
const OPPORTUNITIES = opportunitiesPayload as unknown as OpportunitiesData;
const SINKS = sinksPayload as unknown as SinksData;
const PROCESS = processPayload as unknown as ProcessPayload;

/**
 * SAFETY: the artifact is written by `scripts/refresh-skilling.ts`, which refuses
 * to write a payload that fails `SkillingPayloadSchema` (zod), so the shape here is
 * the one that schema validated. Typed with `SkillingPayload` — the schema's own
 * inferred type — rather than a hand-written interface: a local interface is
 * exactly how this cast went wrong the first time, declaring `pessimistic` and
 * `patient` at the top level when the artifact nests them per skill. Nothing read
 * those fields, so the lie compiled.
 */
const SKILLING = skillingPayload as unknown as SkillingPayload;

/**
 * Flatten the per-skill artifact into one list for the leaderboard, carrying the
 * skill each row was scanned under (a few recipes are reachable from more than
 * one skill, so the recipe id alone is not an identity).
 */
function skillingRows(mode: SellMode): SkillActivityRow[] {
  const rows: SkillActivityRow[] = [];
  for (const catalog of SKILLING.skills) {
    const ranking =
      mode === "pessimistic" ? catalog.pessimistic : catalog.patient;
    for (const activity of ranking.opportunities) {
      rows.push({ skill: catalog.skill, activity });
    }
  }
  return rows;
}

/** Where a row's detail link goes, for the tooltip. */
const TARGET_LABEL: Record<EarnMethod["target"]["page"], string> = {
  "shop-to-ge": "Shop → GE",
  "ge-to-shop": "GE → shop",
  processing: "Processing",
  skilling: "Skilling",
};

const MODE_LABEL: Record<SellMode, string> = {
  pessimistic: "Instant (GE low)",
  patient: "Patient (GE high)",
};

const MODES = ["pessimistic", "patient"] as const;

const KINDS = ["all", "shop-run", "shop-dump", "processing", "skilling"] as const;
type KindFilter = (typeof KINDS)[number];

const KIND_LABEL: Record<KindFilter, string> = {
  all: "All methods",
  "shop-run": EARN_KIND_LABELS["shop-run"],
  "shop-dump": EARN_KIND_LABELS["shop-dump"],
  processing: EARN_KIND_LABELS.processing,
  skilling: EARN_KIND_LABELS.skilling,
};

const SORT_KEYS = [
  "gpPerHour",
  "profitGp",
  "capitalGp",
  "timeSeconds",
  "name",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

/**
 * The leaderboard columns: label, width, sort key and cell. `DataTable` owns
 * visibility, the Columns picker and the sortable headers, so this list is the only
 * place a column is described.
 */
function makeColumns(mode: SellMode): readonly DataColumn<EarnMethod>[] {
  return [
  {
    key: "method",
    label: "Method",
    width: 220,
    required: true,
    sortKey: "name",
    title: "The item you buy low or produce; click to sort",
    cellClassName: "item",
    cell: (row) => (
      <>
        <a
          className="name wiki-link"
          href={buildViewHash(row.target.page, {
            mode,
            q: row.target.query,
          })}
          title={`Open in ${TARGET_LABEL[row.target.page]}`}
        >
          {row.name}
        </a>
        {row.members && <span className="badge">P2P</span>}
      </>
    ),
  },
  {
    key: "kind",
    label: "Type",
    width: 112,
    cell: (row) => (
      <span
        className={`kind-badge kind-${row.kind}`}
        title={EARN_KIND_TITLES[row.kind]}
      >
        {EARN_KIND_LABELS[row.kind]}
      </span>
    ),
  },
  {
    key: "where",
    label: "Where",
    width: 260,
    cellClassName: "shop",
    cell: (row) => (
      <>
        {row.kind === "processing" || row.kind === "skilling" ? (
          <span title={row.detail ?? undefined}>{row.where}</span>
        ) : (
          <a
            className="wiki-link"
            href={wikiUrl(row.where)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {row.where}
          </a>
        )}
        {row.detail !== null && row.detail !== row.where && (
          <span className="cell-note">{row.detail}</span>
        )}
      </>
    ),
  },
  {
    key: "gpPerHour",
    label: "gp / hour",
    width: 116,
    sortKey: "gpPerHour",
    align: "right",
    title:
      "Profit per hour while executing the sized plan, using the same time model as the detail page",
    cellClassName: "right mono strong",
    cell: (row) => formatGp(Math.round(row.gpPerHour)),
  },
  {
    key: "capital",
    label: "Capital",
    width: 110,
    sortKey: "capitalGp",
    align: "right",
    title:
      "Coins tied up for the whole plan: shop stock, GE purchases, or inputs plus fees",
    cellClassName: "right mono",
    cell: (row) => formatGp(Math.round(row.capitalGp)),
  },
  {
    key: "profit",
    label: "Profit",
    width: 110,
    sortKey: "profitGp",
    align: "right",
    title: "Profit across the whole plan, after the GE tax where one applies",
    cellClassName: "right mono pos",
    cell: (row) => formatGp(Math.round(row.profitGp)),
  },
  {
    key: "time",
    label: "Time",
    width: 100,
    sortKey: "timeSeconds",
    align: "right",
    title:
      "Seconds the plan takes: travel and world hops against the GE's own throughput",
    cellClassName: "right mono dim",
    cell: (row) => formatDuration(row.timeSeconds),
  },
  {
    key: "needs",
    label: "Needs",
    width: 190,
    cellClassName: "needs",
    cell: (row) =>
      row.requirements.length === 0 ? (
        <span className="dim">—</span>
      ) : row.requirementSource === null ? (
        row.requirements.join(" · ")
      ) : (
        <a
          className="wiki-link"
          href={row.requirementSource}
          target="_blank"
          rel="noopener noreferrer"
          title={`${row.requirements.join(" · ")} (wiki source)`}
        >
          {row.requirements.join(" · ")}
        </a>
      ),
  },
  ];
}

export function EarnPage(): JSX.Element {
  // A shared link carries the view; gold and travel assumptions stay in the
  // same storage the detail pages use, so the numbers agree across pages.
  const [shared] = useState(() => currentViewState());
  const [mode, setMode] = useState<SellMode>(
    shared.mode === "patient" ? "patient" : "pessimistic",
  );
  const [query, setQuery] = useState(shared.q ?? "");
  const [membersOnly, setMembersOnly] = useState(shared.members === true);
  const [hideLocked, setHideLocked] = useState(shared.hideLocked === true);
  const [kind, setKind] = useState<KindFilter>(
    pickOne(shared.kind, KINDS, "all"),
  );
  const { gold, setGold } = useBudgetSettings();
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

  // Typing must stay responsive: the box updates immediately and the rows
  // re-plan in a deferred, interruptible render.
  const deferredQuery = useDeferredValue(query);
  const filtering = query !== deferredQuery;

  useShareableView("earn", {
    mode,
    sort: sortKey,
    desc: descending,
    q: query,
    members: membersOnly,
    hideLocked,
    kind,
  });

  /** Every method, sized to the current gold and travel assumptions. */
  const earnings = useMemo(
    () =>
      buildEarnings(
        {
          shopRuns: OPPORTUNITIES[mode].opportunities,
          shopDumps: SINKS[mode].opportunities,
          recipes: PROCESS[mode].opportunities,
          skilling: skillingRows(mode),
        },
        { goldGp: gold, hopSeconds, maxWorlds, secondsPerTile, access: ACCESS_MAP },
      ),
    [mode, gold, hopSeconds, maxWorlds, secondsPerTile],
  );

  const rows = useMemo<EarnMethod[]>(() => {
    const needle = normaliseQuery(deferredQuery);

    const filtered = earnings.methods.filter((method) => {
      if (kind !== "all" && method.kind !== kind) return false;
      if (membersOnly && !method.members) return false;
      if (hideLocked && method.locked) return false;
      return matchesQuery(needle, [
        method.name,
        method.where,
        method.detail,
        ...method.requirements,
      ]);
    });

    if (sortKey === "name") {
      return [...filtered].sort((a, b) =>
        descending
          ? b.name.localeCompare(a.name)
          : a.name.localeCompare(b.name),
      );
    }

    const measure = (row: EarnMethod): number | null => {
      switch (sortKey) {
        case "gpPerHour":
          return row.gpPerHour;
        case "profitGp":
          return row.profitGp;
        case "capitalGp":
          return row.capitalGp;
        case "timeSeconds":
          return row.timeSeconds;
        default:
          return null;
      }
    };

    // The default order already ties on gp/hour and profit, so re-sorting by
    // the same measure keeps the leaderboard's deterministic tail.
    return sortByMeasure(filtered, measure, descending);
  }, [earnings, deferredQuery, kind, membersOnly, hideLocked, sortKey, descending]);

  const paged = usePagedRows(rows);

  // The method link carries the page's current mode into the detail page, so the
  // column list is built here rather than at module scope.
  const columns = useMemo(() => makeColumns(mode), [mode]);

  const summary = useMemo(() => {
    const best = rows[0];
    const freeToPlay = rows.find((row) => !row.members);
    const rates = rows.map((row) => row.gpPerHour).sort((a, b) => a - b);
    const median =
      rates.length > 0 ? (rates[Math.floor(rates.length / 2)] ?? null) : null;
    return {
      best: best ?? null,
      freeToPlay: freeToPlay ?? null,
      median,
      kinds: new Set(rows.map((row) => row.kind)).size,
    };
  }, [rows]);

  const clearFilters = (): void => {
    setQuery("");
    setMembersOnly(false);
    setHideLocked(false);
    setKind("all");
  };
  const filtersActive =
    query.trim() !== "" || membersOnly || hideLocked || kind !== "all";

  return (
    <div className="page">
      <FilterToolbar
        modeGroupLabel="Price mode"
        modes={MODES.map((id) => ({ id, label: MODE_LABEL[id] }))}
        mode={mode}
        onMode={setMode}
        query={query}
        onQuery={setQuery}
        placeholder="Filter by item, shop or input…"
        searchLabel="Filter money makers"
        pricesAsOf={OPPORTUNITIES[mode].pricesAsOf}
        generatedAt={OPPORTUNITIES.generatedAt}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
      >
        <div className="modes" role="group" aria-label="Method type">
          {KINDS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === kind ? "mode active" : "mode"}
              onClick={() => setKind(candidate)}
              aria-pressed={candidate === kind}
              title={
                candidate === "all"
                  ? "Every family this model can price"
                  : EARN_KIND_TITLES[candidate]
              }
            >
              {KIND_LABEL[candidate]}
            </button>
          ))}
        </div>
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
      </FilterToolbar>

      <BudgetPanel
        gold={gold}
        onGold={setGold}
        hint={
          gold > 0 ? (
            <>
              Every method is sized to <strong>{formatGp(gold)} gp</strong>, so
              the ranking answers &quot;what would <em>my</em> gold earn?&quot;
              rather than what an unlimited bank could. Shop runs assume full
              default stock on each world, <strong>{secondsPerTile}s</strong>{" "}
              per tile and up to <strong>{maxWorlds} worlds</strong>; processing
              uses each recipe&apos;s published action rate.
            </>
          ) : (
            <>
              No gold cap: each method is sized to the most the market can
              absorb in a 4h window, up to{" "}
              <strong>{maxWorlds} worlds</strong> for shop visits. Enter gold to
              see what you can actually fund.
            </>
          )
        }
      >
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
        <Stat
          label="Methods priced"
          value={rows.length.toLocaleString()}
          title="Rows with a profit and a known time model at this gold"
        />
        <Stat
          label="Best gp / hour"
          value={
            summary.best === null
              ? "—"
              : formatGp(Math.round(summary.best.gpPerHour))
          }
          title={
            summary.best === null
              ? "No row matches these filters"
              : `${summary.best.name} · ${EARN_KIND_LABELS[summary.best.kind]}`
          }
          accent
        />
        <Stat
          label="Best free-to-play"
          value={
            summary.freeToPlay === null
              ? "—"
              : formatGp(Math.round(summary.freeToPlay.gpPerHour))
          }
          title={
            summary.freeToPlay === null
              ? "No free-to-play row matches these filters"
              : `${summary.freeToPlay.name} · ${EARN_KIND_LABELS[summary.freeToPlay.kind]}`
          }
        />
        <Stat
          label="Median gp / hour"
          value={
            summary.median === null
              ? "—"
              : formatGp(Math.round(summary.median))
          }
        />
      </section>

      <p className="hint earn-coverage">
        {summary.kinds > 1 ? `${summary.kinds} method types in view. ` : ""}
        {coverage(earnings, gold)}
      </p>

      <DataTable<EarnMethod>
        tableId="earn"
        label="Money-making methods"
        caption={`Money-making methods, ranked by ${sortKey}`}
        noun="methods"
        columns={columns}
        paged={paged}
        sort={{
          key: sortKey,
          descending,
          toggle: (key) => toggleSort(key as SortKey),
        }}
        rowKey={(row) => row.id}
        rank
        busy={filtering}
        emptyText="No method earns at this gold with these filters. Try clearing the method filter, lowering your gold, or raising Max worlds."
        onClearFilters={clearFilters}
      />

      <footer className="footer">
        <details className="caveats">
          <summary>How these numbers are made</summary>
          <p>
            <strong>One list, three models.</strong> Every row is re-planned at
            your gold by the same code as its detail page, so the leaderboard
            cannot disagree with the calculator behind it. A{" "}
            <strong>shop run</strong> buys stock from a shop and sells on the
            GE: time is max(world hops + bank trips, time for the GE to absorb
            the units), and the GE tax is charged on the sale. A{" "}
            <strong>sell-to-shop</strong> row buys on the GE and sells to a shop:
            one GE round trip plus one hop per world, no tax on either leg.{" "}
            <strong>Processing</strong> uses the recipe&apos;s published action
            rate against a 4h market window, with the tax on the output.
          </p>
          <p>
            <strong>Capital</strong> is the money the plan ties up, not a
            suggestion that you need that much to start. <strong>Profit</strong>{" "}
            is what the plan returns after costs and tax.{" "}
            <strong>gp / hour</strong> divides one by the other, so a method can
            have a large profit and a modest hourly rate.
          </p>
          <p>
            <strong>What is missing is missing on purpose.</strong> A shop whose
            bank distance the wiki map does not give, a GE → shop flip whose shop
            has no map distance to the GE, and a recipe with no published tick
            time are all excluded and counted above, never filled in with a
            plausible trip. Distances are straight-line tiles, not routes;{" "}
            <strong>{secondsPerTile}s per tile</strong> stands in for walking
            (0.6) or running (0.3) and corners are not modelled. Processing
            skill levels are shown but not checked — this is not a read of your
            account.
          </p>
          <p>
            This is not a claim about every way to make gp in Old School
            RuneScape. It covers the families this repo can price from sourced
            data: shop runs, GE ↔ shop flips and deterministic processing.
            Slayer, bossing, skilling and anything else is out of scope, and
            nothing here is interpolated to stand in for it.
          </p>
        </details>
        <p className="attribution">
          Item names and icons © Jagex. Wiki data CC BY-SA. Shop stock, map
          distances and recipes from the OSRS Wiki. The snapshots are static; no
          external API calls.
        </p>
      </footer>
    </div>
  );
}

/**
 * One sentence covering what the leaderboard left out, and why. Only the
 * non-zero reasons are named: an empty clause reads as an excuse, not a fact.
 */
function coverage(result: EarnResult, gold: number): string {
  const parts: string[] = [];
  if (result.unranked > 0) {
    parts.push(
      `${result.unranked.toLocaleString()} are not ranked because the wiki data has no time model for them`,
    );
  }
  if (result.unexecutable > 0) {
    parts.push(
      `${result.unexecutable.toLocaleString()} have no 4h market to sell into`,
    );
  }
  if (gold > 0 && result.unaffordable > 0) {
    parts.push(
      `${result.unaffordable.toLocaleString()} cannot be funded with ${formatGp(gold)} gp`,
    );
  }
  if (result.duplicated > 0) {
    parts.push(
      `${result.duplicated.toLocaleString()} skilling rows duplicate a processing recipe and are ranked once`,
    );
  }
  if (parts.length === 0) return "Every priced method is ranked at this gold.";
  return `${joinClauses(parts)}. Nothing is estimated to fill the gap.`;
}

/** `a, b and c` — Oxford commas read oddly in a single sentence here. */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}
