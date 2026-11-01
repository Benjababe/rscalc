import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractStackable, fetchItemStackability } from '../src/api/wikiItems.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** The URL a stubbed fetch was called with, whatever shape it was passed. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(requestUrl(input))),
  );
}

function revisionPage(title: string, content: string): unknown {
  return { title, revisions: [{ slots: { main: { content } } }] };
}

/**
 * Every test uses fresh titles so the on-disk HTTP cache (24h TTL) can never
 * answer for the mocked fetch. A cache hit would make these assertions vacuous.
 */
function unique(name: string): string {
  return `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('extractStackable', () => {
  it('reads the infobox flag by key', () => {
    expect(
      extractStackable("{{Infobox Item\n|name = Air rune\n|stackable = Yes\n}}"),
    ).toBe(true);
    expect(extractStackable("{{Infobox Item\n|stackable = No\n}}")).toBe(false);
  });

  it('is case and whitespace insensitive', () => {
    expect(extractStackable('| stackable =  YES ')).toBe(true);
    expect(extractStackable('|STACKABLE=0')).toBe(false);
    expect(extractStackable('|stackable = true')).toBe(true);
  });

  it('returns null when the template omits or empties the flag', () => {
    expect(extractStackable('{{Infobox Item|name = Steel axe}}')).toBeNull();
    expect(extractStackable('|stackable =')).toBeNull();
    expect(extractStackable('|stackable = Unknown')).toBeNull();
  });

  it('returns null when item variants disagree', () => {
    // Two infoboxes, one stacking and one not: the item id picks no version,
    // so guessing either way would be a fabricated answer.
    expect(
      extractStackable('|stackable = Yes\n{{Infobox Item\n|stackable = No'),
    ).toBeNull();
  });

  it('tolerates repeated identical values', () => {
    expect(extractStackable('|stackable = Yes|stackable=Yes')).toBe(true);
  });

  it('stops at the closing braces of an inline template', () => {
    // Real pages put the parameter on its own line, but `{{Infobox Item|...}}`
    // on one line must not capture `Yes}}` and report the item as unknown.
    expect(extractStackable('{{Infobox Item|stackable=Yes}}')).toBe(true);
    expect(extractStackable('{{Infobox Item|stackable = No }}')).toBe(false);
  });
});

describe('fetchItemStackability', () => {
  it('answers for each requested title and follows redirects', async () => {
    const requested = unique('Old item');
    const moved = unique('Moved item');

    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            query: {
              normalized: [{ from: requested, to: requested }],
              redirects: [{ from: requested, to: moved }],
              pages: [revisionPage(moved, '{{Infobox Item|stackable=Yes}}')],
            },
          }),
          { status: 200 },
        ),
    );

    const result = await fetchItemStackability([requested]);

    // The caller asked for `requested`, so that is the key it gets back.
    expect(result.stackable.get(requested)).toBe(true);
    expect(result.missing).toBe(0);
    expect(result.unknown).toBe(0);
    expect(result.requests).toBe(1);
  });

  it('leaves pages the wiki does not have as null', async () => {
    const title = unique('Missing item');
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ query: { pages: [{ title, missing: true }] } }),
          { status: 200 },
        ),
    );

    const result = await fetchItemStackability([title]);

    expect(result.stackable.get(title)).toBeNull();
    expect(result.missing).toBe(1);
    expect(result.unknown).toBe(0);
  });

  it('reports a page with no stackable flag as unknown, not false', async () => {
    const title = unique('No flag item');
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            query: { pages: [revisionPage(title, '{{Infobox Item|name = Thing}}')] },
          }),
          { status: 200 },
        ),
    );

    const result = await fetchItemStackability([title]);

    expect(result.stackable.get(title)).toBeNull();
    expect(result.unknown).toBe(1);
    expect(result.missing).toBe(0);
  });

  it('batches 50 titles per request', async () => {
    const names = Array.from({ length: 51 }, (_, index) => unique(`Bulk ${index}`));

    stubFetch((url) => {
      const titles = (new URL(url).searchParams.get('titles') ?? '').split('|');
      return new Response(
        JSON.stringify({
          query: {
            pages: titles.map((title) => revisionPage(title, '|stackable=No')),
          },
        }),
        { status: 200 },
      );
    });

    const result = await fetchItemStackability(names);

    expect(result.requests).toBe(2);
    expect(result.stackable.size).toBe(51);
    expect([...result.stackable.values()].every((value) => value === false)).toBe(
      true,
    );
  }, 15_000);
});
