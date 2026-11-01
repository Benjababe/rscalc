import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractMapTemplatePoint,
  fetchPageMapPoints,
  parseMapBucket,
} from '../src/api/wikiMap.js';

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

/** Unique titles keep the 24h disk cache from answering for the mock. */
function unique(name: string): string {
  return `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const BUCKET_HTML = `<!doctype html><html><body><table>
<tr><th>page_name</th><th>page_name_sub</th><th>features</th><th>options</th><th>is_historic</th></tr>
<tr><td>Varrock General Store</td><td>Varrock General Store</td><td>[]</td><td>{"y":3415,"x":3216,"zoom":2,"plane":0,"mapID":0}</td><td>false</td></tr>
<tr><td>Nurmof&#039;s Pickaxe Shop.</td><td>Nurmof&#039;s Pickaxe Shop.</td><td>[]</td><td>{"y":9845,"x":2998,"zoom":2,"plane":0,"mapID":6}</td><td>false</td></tr>
<tr><td>Broken</td><td>Broken</td><td>[]</td><td>not json</td><td>false</td></tr>
<tr><td>No options</td><td>No options</td><td>[]</td><td></td><td>false</td></tr>
</table></body></html>`;

describe('parseMapBucket', () => {
  it('reads the page centre from the options JSON by header name', () => {
    const page = parseMapBucket(BUCKET_HTML);

    expect(page.rows).toHaveLength(2);
    expect(page.rowCount).toBe(4);
    expect(page.rows[0]).toEqual({
      pageName: 'Varrock General Store',
      point: { x: 3216, y: 3415, mapID: 0 },
    });
    expect(page.rows[1]?.point).toEqual({ x: 2998, y: 9845, mapID: 6 });
    expect(page.rows[1]?.pageName).toBe("Nurmof's Pickaxe Shop.");
  });

  it('skips rows whose options cell is malformed or empty', () => {
    const names = parseMapBucket(BUCKET_HTML).rows.map((row) => row.pageName);
    expect(names).not.toContain('Broken');
    expect(names).not.toContain('No options');
  });

  it('fails loudly when the wiki changes its columns', () => {
    expect(() => parseMapBucket('<table><tr><th>page</th><th>centre</th></tr></table>')).toThrow(
      /missing expected columns/,
    );
  });

  it('fails loudly when there is no header row', () => {
    expect(() => parseMapBucket('<table></table>')).toThrow(/no header row/);
  });
});

describe('extractMapTemplatePoint', () => {
  it('reads named x/y coordinates and mapID', () => {
    expect(
      extractMapTemplatePoint(
        '{{Infobox Location\n|map = {{Map|name=Grand Exchange|x=3165|y=3490|height=350|width=300}}\n}}',
      ),
    ).toEqual({ x: 3165, y: 3490, mapID: 0 });

    expect(
      extractMapTemplatePoint(
        '|map = {{Map|name=Keldagrim bank|mapID=10|mtype=polygon|2835,10216|2834,10215|2842,10205}}',
      )?.mapID,
    ).toBe(10);
  });

  it('uses the centre of a rectangle', () => {
    // Varrock west bank: the point is the north-west corner.
    expect(
      extractMapTemplatePoint(
        '|map = {{Map|name=Varrock west bank|mtype=rectangle|3185,3440|rectX=11|rectY=15}}',
      ),
    ).toEqual({ x: 3190.5, y: 3432.5, mapID: 0 });
  });

  it('uses the centroid of a polygon', () => {
    const point = extractMapTemplatePoint(
      '|map = {{Map|name=Falador east bank|mtype=polygon|3009,3359|3009,3353|3022,3353|3022,3357|3019,3357|3019,3359}}',
    );

    expect(point?.x).toBeCloseTo(3016.6667, 3);
    expect(point?.y).toBeCloseTo(3356.3333, 3);
    expect(point?.mapID).toBe(0);
  });

  it('returns null when the page has no map template', () => {
    expect(extractMapTemplatePoint('{{Infobox Item|name = Thing}}')).toBeNull();
    expect(extractMapTemplatePoint('|map =   ')).toBeNull();
  });
});

describe('fetchPageMapPoints', () => {
  it('returns a point per page and reports missing pages', async () => {
    const bank = unique('Test bank');
    const missing = unique('Missing bank');

    stubFetch((url) => {
      const requested = (new URL(url).searchParams.get('titles') ?? '').split('|');
      const pages = requested
        .filter((title) => title !== missing)
        .map((title) => ({
          title,
          revisions: [
            {
              slots: {
                main: {
                  content:
                    '{{Infobox Location|map = {{Map|x=1000|y=2000|mapID=3}} }}',
                },
              },
            },
          ],
        }));
      return new Response(JSON.stringify({ query: { pages } }), { status: 200 });
    });

    const result = await fetchPageMapPoints([bank, missing]);

    expect(result.points.get(bank)).toEqual({ x: 1000, y: 2000, mapID: 3 });
    expect(result.points.has(missing)).toBe(false);
    expect(result.missing).toBe(1);
    expect(result.requests).toBe(1);
  });
});
