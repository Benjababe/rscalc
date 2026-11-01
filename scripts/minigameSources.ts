/**
 * Curated minigame rates: the throughput and fee the wiki publishes, applied to the
 * recipes a minigame operates.
 *
 * The engine is `src/domain/minigame.ts`; this file is only the data and its
 * citations. Every number below was read off a wiki page that states it, and every
 * refusal at the bottom says what would be needed to price it — the same policy as
 * `scripts/shopAccessRules.ts` and `scripts/gatheringNodes.ts`.
 */

import type { MinigameRate } from '../src/domain/minigame.js';

/**
 * Blast Furnace — Smithing.
 *
 * - **Fee.** <https://oldschool.runescape.wiki/w/Blast_Furnace#Requirements>: "On
 *   Blast Furnace themed worlds, 72,000 coins per hour (1,200 coins per minute)
 *   must be deposited into the coffer". The fee is time-based, 12 gp per tick. A
 *   normal world instead charges 2,500 gp per 10 minutes at the foreman and waives
 *   it entirely at 60 Smithing, so 72,000/h is the **worst** case and the one
 *   charged here.
 * - **Rate.** <https://oldschool.runescape.wiki/w/Blast_Furnace#Experience_rates>,
 *   the "Default" columns (no coal bag), **lower bound** of each published range.
 *   The coal-bag columns are faster and gear-dependent, so they are not used; the
 *   gold gauntlets/cape and hybrid rows are excluded for the same reason (they
 *   describe a different method, not this bar).
 * - **Materials** come from the bucket, which already carries the Blast Furnace
 *   variant of each bar (half the coal of a normal furnace): steel is 1 coal + 1
 *   iron ore, not 2 coal.
 */
export const BLAST_FURNACE: MinigameRate = {
  facility: 'Blast Furnace',
  feePerHour: 72_000,
  source: 'https://oldschool.runescape.wiki/w/Blast_Furnace#Experience_rates',
  actionsPerHour: new Map([
    ['Bronze bar', 2_900],
    ['Iron bar', 5_800],
    ['Silver bar', 5_800],
    ['Lead bar', 2_900],
    ['Steel bar', 2_900],
    ['Gold bar', 5_800],
    ['Mithril bar', 1_900],
    ['Adamantite bar', 1_450],
    ['Cupronickel bar', 1_450],
    ['Runite bar', 1_150],
  ]),
};

export const MINIGAME_RATES: readonly MinigameRate[] = [BLAST_FURNACE];

/**
 * Checked and **not** priced, so "absent" cannot be read as "not looked at". Each
 * entry names the specific published number that is missing.
 *
 * - **Zalcano** (Mining / Smithing). Every line of its drop table is a **ranged
 *   quantity** — `Blood rune 64-480`, `Silver ore 86-800`, `Runite ore 3-31` — and
 *   the page publishes no weights for those ranges, so there is no expectation to
 *   compute. That is the same refusal `src/domain/ev.ts` makes of `Potato seed 1-4`:
 *   the midpoint would be an invented distribution. Its loot is also per kill at a
 *   damage-contribution share, and the article publishes no kills-per-hour, so even
 *   a clean table would have no rate. <https://oldschool.runescape.wiki/w/Zalcano>
 * - **Wintertodt** (Firemaking) and **Tempoross** (Fishing/Cooking). Rewards come
 *   from a points-based crate whose contents the article does not tabulate at fixed
 *   quantities, and neither page publishes a rounds-per-hour figure. Pricing them
 *   needs the reward table *and* a rate, exactly like the fishing rows.
 *   <https://oldschool.runescape.wiki/w/Wintertodt#Rewards>
 * - **Guardians of the Rift** (Runecraft). The reward guardian's stock is paid for in
 *   abyssal pearls, a currency, so a row would have to model pearls-per-round and
 *   the pearl price of each reward; the article states neither.
 * - **Volcanic Mine** (Mining), **Tithe Farm** (Farming). Point rewards only, with no
 *   published points-per-hour.
 * - **Mahogany Homes** (Construction), **Giants' Foundry** (Smithing). Contract fees
 *   against a plank or material cost — a `train`-shape row, not a reward table. Both
 *   are buildable later from the contract tables; neither publishes a per-hour rate
 *   on its own page.
 */
export const MINIGAME_REFUSALS: readonly { name: string; reason: string }[] = [
  {
    name: 'Zalcano',
    reason:
      'every drop quantity is a published range with no weights (64-480 runes, 86-800 ore), and no kills-per-hour',
  },
  {
    name: 'Wintertodt',
    reason: 'points-based crate with no fixed-quantity reward table and no rounds-per-hour',
  },
  {
    name: 'Tempoross',
    reason: 'points-based reward pool with no fixed-quantity table and no rounds-per-hour',
  },
  {
    name: 'Guardians of the Rift',
    reason: 'rewards cost abyssal pearls, and neither pearls-per-round nor the pearl price is published',
  },
  {
    name: 'Volcanic Mine',
    reason: 'point rewards with no published points-per-hour',
  },
  {
    name: 'Tithe Farm',
    reason: 'point rewards with no published points-per-hour',
  },
  {
    name: 'Mahogany Homes',
    reason: 'a contract fee against a plank cost (a train-shape row) with no published contracts-per-hour',
  },
  {
    name: "Giants' Foundry",
    reason: 'a commission against a material cost (a train-shape row) with no published rounds-per-hour',
  },
];
