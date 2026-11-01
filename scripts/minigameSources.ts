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
 * **A reward table exists, but nothing publishes a rate.** Since the midpoint rule in
 * `docs/skilling-plan.md` §3.1, a published *range* is no longer an objection: those
 * lines are priced at their midpoint and marked as an assumption. What these pages
 * still lack is the other half — how many kills, rounds, sacks or crates happen per
 * hour — so the row would be a per-attempt expectation with `gpPerHour = null`, and
 * the loot parser that reads their `{{DropsLine}}` tables (as opposed to the bucket's
 * recipes) does not exist yet:
 *  - Zalcano — 21 of 26 lines ranged (`Blood rune 64-480`), and no kills-per-hour.
 *  - Wintertodt supply crate — 63 of 75 lines ranged, and no crates-per-hour.
 *  - Hallowed Sepulchre (`Hallowed sack`) — three tier tables of 10 lines at 1/10,
 *    20 of them ranged, and floor timers rather than sacks per hour.
 *  - Guardians of the Rift (`Rewards Guardian`) — 13 of 44 lines ranged, and rewards
 *    are priced in abyssal pearls, a currency with no GE value.
 *  - Tempoross — the pool tabulates no fixed quantities, and there is no
 *    rounds-per-hour.
 *
 * **Still refused outright, because there is nothing to take a midpoint of:**
 *  - Fishing Trawler — 18 of 23 lines are `quantity=Varies|rarity=Varies`. `Varies`
 *    is a word, not a range, so there is no midpoint; only the four angler pieces are
 *    numbers (`1/12`).
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
      'its 21 of 26 ranged lines now price at midpoint (§3.1), but no kills-per-hour is published and it has no loot-table parser',
  },
  {
    name: 'Wintertodt',
    reason:
      'supply crate: 63 of 75 ranged lines now price at midpoint, but no crates-per-hour is published',
  },
  {
    name: 'Tempoross',
    reason:
      'the reward pool tabulates no quantities at all (not even ranges), and no rounds-per-hour',
  },
  {
    name: 'Guardians of the Rift',
    reason:
      'rewards cost abyssal pearls — a currency with no GE value — and neither pearls-per-round nor a rune reward table is published',
  },
  {
    name: 'Hallowed Sepulchre',
    reason:
      'Hallowed sack: three tier tables of 10 lines at 1/10; 20 of 30 lines are ranged and now price at midpoint, but no sacks-per-hour is published',
  },
  {
    name: 'Fishing Trawler',
    reason:
      '18 of 23 reward lines are quantity=Varies / rarity=Varies: `Varies` is a word, so there is no midpoint to take; only the angler pieces are numbers',
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
