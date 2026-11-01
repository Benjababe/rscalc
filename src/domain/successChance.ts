/**
 * The skilling success function, and the cascaded distribution it produces.
 *
 * Source: <https://oldschool.runescape.wiki/w/Skilling_success_chart>. Every
 * level-scaled skilling roll in the game — a pickpocket, a fishing attempt, a
 * trap, a butterfly — is parameterised by two numbers the wiki publishes per
 * action, a `low` (odds at level 1) and a `high` (odds at level 99), and the
 * published formula is:
 *
 *     P(level) = (1 + floor(low * (99 - level) / 98
 *                          + high * (level - 1) / 98
 *                          + 0.5)) / 256
 *
 * clamped to 0..1. That is an exact integer expression, so it is reproduced with
 * `Math.floor`, not rounded differently: the wiki's worked example (monkfish,
 * low 48 / high 90, level 74) gives exactly 80/256 = 0.3125.
 *
 * **Cascading charts.** Some activities roll several of these in order, best
 * reward first, stopping at the first success ("barbarian fishing", Herbiboar).
 * The wiki documents that as a cascade
 * (<https://oldschool.runescape.wiki/w/Skilling_success_chart#Cascading_chances>),
 * so the distribution is `P_i * PRODUCT_{j<i} (1 - P_j)` per option, and the
 * remainder is "nothing". This is a sourced distribution, which is why an EV row
 * may be published from it (`docs/skilling-plan.md` §3.1).
 *
 * A chart is *not* an action time. It says how often an attempt succeeds, not how
 * often an attempt happens, so a row built from a chart still needs a published
 * attempt interval or it keeps `gpPerHour = null`.
 */

/** One option from a `{{Skilling success chart}}`: the two parameters and its level gate. */
export interface SuccessChartOption {
  /** The chart's label, e.g. `Raw monkfish` or `Normal`. */
  label: string;
  /** The `low` parameter: the roll's value at level 1, out of 256. */
  low: number;
  /** The `high` parameter: the roll's value at level 99, out of 256. */
  high: number;
  /** The level the activity becomes available at, from the chart's `req`. */
  requiredLevel: number;
}

/** A chart as parsed from a page: its options, best reward first. */
export interface SuccessChart {
  /** The chart's own label, e.g. `Monkfish fishing chance`. */
  label: string | null;
  /** True when the page marks the chart `cascade=yes`. */
  cascade: boolean;
  options: SuccessChartOption[];
}

/**
 * The roll's raw value out of 256 at a level — the numerator *before* the divide,
 * clamped to 0..256.
 */
export function successValueAt(
  option: Pick<SuccessChartOption, 'low' | 'high'>,
  level: number,
): number {
  const clamped = Math.min(99, Math.max(1, level));
  const scaled =
    (option.low * (99 - clamped)) / 98 + (option.high * (clamped - 1)) / 98;
  return Math.min(256, Math.max(0, 1 + Math.floor(scaled + 0.5)));
}

/** The probability that one roll of this option succeeds at a level. */
export function successChanceAt(
  option: Pick<SuccessChartOption, 'low' | 'high'>,
  level: number,
): number {
  return successValueAt(option, level) / 256;
}

/**
 * The chart option that belongs to a level.
 *
 * A chart can hold several options for two different reasons, and they need
 * different readings:
 *
 *  - **variants of one action at one level** — `Man`'s pickpocket chart lists
 *    `Normal`, `Gloves of silence`, `Ardougne Diary` and `Thieving cape + Ardougne
 *    Diary`, all gated at level 1 except the cape. The plain one is first, which is
 *    what a row prices (no gear assumed).
 *  - **one option per creature colour** — the chinchompa chart lists `Grey` (req
 *    53), `Red` (req 63) and `Black` (req 73). Taking the first option there would
 *    price grey-chinchompa odds for a carnivorous (red) chinchompa.
 *
 * So the rule is: the first option whose `req` equals the level the page states for
 * this activity, and the first option when none matches. Page order breaks the tie,
 * which keeps the `Normal` entry ahead of the gear variants.
 */
export function chartOptionAtLevel(
  chart: SuccessChart,
  level: number | null,
): SuccessChartOption | null {
  if (level !== null) {
    const exact = chart.options.find((option) => option.requiredLevel === level);
    if (exact !== undefined) return exact;
  }
  return chart.options[0] ?? null;
}

/**
 * The outcome distribution of one attempt at a level.
 *
 * A single-option chart is one roll: `chance` is the success chance and the rest
 * is nothing, which is why the returned chances need not sum to one. A cascaded
 * chart is rolled best-first, so each option's chance is discounted by the chance
 * that an earlier, better option already succeeded.
 *
 * Options are used in the order the page lists them, which is the order the game
 * rolls them. Ordering by reward would be a guess about what "better" means.
 */
export function chartDistribution(
  chart: SuccessChart,
  level: number,
): { label: string; chance: number }[] {
  const outcomes: { label: string; chance: number }[] = [];
  let remaining = 1;
  for (const option of chart.options) {
    const chance = successChanceAt(option, level);
    outcomes.push({
      label: option.label,
      chance: chart.cascade ? chance * remaining : chance,
    });
    remaining *= 1 - chance;
    if (!chart.cascade) break;
  }
  return outcomes;
}
