/** Three-page hash routing, so the site stays a static bundle with no router. */

export type Page = "shop-to-ge" | "ge-to-shop" | "processing";

export const DEFAULT_PAGE: Page = "shop-to-ge";

export const PAGES: readonly Page[] = ["shop-to-ge", "ge-to-shop", "processing"];

export const PAGE_LABELS: Record<Page, string> = {
  "shop-to-ge": "Shop → GE",
  "ge-to-shop": "GE → shop",
  "processing": "Processing",
};

/**
 * Parse a location hash into a page. Anything unrecognised is the default
 * shop -> GE page, so old bookmarks and a bare URL keep working.
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
  return cleaned === "ge-to-shop"
    ? "ge-to-shop"
    : cleaned === "processing"
      ? "processing"
      : DEFAULT_PAGE;
}

export function pageHash(page: Page): string {
  return `#/${page}`;
}
