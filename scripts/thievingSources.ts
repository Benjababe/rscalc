/**
 * Curated Thieving sources: the stall pages whose `{{Thieving info}}` block
 * publishes both an action time and a loot table.
 *
 * Source: <https://oldschool.runescape.wiki/w/Bakery_stall> and sibling pages.
 * The parser is `src/api/wikiThieving.ts`; the expectation maths is
 * `src/domain/ev.ts`; this file only says which pages to read.
 *
 * Excluded on purpose, each for a stated reason:
 *  - the **Port Roberts stalls** (`Ore stall (Port Roberts)` and friends) publish
 *    no action time, so there is no rate to divide by;
 *  - `Silver stall (Port Roberts)` also has a table whose chances sum above 1,
 *    which is not one roll;
 *  - **pickpocket targets** (`Man`, `Guard`, `Master farmer`) keep their loot in a
 *    transcluded or plain `{{DropsLine}}` table rather than `{{DropsLineSkill}}`,
 *    so this parser reads zero drops from them. Pricing them needs a second
 *    layout, and they are counted as unpriced until then.
 */

export const THIEVING_STALL_PAGES: readonly string[] = [
  'Bakery stall',
  "Baker's stall",
  'Crafting stall',
  'Crossbow stall',
  'Fish stall',
  'Fur stall',
  'Gem stall',
  'Magic stall',
  'Ore stall',
  'Scimitar stall',
  'Silk stall',
  'Silver stall',
  'Spice stall',
  'Tea stall',
  'Veg stall',
];
