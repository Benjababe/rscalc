import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, HttpError, USER_AGENT } from "../src/api/http.js";

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

function stubFetch(handler: (url: string, init?: RequestInit) => Response): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(requestUrl(input), init)),
  );
}

describe('fetchJson', () => {
  it('sends the descriptive User-Agent the wiki API requires', async () => {
    let seenAgent: string | null = null;
    stubFetch((_url, init) => {
      seenAgent = new Headers(init?.headers).get('user-agent');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await fetchJson(`https://example.test/ua-${Date.now()}`, { ttlMs: 0 });

    expect(seenAgent).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^rscalc\/\d+\.\d+\.\d+ \(\+.*\)$/);
  });

  it('parses JSON bodies', async () => {
    stubFetch(() => new Response(JSON.stringify({ hello: 'world' }), { status: 200 }));
    const result = await fetchJson<{ hello: string }>(`https://example.test/json-${Date.now()}`, {
      ttlMs: 0,
    });
    expect(result.body.hello).toBe('world');
    expect(result.fromCache).toBe(false);
  });

  it('serves a second request from cache when the TTL is warm', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response(JSON.stringify({ n: calls }), { status: 200 });
    });

    const url = `https://example.test/cache-${Date.now()}`;
    const first = await fetchJson<{ n: number }>(url, { ttlMs: 60_000 });
    const second = await fetchJson<{ n: number }>(url, { ttlMs: 60_000 });

    expect(calls).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(second.body).toEqual(first.body);
  });

  it('throws immediately on a 4xx without retrying', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return new Response('nope', { status: 404 });
    });

    await expect(
      fetchJson(`https://example.test/404-${Date.now()}`, { ttlMs: 0, attempts: 4 }),
    ).rejects.toBeInstanceOf(HttpError);

    // A 4xx is a caller bug; retrying would waste a free service's budget.
    expect(calls).toBe(1);
  });

  it('reports a clear error when the body is not JSON', async () => {
    stubFetch(() => new Response('<html>not json</html>', { status: 200 }));
    await expect(
      fetchJson(`https://example.test/bad-${Date.now()}`, { ttlMs: 0 }),
    ).rejects.toThrow(/Expected JSON/);
  });
});
