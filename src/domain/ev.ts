/**
 * Expected value over a sourced drop distribution.
 *
 * The rule this implements is the one recorded in `docs/skilling-plan.md` §3.1:
 * a chance-based yield may be priced at its expectation **only when the wiki
 * publishes the distribution** — a drop rate, a loot table, a rare table — and the
 * row must say it is an expectation.
 *
 * ## Ranged quantities: priced at the midpoint, as an assumption
 *
 * Operator decision (recorded in `docs/skilling-plan.md` §3.1, and it reverses this
 * file's first rule): a line published as a range — `Air rune 500-750`, `Coins
 * 1,500-3,000`, `Monkfish 1-3` — **is** priced, at the **midpoint** of the range, and
 * the line says so: `assumed: true` plus the range it came from, so the artifact and
 * the page can never present the figure as a published quantity.
 *
 * The trade-off is explicit rather than hidden. A midpoint assumes the quantity is
 * uniform across the range, which the wiki does not state; refusing the line instead
 * deletes the outcome entirely, which understates the row by more (Zalcano's coins
 * and rune lines are most of its value, and the Hallowed sack's coin lines are the
 * largest outcome in every tier). The operator preferred a labelled estimate to a
 * missing row, so the assumption is carried in the data and shown in the UI.
 *
 * What is still refused, because there is nothing to take a midpoint of:
 *
 *  - a quantity written as a word (`Varies`, `average`): no numbers, so no midpoint.
 *  - a quantity that is not a number at all, or a non-positive one.
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
 * ## An outcome with no market counts as 0 gp
 *
 * Operator decision: when an outcome has **no GE market** (`gemw=no`, or simply absent
 * from the item mapping), it contributes **0 gp** instead of invalidating the row. The
 * alternative refused the whole table, which is how Zalcano sat unpriced because its
 * guaranteed `Crystal shard` has no GE entry.
 *
 * The line is marked `unpriced: true` and carries 0 gp, and the row's tooltip lists it
 * as "no GE market", so a reader can see that the mean is a **floor**: the item is worth
 * something, this site just cannot price it. Nothing is silently dropped.
 *
 * Coins are face value; every other item is valued at the GE price for the mode,
 * minus the GE tax, because that is the only exit this site models (Q6).
 */

/** One possible outcome of one action. */
export interface EvDrop {
  item: string;
  /**
   * Units per drop. An exact figure when the wiki publishes one, and the **midpoint**
   * of the published range when it does not — `assumedQuantity` says which.
   */
  quantity: number;
  /**
   * True when `quantity` is the midpoint of a published range rather than a published
   * figure. The row's `distribution` carries this through to the page, so an assumed
   * quantity is never displayed as if the wiki had stated it.
   */
  assumedQuantity?: boolean;
  /** The published range the midpoint came from, when one did. */
  quantityRange?: { min: number; max: number } | null;
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
 * A **ranged** quantity is now accepted when the parser has marked it as an
 * assumption (`assumedQuantity`), because the operator chose a labelled midpoint over
 * a missing outcome; a fractional quantity that is *not* marked is still refused,
 * since it means someone invented a fraction without saying so.
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
    if (!Number.isInteger(drop.quantity) && drop.assumedQuantity !== true) {
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

/**
 * A quantity as the wiki writes it: `3`, `1,000`, `500-750`, `1-3 (noted)`.
 *
 * A range becomes its **midpoint**, flagged as an assumption and carrying the range
 * it came from (see the header). A word (`Varies`, `N/A`) is not a quantity and
 * returns null, which lets the caller count the line as unreadable instead of pricing
 * an invention.
 */
export interface ParsedQuantity {
  quantity: number;
  assumedQuantity: boolean;
  quantityRange: { min: number; max: number } | null;
}

export function parseQuantity(raw: string): ParsedQuantity | null {
  // Drop the wiki's annotations, then normalise separators.
  const text = raw
    .replace(/\([^)]*\)/g, '')
    .replace(/,/g, '')
    .trim();
  if (text === '') return null;

  const range = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (range !== null) {
    const min = Number.parseFloat(range[1] ?? '');
    const max = Number.parseFloat(range[2] ?? '');
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
    if (min <= 0 || max < min) return null;
    // A degenerate range is just the number.
    if (min === max) {
      return { quantity: min, assumedQuantity: false, quantityRange: null };
    }
    return {
      quantity: (min + max) / 2,
      assumedQuantity: true,
      quantityRange: { min, max },
    };
  }

  const exact = Number.parseFloat(text);
  if (!Number.isFinite(exact) || exact <= 0) return null;
  if (!Number.isInteger(exact)) return null;
  return { quantity: exact, assumedQuantity: false, quantityRange: null };
}

/** One priced outcome. */
export interface EvLine {
  item: string;
  quantity: number;
  chance: number;
  /** Coins received for this line, on average per action. */
  expectedGp: number;
  /** True when `quantity` is the midpoint of a published range. */
  assumedQuantity: boolean;
  /** The published range, when the quantity was a range. */
  quantityRange: { min: number; max: number } | null;
  /**
   * True when the item has no GE market, so its contribution is 0 gp and the row's
   * total is a floor rather than the item's full worth.
   */
  unpriced: boolean;
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
    // No market: the line still appears, valued at 0 gp and marked, so the row is a
    // floor rather than a silent omission.
    const unpriced = price === null;
    const expectedGp = unpriced ? 0 : drop.chance * drop.quantity * price;
    perAction += expectedGp;
    lines.push({
      item: drop.item,
      quantity: drop.quantity,
      chance: drop.chance,
      expectedGp: Math.round(expectedGp),
      assumedQuantity: drop.assumedQuantity === true,
      quantityRange: drop.quantityRange ?? null,
      unpriced,
    });
  }

  // A table where *nothing* has a market is not a floor worth publishing: the mean
  // would be 0 because the site knows no prices, not because the loot is worthless.
  if (lines.every((line) => line.unpriced)) return null;

  return { lines, perAction: Math.round(perAction) };
}
