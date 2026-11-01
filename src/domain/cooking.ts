/**
 * Cooking's deterministic half.
 *
 * Cooking is the only skill whose profit a recipe cannot answer on its own: a
 * raw food may burn, and burning destroys the input. The wiki publishes, per
 * food, the level at which it stops burning
 * (<https://oldschool.runescape.wiki/w/Cooking/Burn_level>). At or above that
 * level the action is deterministic, so "buy raw, sell cooked" is an exact
 * margin and no probability is needed. Below it we price nothing.
 *
 * This module holds only the lookup maths; the curated table (with its citation)
 * lives in `scripts/cookingBurnLevels.ts`, the same split the shop-access table
 * uses. Nothing here guesses: a food with no entry, or an entry whose level is
 * `null` (it still burns at 99 on a plain fire or range), is not cookable at any
 * level for pricing purposes.
 */

/** One food's published no-burn level on a plain cooking source. */
export interface CookingBurnLevel {
  /** The **cooked** item's page name, e.g. `Lobster`. */
  item: string;
  /** Level at which it never burns; `null` means it never stops burning. */
  level: number | null;
  /** Which plain source that level belongs to. */
  source: 'fire' | 'range';
}

/** Lower-cased item name -> its row. */
export type BurnIndex = ReadonlyMap<string, CookingBurnLevel>;

export function toBurnIndex(
  rows: readonly CookingBurnLevel[],
): BurnIndex {
  const index = new Map<string, CookingBurnLevel>();
  for (const row of rows) index.set(row.item.toLowerCase(), row);
  return index;
}

/**
 * The level at which `item` stops burning.
 *
 * `undefined` means the source does not list the food at all (we know nothing);
 * `null` means it is listed as still burning at 99 on a plain source. The caller
 * must treat both as "cannot price this action".
 */
export function noBurnLevelFor(
  index: BurnIndex,
  item: string,
): number | null | undefined {
  return index.get(item.toLowerCase())?.level;
}

/**
 * True when the player's level makes this cook deterministic.
 *
 * A level above the published one is fine — burning stops at that level and never
 * comes back. Unknown (`undefined`) is false: an unlisted food is never assumed
 * safe.
 */
export function cooksWithoutBurning(
  index: BurnIndex,
  item: string,
  cookingLevel: number,
): boolean {
  const level = noBurnLevelFor(index, item);
  return typeof level === 'number' && cookingLevel >= level;
}
