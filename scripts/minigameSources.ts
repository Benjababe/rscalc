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
 * Every other minigame, surveyed and **not** priced, so "absent" cannot be read as
 * "not looked at".
 *
 * The survey is exhaustive rather than suggestive: 29 pages were read for this list
 * (the minigame, its reward page or its reward-guardian page). A row needs **both**
 * halves — a reward distribution with exact quantities and published chances, and a
 * published rate — and each entry below names the half that is missing. Grouped by
 * the failure, with the pages read:
 *
 * **Reward tables exist but their quantities are ranges or `Varies`.** The
 * distribution half fails, so there is no expectation to compute:
 *  - Zalcano — 21 of 26 lines ranged (`Blood rune 64-480`, `Runite ore 3-31`), no
 *    kills-per-hour either.
 *  - Wintertodt supply crate — 63 of 75 lines ranged.
 *  - Hallowed Sepulchre (`Hallowed sack`) — 20 of 30 lines ranged.
 *  - Guardians of the Rift (`Rewards Guardian`) — 13 of 44 lines ranged, and the
 *    rewards are priced in abyssal pearls, a currency with no GE value.
 *  - Fishing Trawler — 18 of 23 lines are `quantity=Varies|rarity=Varies`, i.e. no
 *    distribution at all; only the four angler pieces are fixed (`1/12`).
 *  - Tempoross — the pool does not tabulate fixed quantities either.
 *
 * **Point shops with no published points-per-hour.** The rate half fails. A reward
 * that costs 1,000 points is not an hourly figure unless something publishes how fast
 * points arrive, and no article does:
 *  - Volcanic Mine, Tithe Farm, Pest Control (commendations), Nightmare Zone,
 *    Barbarian Assault (honour points), Mage Training Arena (pizazz), Soul Wars,
 *    Castle Wars, Last Man Standing, Bounty Hunter.
 *
 * **Fees or commissions with no published throughput.** A `train`-shape row needs the
 * contract's material cost *and* a rate, and neither page publishes contracts or
 * rounds per hour:
 *  - Mahogany Homes (carpenter points, planks), Giants' Foundry (commission, bars).
 *
 * **No reward table at all.** Nothing to price:
 *  - Pyramid Plunder, Trouble Brewing, Rat Pits, Fist of Guthix, Stealing Creation,
 *    Blast Mine (publishes XP per hour, not profit).
 *
 * The one that survives both tests is the Blast Furnace, because its recipes already
 * existed and its page publishes a throughput table and a fee. Nothing else does.
 */
export const MINIGAME_REFUSALS: readonly { name: string; reason: string }[] = [
  {
    name: 'Zalcano',
    reason:
      '21 of 26 drop lines are ranged quantities with no weights (64-480 runes, 86-800 ore), and no kills-per-hour',
  },
  {
    name: 'Wintertodt',
    reason:
      'supply crate: 63 of 75 reward lines are ranged quantities, and no rounds-per-hour',
  },
  {
    name: 'Tempoross',
    reason: 'reward pool tabulates no fixed quantities, and no rounds-per-hour',
  },
  {
    name: 'Guardians of the Rift',
    reason:
      '13 of 44 reward lines are ranged, and rewards cost abyssal pearls — a currency with no GE value',
  },
  {
    name: 'Hallowed Sepulchre',
    reason: 'Hallowed sack: 20 of 30 reward lines are ranged quantities',
  },
  {
    name: 'Fishing Trawler',
    reason:
      '18 of 23 reward lines are quantity=Varies / rarity=Varies, so there is no distribution; only the angler pieces are fixed',
  },
  {
    name: 'Volcanic Mine',
    reason: 'point rewards, and no published points-per-hour',
  },
  {
    name: 'Tithe Farm',
    reason: 'point rewards, and no published points-per-hour',
  },
  {
    name: 'Pest Control',
    reason: 'commendation rewards, and no published commendations-per-hour',
  },
  {
    name: 'Nightmare Zone',
    reason: 'point rewards, and no published points-per-hour',
  },
  {
    name: 'Barbarian Assault',
    reason: 'honour-point rewards, and no published points-per-hour',
  },
  {
    name: 'Mage Training Arena',
    reason: 'pizazz-point rewards, and no published points-per-hour',
  },
  {
    name: 'Soul Wars',
    reason: 'zeal-token rewards, and no published tokens-per-hour',
  },
  {
    name: 'Castle Wars',
    reason: 'ticket rewards, and no published tickets-per-hour',
  },
  {
    name: 'Last Man Standing',
    reason: 'point rewards, and no published points-per-hour',
  },
  {
    name: 'Bounty Hunter',
    reason: 'point rewards, and no published points-per-hour',
  },
  {
    name: 'Mahogany Homes',
    reason:
      'a contract fee against a plank cost (a train-shape row), and no published contracts-per-hour',
  },
  {
    name: "Giants' Foundry",
    reason:
      'a commission against a material cost (a train-shape row), and no published rounds-per-hour',
  },
  {
    name: 'Pyramid Plunder',
    reason: 'no reward table: loot is per-urn and per-chest, unquantified on the page',
  },
  {
    name: 'Trouble Brewing',
    reason: 'no reward table, and no published games-per-hour',
  },
  {
    name: 'Rat Pits',
    reason: 'no reward table: the page documents the game, not a payout',
  },
  {
    name: 'Fist of Guthix',
    reason: 'no reward table: rewards are bought from a shop the page does not tabulate',
  },
  {
    name: 'Stealing Creation',
    reason: 'no reward table: the payout depends on team scoring, which is not tabulated',
  },
  {
    name: 'Blast Mine',
    reason: 'publishes experience per hour, not profit; its ores are also priced as gather rows',
  },
];
