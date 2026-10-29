/** Two-page hash routing, so the site stays a static bundle with no router. */

export type Page = "shop-to-ge" | "ge-to-shop";

export const DEFAULT_PAGE: Page = "shop-to-ge";

export const PAGES: readonly Page[] = ["shop-to-ge", "ge-to-shop"];

export const PAGE_LABELS: Record<Page, string> = {
  "shop-to-ge": "Shop → GE",
  "ge-to-shop": "GE → shop",
};

/**
 * Parse a location hash into a page. Anything unrecognised is the default
 * shop -> GE page, so old bookmarks and a bare URL keep working.
 */
export function parsePageHash(hash: string): Page {
  const cleaned = hash
    .trim()
    .replace(/^#\/?/, "")
    .replace(/\/+$/, "")
    .trim()
    .toLowerCase();
  return cleaned === "ge-to-shop" ? "ge-to-shop" : DEFAULT_PAGE;
}

export function pageHash(page: Page): string {
  return `#/${page}`;
}
