/**
 * Curated Hunter creatures: the pages that publish a success chart **and** a
 * guaranteed catch line.
 *
 * Three sourced pieces make a row, and this file only says which creatures have
 * them:
 *
 *  1. `{{Hunter info}}` — level, xp and the trap type;
 *  2. `{{Skilling success chart}}` — the catch chance at the creature's level,
 *     through `src/domain/successChance.ts`;
 *  3. the `Always` lines of its `{{DropsLineSkill}}` table — what one successful
 *     catch yields. A pet roll or a Hunter's-Rumour drop is not part of the catch
 *     and is counted as ignored, never folded in.
 *
 * ## Time is published for box traps only
 *
 * <https://oldschool.runescape.wiki/w/Box_trap> states "an attempt every 3 ticks
 * (1.8 seconds)", so a box-trap creature gets a real gp/hour. The `Bird snare`,
 * `Noose wand`, `Deadfall`, `Net trap`, `Rabbit snare` and butterfly-net pages
 * publish no interval, so those rows keep `gpPerHour = null` and say why — a
 * per-attempt value is sourced, an hour is not.
 *
 * Every page here was checked against the live wiki with the parser; the excluded
 * list at the bottom is the rest of the candidates and why they are out.
 */

export interface HunterSourcePage {
  /** The creature page, also the artifact's source link. */
  page: string;
  /** The trap, for reading the log. The parser reads the page's own `|trap=`. */
  trap: string;
}

export const HUNTER_SOURCE_PAGES: readonly HunterSourcePage[] = [
  { page: 'Carnivorous chinchompa', trap: 'Box trap' },
  { page: 'Crimson swift', trap: 'Bird snare' },
  { page: 'Cerulean twitch', trap: 'Bird snare' },
  { page: 'Golden warbler', trap: 'Bird snare' },
  { page: 'Copper longtail', trap: 'Bird snare' },
  { page: 'Tropical wagtail', trap: 'Bird snare' },
  { page: 'Black warlock', trap: 'Butterfly net' },
  { page: 'Pyre fox', trap: 'Deadfall' },
];

/**
 * Checked and excluded:
 *
 *  - `Polar kebbit` — a noose wand, and the page has no success chart even though
 *    the prose quotes a rate ("around 93% at level 1"). A prose percentage is not
 *    the chart's `low`/`high` parameters, so there is no distribution to compute.
 *  - `Ruby harvest`, `Sapphire glacialis`, `Snowy knight` — butterfly pages with
 *    no success chart.
 *  - `Sunlight antelope`, `Moonlight antelope`, `Spined larupia`, `Horned graahk`,
 *    `Sabre-toothed kyatt` — no success chart on the page.
 *  - `Chinchompa`, `Black chinchompa`, `Ferret`, `Swamp lizard`, `Orange
 *    salamander`, `Red salamander`, `Black salamander` — item pages, not creature
 *    pages: no `{{Hunter info}}` block. The grey chinchompa's creature page is
 *    `Chinchompa (Hunter)` and carries no chart yet.
 */
export const HUNTER_EXCLUDED: readonly string[] = [
  'Polar kebbit',
  'Ruby harvest',
  'Sapphire glacialis',
  'Snowy knight',
  'Sunlight antelope',
  'Moonlight antelope',
  'Spined larupia',
  'Horned graahk',
  'Sabre-toothed kyatt',
  'Chinchompa (Hunter)',
  'Ferret',
  'Swamp lizard',
];

/** Page titles to fetch. */
export function hunterSourcePages(): string[] {
  return HUNTER_SOURCE_PAGES.map((entry) => entry.page);
}
