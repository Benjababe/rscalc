/**
 * Batched page wikitext from the OSRS Wiki.
 *
 * Several sources live only in article wikitext rather than a bucket:
 * item stackability (`|stackable =`) and bank coordinates (`{{Map|...}}`).
 * Both are fetched the same way — 50 titles per `prop=revisions` request, well
 * inside the 1 req/s budget in `http.ts`.
 *
 * MediaWiki normalises titles and follows redirects. The response reports both,
 * so a page that moved is still returned under the title the caller asked for.
 * A missing page is an explicit `null`, never an empty string: callers must not
 * be able to mistake "the wiki has no such page" for "the page says nothing".
 */

import { z } from 'zod';
import { fetchJson } from './http.js';

const WIKI_API = 'https://oldschool.runescape.wiki/api.php';

/** MediaWiki caps anonymous `titles` batches at 50. */
const BATCH_SIZE = 50;
/** Wikitext changes rarely enough that a day-old copy is fine. */
const TTL_MS = 24 * 60 * 60 * 1000;

const PageSchema = z.object({
  title: z.string(),
  missing: z.boolean().optional(),
  revisions: z
    .array(
      z.object({
        slots: z.object({
          main: z.object({ content: z.string() }),
        }),
      }),
    )
    .optional(),
});
type WikiPage = z.infer<typeof PageSchema>;

const RevisionsResponseSchema = z.object({
  query: z
    .object({
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      redirects: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      pages: z.array(PageSchema).optional(),
    })
    .optional(),
});

/** Follow MediaWiki's normalisation and redirect chain to the served title. */
function resolveTitle(
  requested: string,
  normalized: Map<string, string>,
  redirects: Map<string, string>,
): string {
  let title = normalized.get(requested) ?? requested;
  for (let hop = 0; hop < 5; hop += 1) {
    const next = redirects.get(title);
    if (next === undefined) break;
    title = next;
  }
  return title;
}

export interface PageWikitextResult {
  /** Keyed by requested title. `null` means the wiki has no such page. */
  pages: Map<string, string | null>;
  fetchedAt: number;
  requests: number;
  missing: number;
}

/**
 * Fetch the current wikitext of the given page titles.
 *
 * Titles are deduplicated and trimmed. The result always has one entry per
 * requested title, so callers can iterate without re-resolving redirects.
 */
export async function fetchPageWikitext(
  titles: string[],
): Promise<PageWikitextResult> {
  const requested = [...new Set(titles.map((title) => title.trim()))].filter(
    (title) => title !== '',
  );

  const pagesByTitle = new Map<string, WikiPage>();
  const normalized = new Map<string, string>();
  const redirects = new Map<string, string>();
  let fetchedAt = Date.now();
  let requests = 0;

  for (let offset = 0; offset < requested.length; offset += BATCH_SIZE) {
    const batch = requested.slice(offset, offset + BATCH_SIZE);
    const url =
      `${WIKI_API}?action=query&format=json&formatversion=2` +
      `&prop=revisions&rvslots=main&rvprop=content&redirects=1` +
      `&titles=${encodeURIComponent(batch.join('|'))}`;

    const { body, fetchedAt: at } = await fetchJson(url, { ttlMs: TTL_MS });
    fetchedAt = at;
    requests += 1;

    const parsed = RevisionsResponseSchema.parse(body);
    const query = parsed.query;

    for (const entry of query?.normalized ?? []) normalized.set(entry.from, entry.to);
    for (const entry of query?.redirects ?? []) redirects.set(entry.from, entry.to);
    for (const page of query?.pages ?? []) pagesByTitle.set(page.title, page);
  }

  const pages = new Map<string, string | null>();
  let missing = 0;

  for (const title of requested) {
    const page = pagesByTitle.get(resolveTitle(title, normalized, redirects));
    const content = page?.revisions?.[0]?.slots.main.content;
    if (page === undefined || page.missing === true || content === undefined) {
      missing += 1;
      pages.set(title, null);
      continue;
    }
    pages.set(title, content);
  }

  return { pages, fetchedAt, requests, missing };
}
