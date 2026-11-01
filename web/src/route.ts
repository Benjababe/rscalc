/** Four-page hash routing, so the site stays a static bundle with no router. */

export type Page = "earn" | "shop-to-ge" | "ge-to-shop" | "processing";

/**
 * The gp-earning leaderboard is the front door: the site is a money-making
 * site, and the three calculators are the detail pages behind it.
 */
export const DEFAULT_PAGE: Page = "earn";

export const PAGES: readonly Page[] = [
  "earn",
  "shop-to-ge",
  "ge-to-shop",
  "processing",
];

export const PAGE_LABELS: Record<Page, string> = {
  earn: "Earn gp",
  "shop-to-ge": "Shop → GE",
  "ge-to-shop": "GE → shop",
  processing: "Processing",
};

/** One-line description of each page, used in the header and in tests. */
export const PAGE_TITLES: Record<Page, string> = {
  earn: "Everything this model can price, ranked by gp per hour",
  "shop-to-ge": "Buy from an NPC shop, sell on the Grand Exchange",
  "ge-to-shop": "Buy on the Grand Exchange, sell to an NPC shop",
  processing: "Buy inputs, transform them, sell the output",
};

const HASHES: Record<string, Page> = {
  earn: "earn",
  "shop-to-ge": "shop-to-ge",
  "ge-to-shop": "ge-to-shop",
  processing: "processing",
};

/**
 * Parse a location hash into a page. Anything unrecognised is the default
 * earn page, so old bookmarks, a bare URL and the pre-earn `#/` keep working.
 */
export function parsePageHash(hash: string): Page {
  // The query string carries the view (`viewState.ts`); the page is the path
  // before it, so it must not be matched against the parameters.
  const path = hash.split("?")[0] ?? hash;
  const cleaned = path
    .trim()
    .replace(/^#\/?/, "")
    .replace(/\/+$/, "")
    .trim()
    .toLowerCase();
  return HASHES[cleaned] ?? DEFAULT_PAGE;
}

export function pageHash(page: Page): string {
  return `#/${page}`;
}
