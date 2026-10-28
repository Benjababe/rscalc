/**
 * OSRS Wiki URL construction.
 *
 * Shop page titles come straight from the wiki's own `storeline` bucket, so they
 * are already exact page names — including quirks like a trailing full stop
 * (`Bob's Brilliant Axes.`) or `~` decorations (`~ Uglug's stuffsies ~`).
 * Do not "tidy" them: the title IS the page.
 */

const WIKI_BASE = "https://oldschool.runescape.wiki/w/";

/**
 * Build the canonical wiki URL for a page title.
 *
 * MediaWiki addresses pages as `/w/Title_With_Underscores`, and the path segment
 * must be percent-encoded so titles containing `/`, `&`, `#` or `?` don't break
 * the URL. `encodeURIComponent` leaves `!'()*-._~` alone, which MediaWiki also
 * accepts unencoded.
 */
export function wikiUrl(pageTitle: string): string {
  return `${WIKI_BASE}${encodeURIComponent(pageTitle.trim().replace(/ /g, "_"))}`;
}
