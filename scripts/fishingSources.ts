/**
 * Curated Fishing methods, and the point of this file is to say how few are
 * sourceable.
 *
 * What a row needs, per `docs/skilling-plan.md` §3.1 and §4:
 *
 *  1. a **distribution** — which fish one attempt can give, and how often; and
 *  2. an **attempt time** — how often an attempt is rolled.
 *
 * Fishing publishes (1) and not (2). Every fishing page that quantifies anything
 * carries `{{Skilling success chart}}`, whose `low`/`high`/`req` numbers feed the
 * published success formula (`src/domain/successChance.ts`), and a cascading chart
 * (`cascade=yes`) is even the full distribution: trout+salmon and
 * barbarian fishing roll best-first. So the EV per **attempt** is sourced.
 *
 * No fishing page states an interval between attempts — `Fishing`, `Fishing spot`,
 * `Barbarian Fishing` and the individual spot pages were all checked — so the rows
 * from this list keep `secondsPerAction = null` and `gpPerHour = null`. They
 * answer "what is one attempt worth", not "what does an hour earn". Pricing the
 * hour would need an attempt interval this project does not have.
 *
 * The pages below were checked to hold all three of: a `{{Fishing info}}` block, a
 * success chart, and a drop table whose item names the chart's labels can be
 * matched against (`matchChartToTable`). Chart labels are written for a chart, not
 * for a price lookup, so a label that is not one of the page's own published drops
 * refuses the row — that is what excludes the pages listed at the bottom.
 */

export interface FishingSourcePage {
  /** The wiki page: an item page whose `|spot =` names the drop table's page. */
  page: string;
  /** The method, as a short label for reading the log. */
  method: string;
}

export const FISHING_SOURCE_PAGES: readonly FishingSourcePage[] = [
  { page: 'Raw shrimps', method: 'Net (shrimp + anchovy)' },
  { page: 'Raw trout', method: 'Fly fishing (trout + salmon)' },
  { page: 'Raw lobster', method: 'Lobster pot' },
  { page: 'Raw monkfish', method: 'Net (monkfish)' },
  { page: 'Raw karambwan', method: 'Karambwan vessel' },
];

/**
 * Checked and excluded, with the reason, so "not listed" cannot be confused with
 * "not looked at":
 *
 *  - `Raw tuna`, `Raw swordfish`, `Raw shark`, `Raw anglerfish`, `Raw dark crab` —
 *    the chart's labels are not items (`Harpoon`, `Sandworms`, `Normal`), so there
 *    is no item to price. The label check refuses them.
 *  - `Raw manta ray`, `Raw sea turtle`, `Monkfish fishing spot` — no success chart
 *    on the page at all.
 *  - `Leaping trout` / `Leaping salmon` / `Leaping sturgeon` — barbarian fishing:
 *    the cascade is published and the labels match items, but the three pages are
 *    one method (the same chart), so listing all three would publish the same row
 *    three times.
 *  - `Raw herring`, `Raw sardine` — the chart labels are `Herring`/`Sardine` while
 *    the table drops `Raw herring`/`Raw sardine`; a cooked-fish price is not the
 *    catch, so the mismatch refuses them. Adding them would need the chart to name
 *    the raw item.
 *  - `Barbarian Fishing` — prose and tables, no `{{Fishing info}}` block.
 */
export const FISHING_EXCLUDED: readonly string[] = [
  'Raw tuna',
  'Raw swordfish',
  'Raw shark',
  'Raw anglerfish',
  'Raw dark crab',
  'Raw manta ray',
  'Raw sea turtle',
  'Monkfish fishing spot',
  'Raw herring',
  'Raw sardine',
  'Leaping trout',
  'Barbarian Fishing',
];

/** Page titles to fetch. */
export function fishingSourcePages(): string[] {
  return FISHING_SOURCE_PAGES.map((entry) => entry.page);
}
