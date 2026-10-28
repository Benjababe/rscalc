/**
 * Item stackability, read from the OSRS Wiki's item pages.
 *
 * Neither the prices API `/mapping` payload nor the wiki's `infobox_item` bucket
 * publishes a stackability flag (verified live: the bucket has 18 columns and
 * none of them is `stackable`). The only machine-readable source is the
 * `|stackable =` parameter of the item infobox in the page wikitext:
 *
 *   https://oldschool.runescape.wiki/w/Template:Infobox_Item
 *   https://oldschool.runescape.wiki/w/Stackable_items
 *
 * Why it matters: a stackable item occupies one inventory slot no matter the
 * quantity, while a non-stackable one costs a slot per unit, so only
 * non-stackable buys need banking trips. See `docs/shop-mechanics.md` §10.
 *
 * Anything the wiki does not state is `null`, never guessed. A page with
 * conflicting values across item variants (e.g. one version stacks and another
 * does not) is also `null`, because the mapping's item id picks no version;
 * `budget.ts` charges banking time for `null`, which is the pessimistic choice.
 */

import { fetchPageWikitext } from './wikiPages.js';

/** Map an infobox flag cell to a boolean, or null when it says neither. */
function flagValue(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (value === 'yes' || value === 'true' || value === '1') return true;
  if (value === 'no' || value === 'false' || value === '0') return false;
  return null;
}

/**
 * Read `|stackable =` out of a page's wikitext.
 *
 * Parsed by key, never by position, for the same reason the storeline parser
 * works by header name: a template reorder must not shift the answer. Multiple
 * infoboxes (item variants) are collapsed only when they agree; a disagreement
 * is `null` because we cannot tell which variant an id refers to.
 */
export function extractStackable(wikitext: string): boolean | null {
  const values = new Set<boolean>();
  for (const match of wikitext.matchAll(/\|\s*stackable\s*=\s*([^\n|}]*)/gi)) {
    const parsed = flagValue(match[1] ?? '');
    if (parsed !== null) values.add(parsed);
  }
  if (values.size !== 1) return null;
  return [...values][0] ?? null;
}

export interface StackabilityResult {
  /** Keyed by the title that was requested, not the redirect target. */
  stackable: Map<string, boolean | null>;
  fetchedAt: number;
  requests: number;
  /** Requested titles the wiki did not answer for. */
  missing: number;
  /** Titles whose page has no usable `stackable` value. */
  unknown: number;
}

/**
 * Fetch stackability for a set of item page titles.
 *
 * Titles are the GE mapping's canonical item names, which are page titles. See
 * `wikiPages.ts` for normalisation, redirects and batching.
 */
export async function fetchItemStackability(
  titles: string[],
): Promise<StackabilityResult> {
  const { pages, fetchedAt, requests, missing } = await fetchPageWikitext(titles);

  const stackable = new Map<string, boolean | null>();
  let unknown = 0;

  for (const [title, content] of pages) {
    if (content === null) {
      stackable.set(title, null);
      continue;
    }
    const value = extractStackable(content);
    if (value === null) unknown += 1;
    stackable.set(title, value);
  }

  return { stackable, fetchedAt, requests, missing, unknown };
}
