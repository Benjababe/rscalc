/**
 * Skilling activities — what a skill can actually do, and what each action earns
 * or costs.
 *
 * This is the fourth calculator and the only one that lists **losses on
 * purpose**. A shop run and a flip are things you do because they pay; training a
 * skill is something you pay for, so a table that only showed the profitable half
 * would be hiding the answer to "is this worth doing?".
 *
 * Three decisions are baked in, all recorded in `docs/skilling-plan.md`:
 *
 *  - **Instant by default** (buy at `high`, sell at `low`). The pessimistic
 *    ranking is the default because it is the one you can always execute. The
 *    patient ranking is behind a toggle; it is in the artifact either way.
 *  - **GE in, GE out.** No high-alch and no shop-sale channel, so alchable output
 *    (d'hide, battlestaves, jewellery) reads worse here than it is. The caveat is
 *    stated on the page rather than priced as a second channel.
 *  - **Cooking needs your level.** A cooked food burns below its no-burn level, so
 *    those rows stay hidden until a level is entered — showing them at level 1
 *    would put a gamble at the top of a ranking.
 *
 * Every row is a static snapshot: no network call happens here.
 */

import { useDeferredValue, useMemo, useState } from "react";

import type {
  SellMode,
  SkillActivity,
  SkillActivityCatalog,
  SkillActivityKind,
} from "../../src/types";
import { FilterCheck, FilterNumber, FilterToolbar } from "./FilterToolbar";
import { formatGp } from "./format";
import { matchesQuery, normaliseQuery } from "./matching";
import { usePagedRows } from "./paging";
import { useSort, sortByMeasure } from "./sorting";
import { Results, Stat, Th } from "./ui";
import {
  currentViewState,
  pickOne,
  useShareableView,
  type ViewState,
} from "./viewState";

import payload from "../../data/skilling.json";

interface SkillingData {
  generatedAt: string;
  pricesAsOf: string;
  skills: SkillActivityCatalog[];
}

/**
 * SAFETY: the JSON import is typed as a generic object by Vite, and the shape is
 * guaranteed by `SkillingPayloadSchema` (zod) at build time in
 * `scripts/refresh-skilling.ts` — the script refuses to write a payload that does
 * not parse, so this cast cannot widen what the artifact contains.
 */
const DATA = payload as unknown as SkillingData;

const MODE_LABEL: Record<SellMode, string> = {
  pessimistic: "Instant (GE low)",
  patient: "Patient (GE high)",
};
const MODES = ["pessimistic", "patient"] as const;

/** Default mode: the one you can always execute (Q10). */
const DEFAULT_MODE: SellMode = "pessimistic";

const KIND_LABEL: Record<SkillActivityKind, string> = {
  transform: "Make",
  upgrade: "Upgrade",
  train: "Cost",
  gather: "Gather",
};

const KIND_TITLE: Record<SkillActivityKind, string> = {
  transform:
    "Buy the inputs on the GE, make the output, sell it back. Repeatable.",
  upgrade:
    "Re-work one finished item into a better version of it (anguish → rupture). Still a sale, but a one-off: millions of capital and a handful of conversions a day.",
  train:
    "Build something that cannot be sold — house furniture. The row is the cost of one action, not a flip.",
  gather:
    "One unit from one node per respawn, with no inputs. The rate is the wiki's respawn timer, so it assumes nobody else is competing for that node.",
};

const KINDS = ["all", "transform", "upgrade", "gather", "train"] as const;
type KindFilter = (typeof KINDS)[number];

const KIND_FILTER_LABEL: Record<KindFilter, string> = {
  all: "All kinds",
  transform: "Make & sell",
  upgrade: "Upgrades",
  gather: "Gathering",
  train: "Cost to train",
};

const SORT_KEYS = [
  "gpPerHour",
  "profit",
  "spend",
  "level",
  "name",
  "skill",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

/** The default Cooking level: 0 means "not given", so those rows stay hidden. */
const DEFAULT_COOKING_LEVEL = 0;

/**
 * Column widths. `results-table` is `table-layout: fixed`, so without these every
 * column gets an equal share — which gives "Inputs" the same room as "#".
 */
const COLUMNS = [
  { key: "rank", width: 44 },
  { key: "activity", width: 300 },
  { key: "skill", width: 92 },
  { key: "level", width: 84 },
  { key: "inputs", width: 300 },
  { key: "cost", width: 96 },
  { key: "profit", width: 112 },
  { key: "gpPerHour", width: 108 },
] as const;

/** A row plus the skill it came from, so the table can show both. */
interface Row {
  activity: SkillActivity;
  skill: string;
}

function rowsFor(data: SkillingData, mode: SellMode): Row[] {
  const rows: Row[] = [];
  for (const catalog of data.skills) {
    const ranking =
      mode === "pessimistic" ? catalog.pessimistic : catalog.patient;
    for (const activity of ranking.opportunities) {
      rows.push({ activity, skill: catalog.skill });
    }
  }
  return rows;
}

function levelOf(row: Row): number | null {
  const skill = row.activity.skills.find(
    (entry) => entry.name.toLowerCase() === row.skill.toLowerCase(),
  );
  return skill?.level ?? null;
}

/**
 * Cooking rows only mean something at or above the food's no-burn level.
 * Without a level they are hidden rather than shown with a warning, because a
 * hidden gamble cannot be ranked.
 */
function isCookingRow(row: Row): boolean {
  return row.activity.noBurnLevel !== null;
}

export function SkillingPage(): JSX.Element {
  const initial = currentViewState();
  const [mode, setMode] = useState<SellMode>(() =>
    pickOne(initial.mode, MODES, DEFAULT_MODE),
  );
  const [kindFilter, setKindFilter] = useState<KindFilter>(() =>
    pickOne(initial.kind, KINDS, "all"),
  );
  const [skillFilter, setSkillFilter] = useState(initial.skill ?? "all");
  const [query, setQuery] = useState(initial.q ?? "");
  const [cookingLevel, setCookingLevel] = useState(
    initial.cookingLevel ?? DEFAULT_COOKING_LEVEL,
  );
  const [membersOnly, setMembersOnly] = useState(initial.members ?? false);
  const sort = useSort<SortKey>(
    pickOne(initial.sort, SORT_KEYS, "gpPerHour"),
    initial.desc ?? true,
  );
  const deferredQuery = useDeferredValue(normaliseQuery(query));

  const skills = useMemo(
    () => DATA.skills.map((entry) => entry.skill),
    [],
  );

  const all = useMemo(() => rowsFor(DATA, mode), [mode]);

  const { visible, hiddenCooking } = useMemo(() => {
    let hidden = 0;
    const filtered = all.filter((row) => {
      if (skillFilter !== "all" && row.skill !== skillFilter) return false;
      if (kindFilter !== "all" && row.activity.kind !== kindFilter) return false;
      if (membersOnly && !row.activity.members) return false;
      if (isCookingRow(row)) {
        const level = row.activity.noBurnLevel;
        if (level === null || cookingLevel < level) {
          hidden += 1;
          return false;
        }
      }
      const haystack = `${row.activity.outputName} ${row.skill} ${row.activity.inputs
        .map((item) => item.itemName)
        .join(" ")}`;
      return matchesQuery(deferredQuery, [haystack]);
    });
    return { visible: filtered, hiddenCooking: hidden };
  }, [all, skillFilter, kindFilter, membersOnly, cookingLevel, deferredQuery]);

  const sorted = useMemo(() => {
    const measure = (row: Row): number | null => {
      switch (sort.sortKey) {
        case "gpPerHour":
          return row.activity.gpPerHour;
        case "profit":
          return row.activity.profit;
        case "spend":
          return row.activity.spend;
        case "level":
          return levelOf(row);
        case "name":
          return null;
        case "skill":
          return null;
      }
    };
    const tieBreak = (a: Row, b: Row): number => {
      const byName = a.activity.outputName.localeCompare(b.activity.outputName);
      if (byName !== 0) return byName;
      return a.activity.recipeId.localeCompare(b.activity.recipeId);
    };
    if (sort.sortKey === "name") {
      return [...visible].sort((a, b) => {
        const byName = a.activity.outputName.localeCompare(
          b.activity.outputName,
        );
        return sort.descending ? -byName : byName;
      });
    }
    if (sort.sortKey === "skill") {
      return [...visible].sort((a, b) => {
        const bySkill = a.skill.localeCompare(b.skill);
        const ordered = bySkill !== 0 ? bySkill : tieBreak(a, b);
        return sort.descending ? -ordered : ordered;
      });
    }
    return sortByMeasure(visible, measure, sort.descending, tieBreak);
  }, [visible, sort]);

  const paged = usePagedRows(sorted);
  const pageRows = paged.pageRows;

  // The strip must agree with the table: kind and profit counts come from the rows
  // in the *current* mode, not from the build-time coverage line. Only `unpriced`
  // is a build-time fact, because it counts recipes that produced no row at all.
  const totals = useMemo(() => {
    let transform = 0;
    let upgrade = 0;
    let train = 0;
    let profitable = 0;
    for (const row of all) {
      if (row.activity.kind === 'upgrade') upgrade += 1;
      else if (row.activity.kind === 'train') train += 1;
      else transform += 1;
      if (row.activity.profit > 0) profitable += 1;
    }
    const unpriced = DATA.skills.reduce(
      (sum, catalog) => sum + catalog.coverage.unpriced,
      0,
    );
    return { transform, upgrade, train, profitable, unpriced };
  }, [all]);

  const view: ViewState = useMemo(
    () => ({
      mode,
      kind: kindFilter,
      skill: skillFilter,
      q: query,
      members: membersOnly,
      sort: sort.sortKey,
      desc: sort.descending,
      cookingLevel: cookingLevel > 0 ? cookingLevel : undefined,
    }),
    [mode, kindFilter, skillFilter, query, membersOnly, sort, cookingLevel],
  );
  useShareableView("skilling", view);

  const filtersActive =
    query.trim() !== "" ||
    kindFilter !== "all" ||
    skillFilter !== "all" ||
    membersOnly ||
    cookingLevel > 0;

  function clearFilters(): void {
    setQuery("");
    setKindFilter("all");
    setSkillFilter("all");
    setMembersOnly(false);
    setCookingLevel(DEFAULT_COOKING_LEVEL);
  }

  return (
    <>
      <FilterToolbar
        modeGroupLabel="Price mode"
        modes={MODES.map((id) => ({ id, label: MODE_LABEL[id] }))}
        mode={mode}
        onMode={(next) => setMode(next)}
        query={query}
        onQuery={setQuery}
        placeholder="Search items, inputs or skills…"
        searchLabel="Search activities"
        pricesAsOf={DATA.pricesAsOf}
        generatedAt={DATA.generatedAt}
        filtersActive={filtersActive}
        onClearFilters={clearFilters}
      >
        <label className="toggle" title="Only rows that make or sell this skill">
          Skill
          <select
            className="select"
            value={skillFilter}
            onChange={(event) => setSkillFilter(event.target.value)}
            aria-label="Skill filter"
          >
            <option value="all">All skills</option>
            {skills.map((skill) => (
              <option key={skill} value={skill}>
                {skill}
              </option>
            ))}
          </select>
        </label>

        <label className="toggle" title="Make & sell, upgrades, or cost-to-train">
          Kind
          <select
            className="select"
            value={kindFilter}
            onChange={(event) =>
              setKindFilter(event.target.value as KindFilter)
            }
            aria-label="Kind filter"
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_FILTER_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>

        <FilterNumber
          label="Cooking level"
          title="Cooking rows are hidden until your level is at or above each food's no-burn level. 0 hides them entirely."
          ariaLabel="Cooking level"
          step={1}
          value={cookingLevel}
          onChange={setCookingLevel}
        />

        <FilterCheck
          label="Members only"
          title="Hide free-to-play activities"
          checked={membersOnly}
          onChange={setMembersOnly}
        />
      </FilterToolbar>

      <section className="stats" aria-label="Coverage">
        <Stat
          label="Activities"
          value={all.length.toLocaleString()}
          accent
          title="Every priced activity in the artifact, both kinds"
        />
        <Stat
          label="Make & sell"
          value={totals.transform.toLocaleString()}
          title="Repeatable: buy inputs, make the output, sell it"
        />
        <Stat
          label="Upgrades"
          value={totals.upgrade.toLocaleString()}
          title="One-off conversions of a finished item — capital-heavy, not repeatable"
        />
        <Stat
          label="Cost to train"
          value={totals.train.toLocaleString()}
          title="Rows whose output cannot be sold, so the row is the cost of one action"
        />
        <Stat
          label="Profitable"
          value={totals.profitable.toLocaleString()}
          title="Rows with a positive per-action profit in the selected mode"
        />
        <Stat
          label="Unpriced"
          value={totals.unpriced.toLocaleString()}
          title="Candidates that produced no row: bucket recipes with no GE price on a leg, no 4h liquidity, a fractional quantity or a chance note, plus gathering nodes whose item has no market. Counted, never estimated."
        />
      </section>

      <p className="hint">
        Inputs are bought at the GE{" "}
        <strong>{mode === "pessimistic" ? "high" : "low"}</strong> and the output
        sold at the <strong>{mode === "pessimistic" ? "low" : "high"}</strong>,
        minus the 2% GE tax, so the default instant mode reads as a loss on most
        rows: instant execution crosses the spread on every action.
        {hiddenCooking > 0 && (
          <>
            {" "}
            <strong>{hiddenCooking}</strong> cooking{" "}
            {hiddenCooking === 1 ? "recipe is" : "recipes are"} hidden because
            your level is below their no-burn level — enter it above to price
            them.
          </>
        )}
      </p>

      <Results
        label="Skilling activities"
        noun="activities"
        paged={paged}
        emptyText={
          hiddenCooking > 0 && all.length > 0 ? (
            <>
              Nothing matches these filters. {hiddenCooking} cooking rows are hidden
              because your Cooking level is below their no-burn level.
            </>
          ) : (
            <>Nothing matches these filters.</>
          )
        }
        onClearFilters={clearFilters}
        busy={deferredQuery !== query}
      >
        <table className="results-table">
          <caption className="visually-hidden">
            Skilling activities, ranked by {sort.sortKey}
          </caption>
          <colgroup>
            {COLUMNS.map((column) => (
              <col
                key={column.key}
                className={column.key === "rank" ? "num-col" : undefined}
                style={{ width: column.width }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="num-col">
                #
              </th>
              <Th
                label="Activity"
                onClick={() => sort.toggle("name")}
                active={sort.sortKey === "name"}
                desc={sort.descending}
              />
              <Th
                label="Skill"
                onClick={() => sort.toggle("skill")}
                active={sort.sortKey === "skill"}
                desc={sort.descending}
              />
              <Th
                label="Level"
                onClick={() => sort.toggle("level")}
                active={sort.sortKey === "level"}
                desc={sort.descending}
                title="The level the recipe needs. Cooking rows also show the level at which the food stops burning."
              />
              <th scope="col">Inputs</th>
              <Th
                label="Cost / action"
                onClick={() => sort.toggle("spend")}
                active={sort.sortKey === "spend"}
                desc={sort.descending}
                right
              />
              <Th
                label="Profit / action"
                onClick={() => sort.toggle("profit")}
                active={sort.sortKey === "profit"}
                desc={sort.descending}
                right
              />
              <Th
                label="gp / hour"
                onClick={() => sort.toggle("gpPerHour")}
                active={sort.sortKey === "gpPerHour"}
                desc={sort.descending}
                right
                title="Per-action profit at the rate the wiki publishes, capped by 4h market volume. — when no action time is published."
              />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => (
              <ActivityRow
                key={`${row.skill}-${row.activity.recipeId}`}
                row={row}
                rank={paged.start + index}
              />
            ))}
          </tbody>
        </table>
      </Results>

      <footer className="footer">
        <details className="caveats">
          <summary>How these numbers are made</summary>
          <p>
            Every row is one repeatable action priced from the wiki&apos;s own
            recipe table: buy the inputs on the GE, make the output, sell it back
            and pay the 2% GE tax on the sale. <strong>Instant</strong> buys at
            the GE <strong>high</strong> and sells at the <strong>low</strong>;
            <strong> patient</strong> rests both offers. Coin fees charged by a
            tanner, sawmill or spell are included.
          </p>
          <p>
            <strong>Three kinds, three meanings.</strong>{" "}
            <span className="kind-badge kind-transform">Make</span> is a sale you
            can repeat. <span className="kind-badge kind-upgrade">Upgrade</span>{" "}
            re-works one finished item into a better version of itself — still a
            sale, but millions of capital and a handful of conversions a day, so
            it is not ranked against training.{" "}
            <span className="kind-badge kind-train">Cost</span> builds something
            that cannot be sold, so the row is what the action costs you.
          </p>
          <p>
            <strong>What is missing is missing on purpose.</strong> High-alch and
            shop sale are not modelled, so alchable output looks worse here than
            it is. Banking and travel to a range or furnace are not modelled, so
            gp / hour is an upper bound. A recipe with no GE price on a leg, no 4h
            liquidity, a fractional quantity or a chance note is excluded and
            counted in the strip above, never estimated. Cooking rows appear only
            at or above the level where the food stops burning.
          </p>
        </details>
      </footer>
    </>
  );
}

function ActivityRow(props: { row: Row; rank: number }): JSX.Element {
  const { activity, skill } = props.row;
  const level = levelOf(props.row);
  const inputs =
    activity.inputs
      .map((item) => `${item.itemName} ×${item.quantity}`)
      .join(" + ") || "—";
  const output =
    activity.output === null
      ? `${activity.outputName} (not sold)`
      : `${activity.outputName}${
          activity.output.quantity !== 1 ? ` ×${activity.output.quantity}` : ""
        }`;

  return (
    <tr>
      <td className="right mono dim">{props.rank}</td>
      <td className="item">
        <span
          className={`kind-badge kind-${activity.kind}`}
          title={KIND_TITLE[activity.kind]}
        >
          {KIND_LABEL[activity.kind]}
        </span>{" "}
        <a
          className="name wiki-link"
          href={activity.source}
          target="_blank"
          rel="noopener noreferrer"
        >
          {output}
        </a>
        {activity.members && <span className="badge">P2P</span>}
        {activity.feeGp > 0 && (
          <span className="cell-note">+{formatGp(activity.feeGp)} gp fee</span>
        )}
      </td>
      <td>{skill}</td>
      <td className="mono dim">
        {level === null ? "—" : level}
        {activity.noBurnLevel !== null && (
          <span className="cell-note" title="Level at which this food stops burning">
            safe {activity.noBurnLevel}
          </span>
        )}
      </td>
      <td className="dim wrap">{inputs}</td>
      <td className="right mono">{formatGp(activity.spend)}</td>
      <td
        className={
          activity.profit >= 0 ? "right mono pos" : "right mono neg"
        }
        title={`${activity.marginPct.toFixed(1)}% of the cost`}
      >
        {formatGp(activity.profit)}
        <span className="cell-note">{activity.marginPct.toFixed(0)}%</span>
      </td>
      <td className="right mono strong">
        {activity.gpPerHour === null
          ? "—"
          : formatGp(Math.round(activity.gpPerHour))}
      </td>
    </tr>
  );
}
