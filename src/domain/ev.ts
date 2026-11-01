/**
 * Expected value over a sourced drop distribution.
 *
 * The rule this implements is the one recorded in `docs/skilling-plan.md` §3.1:
 * a chance-based yield may be priced at its expectation **only when the wiki
 * publishes the distribution** — a drop rate, a loot table, a rare table — and the
 * row must say it is an expectation.
 *
 * What is deliberately refused, because it would be a guess wearing a number's
 * clothes:
 *
 *  - **quantity ranges** (`1-4`). The wiki says four outcomes are possible and
 *    says nothing about their weights, so the midpoint would be an invented
 *    distribution. A drop with a ranged quantity invalidates the row.
 *  - **"average" / "varies" quantities** — same reason.
 *  - a table whose *rolled* probabilities sum to **more than 1** (it is not one
 *    roll).
 *
 * A line published as `Always` is **guaranteed**, not one outcome of a roll: a
 * polar kebbit always drops bones *and* fur *and* meat, so three `Always` lines
 * coexist and their sum says nothing about exclusivity. Guaranteed lines are
 * therefore counted once each, and only the remaining (probability) lines have to
 * fit inside a single roll. Before this, a table with two guaranteed drops was
 * refused as "not one roll", which is the wrong reading of the same source.
 *
 * Coins are face value; every other item is valued at the GE price for the mode,
 * minus the GE tax, because that is the only exit this site models (Q6).
 */

/** One possible outcome of one action. */
export interface EvDrop {
  item: string;
  /** Exact units per drop. A range is not an expectation, so it is not accepted. */
  quantity: number;
  /**
   * Probability of this outcome in 0..1, from the published rarity. Exactly `1`
   * (the wiki's `Always`) marks a guaranteed drop, which may co-occur with other
   * guaranteed drops rather than competing with them.
   */
  chance: number;
}

/** A drop table that passed the checks above. */
export interface EvDistribution {
  drops: EvDrop[];
  /** Sum of the chances. Below 1 means "sometimes nothing drops", which is fine. */
  totalChance: number;
  /** How many of the lines are guaranteed (`Always`) rather than one of a roll. */
  guaranteed: number;
}

export interface EvAnalysis {
  distribution: EvDistribution | null;
  /** Why the table was rejected, when it was. */
  rejected:
    | null
    | 'no-drops'
    | 'ranged-quantity'
    | 'unreadable-rarity'
    | 'over-one'
    | 'non-positive-quantity';
}

/** `Always`, `5/20`, `1/5.65`, `1/123,941` -> probability, or null. */
export function parseRarity(raw: string): number | null {
  const text = raw.replace(/[[\]]/g, '').replace(/,/g, '').trim();
  if (text === '') return null;
  if (/^always$/i.test(text)) return 1;
  if (/^never$/i.test(text)) return 0;
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (fraction !== null) {
    const numerator = Number.parseFloat(fraction[1] ?? '');
    const denominator = Number.parseFloat(fraction[2] ?? '');
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
    if (denominator <= 0 || numerator < 0) return null;
    const chance = numerator / denominator;
    return chance <= 1 ? chance : null;
  }
  return null;
}

/**
 * Check a parsed table and normalise it.
 *
 * The order of the checks matters only for the report: a ranged quantity is
 * rejectable on its own, so it is reported before the sum is examined.
 */
export function analyseDistribution(drops: readonly EvDrop[]): EvAnalysis {
  if (drops.length === 0) return { distribution: null, rejected: 'no-drops' };
  let total = 0;
  let rolled = 0;
  let guaranteed = 0;
  for (const drop of drops) {
    if (!Number.isFinite(drop.quantity) || drop.quantity <= 0) {
      return { distribution: null, rejected: 'non-positive-quantity' };
    }
    if (!Number.isInteger(drop.quantity)) {
      return { distribution: null, rejected: 'ranged-quantity' };
    }
    if (!Number.isFinite(drop.chance) || drop.chance < 0 || drop.chance > 1) {
      return { distribution: null, rejected: 'unreadable-rarity' };
    }
    total += drop.chance;
    if (drop.chance === 1) guaranteed += 1;
    else rolled += drop.chance;
  }
  // The probability lines are one roll and cannot succeed more than once. The
  // guaranteed lines are not part of that roll, so they are not added to it.
  if (rolled > 1.001) return { distribution: null, rejected: 'over-one' };
  return {
    distribution: { drops: [...drops], totalChance: total, guaranteed },
    rejected: null,
  };
}

/** One priced outcome. */
export interface EvLine {
  item: string;
  quantity: number;
  chance: number;
  /** Coins received for this line, on average per action. */
  expectedGp: number;
}

/** The expectation, priced. `perAction` is already net of the GE tax. */
export interface EvPriced {
  lines: EvLine[];
  perAction: number;
}

/**
 * Price a distribution.
 *
 * `priceOf` returns the per-unit value the row can realise: sale price after tax
 * for a GE item, face value for coins, null when the item has no market. A single
 * unpriced item invalidates the row — an expectation that quietly drops the
 * expensive outcome would be worse than no row at all.
 */
export function priceDistribution(
  distribution: EvDistribution,
  priceOf: (item: string) => number | null,
): EvPriced | null {
  const lines: EvLine[] = [];
  let perAction = 0;

  for (const drop of distribution.drops) {
    const price = priceOf(drop.item);
    if (price === null) return null;
    const expectedGp = drop.chance * drop.quantity * price;
    perAction += expectedGp;
    lines.push({
      item: drop.item,
      quantity: drop.quantity,
      chance: drop.chance,
      expectedGp: Math.round(expectedGp),
    });
  }

  return { lines, perAction: Math.round(perAction) };
}
