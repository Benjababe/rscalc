import { useEffect, useMemo, useState } from "react";

import type {
  ProcessOpportunity,
  ProcessPayload,
  SellMode,
} from "../../src/types";
import {
  actions4hForRate,
  actionsPerHour,
  capActionsPerHour,
} from "../../src/domain/processTime";
import { wikiUrl } from "../../src/util/wiki";
import { compact, formatGp, formatSourceDateTime, formatTime } from "./format";
import { GoldInput } from "./GoldInput";
import {
  browserStore,
  readStoredBudget,
  writeStoredBudget,
  type BudgetState,
} from "./storage";
import { Stat, Th, Results, StaleWarning } from "./ui";
import { usePagedRows } from "./paging";
import {
  ColumnPicker,
  useColumnVisibility,
  type ColumnDef,
} from "./columns";

import payload from "../../data/process.json";

/** Column definitions: labels, default widths and the keys used by the picker. */
const PROCESSING_COLUMNS: readonly ColumnDef[] = [
  { key: "rank", label: "#", width: 44 },
  { key: "output", label: "Output", width: 230, required: true },
  { key: "inputs", label: "Inputs", width: 230 },
  { key: "skill", label: "Skill", width: 110 },
  { key: "cost", label: "Cost / action", width: 100 },
  { key: "netSell", label: "Net sell", width: 100 },
  { key: "profitAction", label: "Profit / action", width: 100 },
  { key: "actions4h", label: "Actions / 4h", width: 92 },
  { key: "actionsHour", label: "Actions / hour", width: 110 },
  { key: "spend", label: "Spend", width: 110 },
  { key: "profit4h", label: "Profit / 4h", width: 110 },
  { key: "gpPerHour", label: "gp / hour", width: 120 },
];

type SortKey =
  | "gpPerHour"
  | "profitPer4h"
  | "profitPerAction"
  | "marginPct"
  | "actions"
  | "actionsPerHour"
  | "spend"
  | "spendPerAction"
  | "netRevenue"
  | "outputName"
  | "skill";

/** What ended the 4h plan: the recipe, the GE, or the user's gold. */
type Binding = "time" | "market" | "budget" | "unknown-time";

interface RowData {
  opp: ProcessOpportunity;
  actions: number;
  spend: number;
  profit: number;
  gpPerHour: number | null;
  binding: Binding;
  /** The wiki's published action rate for this recipe. */
  recipeActionsPerHour: number | null;
  /** The rate actually used after the player's Actions / hour cap. */
  rateUsed: number | null;
  /** Effective plan rate after GE/gold caps, or null when time is unknown. */
  planActionsPerHour: number | null;
}

const MODE_LABEL: Record<SellMode, string> = {
  pessimistic: "Instant",
  patient: "Patient",
};

const MODE_TITLE: Record<SellMode, string> = {
  pessimistic: "Instant buy at the GE high, instant sell at the GE low",
  patient: "Rest a buy at the GE low, rest a sell at the GE high",
};

const BINDING_LABEL: Record<Binding, string> = {
  time: "time cap",
  market: "GE cap",
  budget: "gold",
  "unknown-time": "market cap",
};

// SAFETY: `data/process.json` is only written by `scripts/refresh-process.ts`,
// which validates the payload with `ProcessPayloadSchema` before writing it.
const DATA = payload as unknown as ProcessPayload;

/**
 * Item processing: buy the inputs on the GE, perform a deterministic recipe,
 * sell the output back to the GE. The artifact holds both price modes; all
 * filtering, gold sizing and sorting happen in the browser.
 *
 * The page is deliberately explicit about what it does *not* model: banking,
 * travel to a furnace/spinning wheel/sawmill, tool acquisition, quest access,
 * and chance-based yields. See the caveats under the table.
 */
export function ProcessingPage(): JSX.Element {
  const [mode, setMode] = useState<SellMode>("pessimistic");
  const [query, setQuery] = useState("");
  const [membersOnly, setMembersOnly] = useState(false);
  const [skill, setSkill] = useState("all");
  const [minProfit, setMinProfit] = useState(0);
  const [actionsPerHourCap, setActionsPerHourCap] = useState(0);
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
  } = useColumnVisibility("processing", PROCESSING_COLUMNS);

  // The same storage key as the shop pages: gold and the budget/shop view are
  // shared, so opening this page does not reset a choice made elsewhere.
  useEffect(() => {
    writeStoredBudget({ gold, view: storedView }, browserStore());
  }, [gold, storedView]);

  const ranking = DATA[mode];

  const skillOptions = useMemo(() => {
    const names = new Set<string>([
      ...DATA.pessimistic.filters.skills,
      ...DATA.patient.filters.skills,
    ]);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, []);

  const rows = useMemo<RowData[]>(() => {
    const needle = query.trim().toLowerCase();
    const planned: RowData[] = [];

    for (const opp of ranking.opportunities) {
      if (membersOnly && !opp.members) continue;
      if (skill === "none") {
        if (opp.skills.length > 0) continue;
      } else if (skill !== "all") {
        if (!opp.skills.some((entry) => entry.name.toLowerCase() === skill)) {
          continue;
        }
      }
      if (opp.profit < minProfit) continue;

      if (needle !== "") {
        const haystack = [
          opp.output.itemName,
          ...opp.inputs.map((input) => input.itemName),
          opp.method ?? "",
          opp.facility ?? "",
          opp.tools ?? "",
          ...opp.skills.map((entry) => entry.name),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) continue;
      }

      // Gold caps the number of actions, as do the GE's supply/demand windows
      // and the recipe's own action time (or the player's actions/hour cap).
      // The smallest cap is the plan.
      const budgetActions =
        gold > 0 && opp.spend > 0
          ? Math.floor(gold / opp.spend)
          : Number.POSITIVE_INFINITY;
      const recipeActionsPerHour = actionsPerHour(opp.secondsPerAction);
      const rateUsed = capActionsPerHour(
        recipeActionsPerHour,
        actionsPerHourCap,
      );
      const timeActions4h = actions4hForRate(rateUsed);
      const timeCap = timeActions4h ?? Number.POSITIVE_INFINITY;
      const actions = Math.min(opp.marketActions4h, timeCap, budgetActions);
      if (actions < 1) continue;

      const planSpend = actions * opp.spend;
      const planProfit = actions * opp.profit;
      const gpPerHour = rateUsed === null ? null : planProfit / 4;
      const planActionsPerHour =
        rateUsed === null ? null : actions / 4;

      let binding: Binding;
      if (budgetActions < Math.min(opp.marketActions4h, timeCap)) {
        binding = "budget";
      } else if (rateUsed === null) {
        binding = "unknown-time";
      } else if (timeCap <= opp.marketActions4h) {
        binding = "time";
      } else {
        binding = "market";
      }

      planned.push({
        opp,
        actions,
        spend: planSpend,
        profit: planProfit,
        gpPerHour,
        binding,
        recipeActionsPerHour,
        rateUsed,
        planActionsPerHour,
      });
    }

    const measure = (row: RowData): number | null => {
      switch (sortKey) {
        case "gpPerHour":
          return row.gpPerHour;
        case "profitPer4h":
          return row.profit;
        case "profitPerAction":
          return row.opp.profit;
        case "marginPct":
          return row.opp.marginPct;
        case "actions":
          return row.actions;
        case "actionsPerHour":
          return row.rateUsed;
        case "spend":
          return row.spend;
        case "spendPerAction":
          return row.opp.spend;
        case "netRevenue":
          return row.opp.netRevenue;
        case "outputName":
        case "skill":
          return null;
        default:
          return null;
      }
    };

    return planned.sort((a, b) => {
      if (sortKey === "outputName") {
        const byName = a.opp.output.itemName.localeCompare(
          b.opp.output.itemName,
        );
        if (byName !== 0) return descending ? -byName : byName;
      } else if (sortKey === "skill") {
        const aSkill = a.opp.skills[0]?.name ?? "";
        const bSkill = b.opp.skills[0]?.name ?? "";
        const bySkill = aSkill.localeCompare(bSkill);
        if (bySkill !== 0) return descending ? -bySkill : bySkill;
      } else {
        const aValue = measure(a);
        const bValue = measure(b);
        if (aValue === null || bValue === null) {
          if (aValue !== bValue) {
            // Unknown time is never better than a known time, whichever way the
            // column is sorted.
            return aValue === null ? 1 : -1;
          }
        } else if (aValue !== bValue) {
          return descending ? bValue - aValue : aValue - bValue;
        }
      }

      const byOutput = a.opp.output.itemName.localeCompare(
        b.opp.output.itemName,
      );
      if (byOutput !== 0) return byOutput;
      return a.opp.recipeId.localeCompare(b.opp.recipeId);
    });
  }, [
    ranking,
    query,
    membersOnly,
    skill,
    minProfit,
    actionsPerHourCap,
    gold,
    sortKey,
    descending,
  ]);

  const paged = usePagedRows(rows);

  if (DATA.pessimistic.count === 0 && DATA.patient.count === 0) {
    return (
      <div className="page">
        <p className="empty">
          No profitable processing recipes are in this snapshot. Rebuild it
          with <code>pnpm process</code>.
        </p>
      </div>
    );
  }

  const bestRate = rows.reduce<RowData | undefined>((best, row) => {
    if (row.gpPerHour === null) return best;
    if (best === undefined) return row;
    return row.gpPerHour > (best.gpPerHour ?? Number.NEGATIVE_INFINITY)
      ? row
      : best;
  }, undefined);

  const bestProfitPerAction = rows.reduce<RowData | undefined>(
    (best, row) =>
      best === undefined || row.opp.profit > best.opp.profit ? row : best,
    undefined,
  );

  const bestProfit4h = rows.reduce<RowData | undefined>(
    (best, row) =>
      best === undefined || row.profit > best.profit ? row : best,
    undefined,
  );

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setDescending((value) => !value);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  /** Reset every filter, leaving the mode, sort and budget settings alone. */
  const clearFilters = (): void => {
    setQuery("");
    setMembersOnly(false);
    setSkill("all");
    setMinProfit(0);
  };
  const filtersActive =
    query.trim() !== "" || membersOnly || skill !== "all" || minProfit > 0;

  return (
    <div className="page">
      <section className="toolbar" aria-label="Filters">
        <div className="toolbar-row">
          <div className="modes" role="group" aria-label="Price mode">
            {(["pessimistic", "patient"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={candidate === mode ? "mode active" : "mode"}
                onClick={() => setMode(candidate)}
                aria-pressed={candidate === mode}
                title={MODE_TITLE[candidate]}
              >
                {MODE_LABEL[candidate]}
              </button>
            ))}
          </div>

          <input
            className="search"
            type="search"
            placeholder="Filter by output, input, method, facility or skill…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter recipes"
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
            <StaleWarning iso={ranking.pricesAsOf} />
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

          <label className="toggle">
            Skill
            <select
              className="select"
              value={skill}
              onChange={(event) => setSkill(event.target.value)}
              aria-label="Skill filter"
            >
              <option value="all">All skills</option>
              <option value="none">No skill (facility)</option>
              {skillOptions.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="toggle" title="Minimum profit for one action, before sizing">
            Min profit / action
            <input
              className="num"
              type="number"
              min={0}
              step={1}
              value={minProfit}
              onChange={(event) =>
                setMinProfit(Math.max(0, Number(event.target.value) || 0))
              }
              aria-label="Minimum profit per action"
            />
          </label>

          {filtersActive && (
            <button
              type="button"
              className="chip-clear"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}

          <span className="toolbar-spacer" />

          <ColumnPicker
            columns={PROCESSING_COLUMNS}
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
                <GoldInput value={gold} onChange={setGold} />
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
            className="toggle"
            title="Cap every recipe's published action rate to model slower play. It can only slow a recipe down; 0 uses the wiki's rate."
          >
            <span className="label">Actions / hour cap</span>
            <span className="field-control">
              <input
                className="num wide"
                type="number"
                min={0}
                step={100}
                value={actionsPerHourCap}
                onChange={(event) =>
                  setActionsPerHourCap(
                    Math.max(0, Number(event.target.value) || 0),
                  )
                }
                aria-label="Actions per hour cap"
              />
              <span className="field-unit">0 = recipe</span>
            </span>
          </label>
        </div>

        <p className="hint">
          Buy the inputs at the GE{" "}
          <strong>{mode === "pessimistic" ? "high" : "low"}</strong> and sell the
          output at the <strong>{mode === "pessimistic" ? "low" : "high"}</strong>.
          Coin fees (tanners, sawmills) and the runes consumed by a spell are
          included, and the output leg pays the 2% GE tax. The 4h plan is capped
          by the input&apos;s buy limit and 24h volume, the output&apos;s 24h
          volume, the wiki&apos;s published ticks, your <strong>Actions / hour
          cap</strong> and your gold.{" "}
          <strong>Banking and travel to the facility are not modelled</strong>, so
          gp / hour is a processing-only ceiling.{" "}
          {actionsPerHourCap > 0 ? (
            <>
              Capping every recipe at{" "}
              <strong>{formatGp(actionsPerHourCap)} actions/hour</strong> for
              slower play.{" "}
            </>
          ) : (
            <>
              Using each recipe&apos;s published action rate; set a lower{" "}
              <strong>Actions / hour cap</strong> to model slower play.{" "}
            </>
          )}
          {gold > 0 ? (
            <>
              Sizing to <strong>{formatGp(gold)} gp</strong>; clear to 0 for the
              uncapped plan.
            </>
          ) : (
            <>Showing the uncapped plan; enter gold to size it.</>
          )}
        </p>
      </section>

      <section className="stats">
        <Stat label="Recipes" value={rows.length.toLocaleString()} />
        <Stat
          label="Best gp / hour"
          value={
            bestRate?.gpPerHour != null
              ? formatGp(Math.round(bestRate.gpPerHour))
              : "—"
          }
          title={
            bestRate
              ? `${bestRate.opp.output.itemName}${bestRate.opp.method === null ? "" : ` (${bestRate.opp.method})`}`
              : "No filtered recipe has a published tick time"
          }
          accent
        />
        <Stat
          label="Best profit / action"
          value={
            bestProfitPerAction === undefined
              ? "—"
              : `${formatGp(bestProfitPerAction.opp.profit)} gp`
          }
          title={bestProfitPerAction?.opp.output.itemName}
        />
        <Stat
          label="Best profit / 4h"
          value={
            bestProfit4h === undefined
              ? "—"
              : `${formatGp(bestProfit4h.profit)} gp`
          }
          title={
            bestProfit4h
              ? `${bestProfit4h.opp.output.itemName}${
                  bestProfit4h.binding === "unknown-time"
                    ? " (market cap; no published tick time)"
                    : ""
                }`
              : undefined
          }
        />
      </section>

      <Results
        label="Deterministic processing recipes"
        paged={paged}
        noun="recipes"
        emptyText="No recipes match these filters. Try clearing the minimum profit or raising your gold."
        onClearFilters={clearFilters}
      >
        <table className="results-table">
          <caption className="visually-hidden">
            Deterministic processing recipes, ranked by profit
          </caption>
          <colgroup>
            {PROCESSING_COLUMNS.filter((column) => visible.has(column.key)).map(
              (column) => (
                <col
                  key={column.key}
                  className={column.key === "rank" ? "num-col" : undefined}
                  style={{ width: column.width }}
                />
              ),
            )}
          </colgroup>
          <thead>
            <tr>
              {visible.has("rank") && (
                <th scope="col" className="num-col">
                  #
                </th>
              )}
              {visible.has("output") && (
                <Th
                  label="Output"
                  onClick={() => toggleSort("outputName")}
                  active={sortKey === "outputName"}
                  desc={descending}
                  title="The item produced; click to sort"
                />
              )}
              {visible.has("inputs") && <th scope="col">Inputs</th>}
              {visible.has("skill") && (
                <Th
                  label="Skill"
                  onClick={() => toggleSort("skill")}
                  active={sortKey === "skill"}
                  desc={descending}
                  title="Primary skill requirement; all requirements are in the tooltip"
                />
              )}
              {visible.has("cost") && (
                <Th
                  label="Cost / action"
                  onClick={() => toggleSort("spendPerAction")}
                  active={sortKey === "spendPerAction"}
                  desc={descending}
                  title="Item inputs plus any Coin fee for one action"
                  right
                />
              )}
              {visible.has("netSell") && (
                <Th
                  label="Net sell"
                  onClick={() => toggleSort("netRevenue")}
                  active={sortKey === "netRevenue"}
                  desc={descending}
                  title="Output value after the 2% GE tax"
                  right
                />
              )}
              {visible.has("profitAction") && (
                <Th
                  label="Profit / action"
                  onClick={() => toggleSort("profitPerAction")}
                  active={sortKey === "profitPerAction"}
                  desc={descending}
                  title="Net output minus the input cost and fee"
                  right
                />
              )}
              {visible.has("actions4h") && (
                <Th
                  label="Actions / 4h"
                  onClick={() => toggleSort("actions")}
                  active={sortKey === "actions"}
                  desc={descending}
                  title="The smallest of the GE supply/demand cap, the recipe's action time and your gold"
                  right
                />
              )}
              {visible.has("actionsHour") && (
                <Th
                  label="Actions / hour"
                  onClick={() => toggleSort("actionsPerHour")}
                  active={sortKey === "actionsPerHour"}
                  desc={descending}
                  title="Rate used: the recipe's published action rate, capped by your Actions / hour input. The cell note shows the effective plan rate when GE or gold caps reduce it; — when ticks are unknown."
                  right
                />
              )}
              {visible.has("spend") && (
                <Th
                  label="Spend"
                  onClick={() => toggleSort("spend")}
                  active={sortKey === "spend"}
                  desc={descending}
                  title="Coins spent across the 4h plan, including fees"
                  right
                />
              )}
              {visible.has("profit4h") && (
                <Th
                  label="Profit / 4h"
                  onClick={() => toggleSort("profitPer4h")}
                  active={sortKey === "profitPer4h"}
                  desc={descending}
                  title="Profit across the effective 4h plan"
                  right
                />
              )}
              {visible.has("gpPerHour") && (
                <Th
                  label="gp / hour"
                  onClick={() => toggleSort("gpPerHour")}
                  active={sortKey === "gpPerHour"}
                  desc={descending}
                  title="Profit over a 4h window, after action time and GE caps; excludes banking and travel to the facility"
                  right
                />
              )}
            </tr>
          </thead>
          <tbody>
            {paged.pageRows.map((row, index) => (
              <Row
                key={row.opp.recipeId}
                data={row}
                rank={paged.start + index}
                visible={visible}
              />
            ))}
          </tbody>
        </table>
      </Results>

      <footer className="footer">
        <details className="caveats">
          <summary>Assumptions &amp; caveats</summary>
          <p>
            <strong>Source.</strong> Recipes come from the wiki&apos;s{" "}
            <a
              className="wiki-link"
              href="https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe"
              target="_blank"
              rel="noopener noreferrer"
            >
              recipe bucket
            </a>
            , which is written by{" "}
            <a
              className="wiki-link"
              href="https://oldschool.runescape.wiki/w/Template:Recipe"
              target="_blank"
              rel="noopener noreferrer"
            >
              Template:Recipe
            </a>
            . Every material and the output must have a GE price; an unpriced or
            untradeable item removes the row rather than being estimated. The
            bucket stores only the primary output, so a recipe with a secondary
            product may be understated.
          </p>
          <p>
            <strong>Deterministic recipes only.</strong> Cooking is excluded
            because burn chance depends on your level and the food. A recipe
            whose wiki quantity note mentions a chance, average, range, level
            scaling or expected amount is also excluded, as is any fractional
            quantity. This page answers &quot;what does one action transform,
            exactly&quot;, not &quot;what is my expected yield at 99&quot;.
          </p>
          <p>
            <strong>Prices and fees.</strong> Instant mode buys inputs at the
            latest <code>high</code> and sells the output at the latest{" "}
            <code>low</code>; patient mode rests a buy at <code>low</code> and a
            sell at <code>high</code>. Coin fees to tanners and sawmills, and
            the runes or other items a spell consumes, are included, and the
            output leg pays the 2% GE tax (capped at 5,000,000 gp per item,
            exempt under 50 gp). Inputs are not taxed.
          </p>
          <p>
            <strong>Throughput.</strong> Input actions are capped by the GE 4h
            buy limit and the 24h volume on the buy side; output actions are
            capped by the 24h volume on the sell side, never by the output&apos;s
            buy limit — a buy limit caps purchases, not sales. The 4h volumes are
            floored to whole units. <strong>Actions / 4h</strong> is the smallest
            of those caps, the recipe&apos;s action time and your gold.
          </p>
          <p>
            <strong>Time.</strong> Seconds per action come from the wiki&apos;s
            published ticks (one tick is 0.6s); a zero-tick action is treated as
            eight actions per tick, matching{" "}
            <a
              className="wiki-link"
              href="https://oldschool.runescape.wiki/w/Module:Recipe"
              target="_blank"
              rel="noopener noreferrer"
            >
              Module:Recipe
            </a>
            . Where the wiki does not publish ticks, <strong>gp / hour</strong> is{" "}
            <strong>—</strong> rather than assuming a rate. <strong>Actions / 4h</strong>{" "}
            is the effective plan; <strong>Actions / hour</strong> is the rate used:
            the recipe&apos;s published rate capped by your{" "}
            <strong>Actions / hour cap</strong> (0 uses the recipe rate). A lower
            cap models inefficient play and can only slow a recipe down, never
            speed it up. The cell note shows the effective plan rate when GE or
            gold caps reduce it further. Where ticks are unknown, both rates are{" "}
            <strong>—</strong> and only the market cap is shown. Banking, travel
            to the facility and buying tools are <strong>not modelled</strong>, so
            the hourly figure is a processing-only ceiling. Skill levels are shown
            but not checked, and quest/area access is not checked.
          </p>
          <p>
            <strong>Gold.</strong> The amount is shared with the{" "}
            <strong>Shop → GE</strong> and <strong>GE → shop</strong> pages
            through <code>rscalc.budget</code>; 0 means no cap. A row marked{" "}
            <strong>gold</strong> was cut by your budget rather than by the
            recipe or the GE. Prices are snapshots: thin markets, and high-value
            items with very low volume, can move before an order fills.
          </p>
        </details>
      </footer>
    </div>
  );
}

function Row({
  data,
  rank,
  visible,
}: {
  data: RowData;
  rank: number;
  visible: ReadonlySet<string>;
}): JSX.Element {
  const {
    opp,
    actions,
    spend,
    profit,
    gpPerHour,
    binding,
    recipeActionsPerHour,
    rateUsed,
    planActionsPerHour,
  } = data;
  const firstSkill = opp.skills[0];
  const skillText =
    firstSkill === undefined
      ? "—"
      : `${firstSkill.name}${
          firstSkill.level === null ? "" : ` ${firstSkill.level}`
        }`;
  const skillTitle =
    opp.skills.length === 0
      ? "No skill requirement (facility work)"
      : opp.skills
          .map(
            (entry) =>
              `${entry.name}${entry.level === null ? "" : ` ${entry.level}`}`,
          )
          .join(", ");
  const detail = [...new Set([opp.method, opp.facility])]
    .filter((value): value is string => value !== null && value !== "")
    .join(" · ");
  const outputTitle =
    opp.tools === null ? undefined : `Tools required: ${opp.tools}`;
  const bindingTitle = bindingTitleFor(binding);
  const rateText = (value: number): string =>
    `${formatGp(Math.round(value))}/hour`;
  const actionsPerHourTitle =
    rateUsed === null
      ? "No published tick time, so the recipe's action rate is unknown"
      : [
          `Recipe ${
            recipeActionsPerHour === null
              ? "unknown"
              : rateText(recipeActionsPerHour)
          }`,
          recipeActionsPerHour !== null && rateUsed < recipeActionsPerHour
            ? `capped at ${rateText(rateUsed)}`
            : null,
          planActionsPerHour === null
            ? null
            : `plan ${rateText(planActionsPerHour)}`,
          bindingTitle,
        ]
          .filter((part): part is string => part !== null)
          .join(" · ");
  const gpTitle =
    gpPerHour === null
      ? "The wiki does not publish a tick time for this recipe, so gp / hour is not computed"
      : "Profit over a 4h window after the recipe rate (or your Actions / hour cap), GE caps and gold; excludes banking and travel to the facility";
  const costBreakdown = [
    ...opp.inputs.map(
      (input) =>
        `${input.quantity}× ${input.itemName} @ ${formatGp(input.price)} = ${formatGp(
          input.quantity * input.price,
        )} gp`,
    ),
    ...(opp.feeGp > 0 ? [`Coin fee: ${formatGp(opp.feeGp)} gp`] : []),
    `Total: ${formatGp(opp.spend)} gp`,
  ].join("\n");

  return (
    <tr>
      {visible.has("rank") && <td className="num-col">{rank}</td>}
      {visible.has("output") && (
        <td className="item" title={outputTitle}>
          <a
            className="name wiki-link"
            href={wikiUrl(opp.output.itemName)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {opp.output.itemName}
          </a>
          {opp.output.quantity !== 1 && (
            <span className="qty">× {opp.output.quantity}</span>
          )}
          {opp.members && <span className="badge">P2P</span>}
          <span className="cell-note">
            {detail !== "" ? `${detail} · ` : ""}
            <a
              className="wiki-link recipe-link"
              href={opp.source}
              target="_blank"
              rel="noopener noreferrer"
            >
              recipe
            </a>
          </span>
        </td>
      )}
      {visible.has("inputs") && (
        <td className="inputs">
          <span className="input-list">
            {opp.inputs.map((input) => (
              <span
                key={input.itemId}
                className="input-line"
                title={`Buy ${formatGp(input.price)} gp each · 4h volume ${formatGp(
                  input.volume4h,
                )}${input.geBuyLimit === null ? "" : ` · buy limit ${formatGp(input.geBuyLimit)}`}`}
              >
                <span className="input-name">
                  <span className="mono">{input.quantity}×</span>{" "}
                  <a
                    className="wiki-link"
                    href={wikiUrl(input.itemName)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {input.itemName}
                  </a>
                </span>
                <span className="input-cost">
                  @ {formatGp(input.price)} each ·{" "}
                  {formatGp(input.quantity * input.price)} gp
                </span>
              </span>
            ))}
            {opp.feeGp > 0 && (
              <span className="input-line dim">
                + {formatGp(opp.feeGp)} gp fee
              </span>
            )}
          </span>
        </td>
      )}
      {visible.has("skill") && (
        <td className="skill" title={skillTitle}>
          {skillText}
          {opp.skills.length > 1 && (
            <span className="cell-note">+{opp.skills.length - 1} more</span>
          )}
        </td>
      )}
      {visible.has("cost") && (
        <td className="right mono" title={costBreakdown}>
          <span className="breakdown-total">{formatGp(opp.spend)}</span>
          {opp.feeGp > 0 && (
            <span className="cell-note">incl. {formatGp(opp.feeGp)} fee</span>
          )}
        </td>
      )}
      {visible.has("netSell") && (
        <td
          className="right mono"
          title={`Gross ${formatGp(opp.grossRevenue)} − tax ${formatGp(opp.tax)}`}
        >
          {formatGp(opp.netRevenue)}
          {opp.tax > 0 && (
            <span className="cell-note">tax {formatGp(opp.tax)}</span>
          )}
        </td>
      )}
      {visible.has("profitAction") && (
        <td className="right mono pos">
          {formatGp(opp.profit)}
          <span className="cell-note">{opp.marginPct.toFixed(1)}%</span>
        </td>
      )}
      {visible.has("actions4h") && (
        <td className="right mono" title={bindingTitle}>
          {actions.toLocaleString()}
          <span className="cell-note">{BINDING_LABEL[binding]}</span>
        </td>
      )}
      {visible.has("actionsHour") && (
        <td className="right mono" title={actionsPerHourTitle}>
          {rateUsed === null ? "—" : formatGp(Math.round(rateUsed))}
          {rateUsed !== null &&
            planActionsPerHour !== null &&
            Math.round(planActionsPerHour) !== Math.round(rateUsed) && (
              <span className="cell-note">
                plan {formatGp(Math.round(planActionsPerHour))}
              </span>
            )}
        </td>
      )}
      {visible.has("spend") && (
        <td
          className="right mono"
          title={
            binding === "unknown-time"
              ? "Market-cap spend; the wiki does not publish a tick time"
              : "Coins spent across the effective 4h plan"
          }
        >
          {formatGp(spend)}
          {binding === "budget" && <span className="cell-note">your gold</span>}
        </td>
      )}
      {visible.has("profit4h") && (
        <td
          className="right mono pos"
          title={
            binding === "unknown-time"
              ? "Market-cap profit; the wiki does not publish a tick time"
              : undefined
          }
        >
          {formatGp(profit)}
        </td>
      )}
      {visible.has("gpPerHour") && (
        <td className="right mono strong" title={gpTitle}>
          {gpPerHour === null ? "—" : formatGp(Math.round(gpPerHour))}
        </td>
      )}
    </tr>
  );
}

function bindingTitleFor(binding: Binding): string {
  switch (binding) {
    case "time":
      return "The recipe's action time or your Actions / hour cap limits the 4h plan before the GE";
    case "market":
      return "The GE buy limit or 24h volume caps the 4h plan before action time";
    case "budget":
      return "Your available gold caps the plan";
    case "unknown-time":
      return "The wiki does not publish a tick time; actions are the market cap and gp / hour is not computed";
  }
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}
