/**
 * Curated pickpocket targets.
 *
 * A pickpocket row needs four sourced things, and the wiki publishes them in three
 * different places:
 *
 *  1. `{{Thieving info}}` — level, xp, and `time` **which is the stun timer, not an
 *     action time** (`|timename = Stun Timer`);
 *  2. a success chart — `{{Skilling success chart}}` with the plain `Normal` option
 *     first, which gives the chance one attempt succeeds;
 *  3. the `== Loot ==` table — `{{DropsLineSkill}}` lines describing a *successful*
 *     attempt;
 *  4. the timing model, published on the skill page:
 *     <https://oldschool.runescape.wiki/w/Thieving#Pickpocketing> — "NPCs may be
 *     pickpocketed every two ticks (1.2 seconds)" and a failure stuns for eight
 *     ticks, so "every pickpocket will take on average 2+8(1-p) = 10-8p ticks".
 *
 * `src/api/wikiThieving.ts` assembles those four and `src/domain/successChance.ts`
 * turns the chart into `p`. The per-attempt expectation is the loot table times
 * `p`, and the attempt time is the published `2 + stun x (1-p)`.
 *
 * ## Excluded, with the reason
 *
 *  - `Gnome`, `TzHaar-Hur`, `Vyre` — the Loot table contains a **ranged quantity**
 *    (`Coins 230-315`, `Tokkul 3-7`, `Arrow shaft 2-4`), and a range has no
 *    expectation. The parser counts the line as dropped and the engine refuses the
 *    row rather than pricing the readable remainder, which would silently delete
 *    the biggest outcome.
 *  - `Master farmer` — every line is a range (`Potato seed 1-4`), so nothing is
 *    readable at all.
 *  - `Guard`, `Farmer`, `Hero`, `Knight of Ardougne` — a success chart and a stun
 *    timer, but **no `== Loot ==` table**: what a successful pickpocket yields is
 *    not published on the page, so there is no expectation to compute.
 *  - `Menaphite thug` — the only chart on the page is the blackjack *knockout*
 *    chance, and there is no loot table.
 *  - `Elf`, `Dwarf`, `Cave goblin` — no `{{Thieving info}}` block on the page.
 */

export const PICKPOCKET_PAGES: readonly string[] = [
  'Man',
  'Woman',
  'Paladin',
];

/** Checked and excluded, so "absent" cannot be read as "not looked at". */
export const PICKPOCKET_EXCLUDED: readonly string[] = [
  'Gnome',
  'TzHaar-Hur',
  'Vyre',
  'Master farmer',
  'Guard',
  'Farmer',
  'Hero',
  'Knight of Ardougne',
  'Menaphite thug',
  'Elf',
  'Dwarf',
  'Cave goblin',
];
