/// <reference types="node" />
/**
 * Single outbound HTTP gateway.
 *
 * Everything in this repo that touches the network goes through `fetchJson`.
 * That is enforced by convention and by AGENTS.md, and it buys us three things
 * that matter for correctness:
 *
 *  1. A descriptive User-Agent. The OSRS Wiki API *requires* one and will
 *     throttle or block anonymous clients.
 *  2. A hard 1 req/s global limit. Wiki API etiquette, and we never want this
 *     project to be the reason a free service gets degraded.
 *  3. TTL caching + retry-with-backoff, so a refresh job can't hammer anything
 *     and a transient 429 doesn't corrupt a snapshot.
 */

// Node builtins use the `node:` protocol.
//
// An earlier revision used the bare form because a language server here failed to
// resolve the prefixed specifier, reporting "cannot find module" against a file
// `tsc` compiled cleanly. That no longer reproduces (tsc, eslint, vitest, smoke
// and the LSP check are all clean with the prefix), and the bare form raised an
// `enforce-node-protocol` warning. See docs/tooling-notes.md §1.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const CONTACT = process.env.RSCALC_CONTACT ?? "https://github.com/rscalc";
export const USER_AGENT = `rscalc/${VERSION} (+${CONTACT})`;

/** Minimum spacing between two outbound requests, in ms. */
const MIN_INTERVAL_MS = 1000;
/** Default cache lifetime when a caller doesn't specify one. */
const DEFAULT_TTL_MS = 60_000;

const CACHE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".cache",
);

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// ---------------------------------------------------------------------------
// Global serialising rate limiter
// ---------------------------------------------------------------------------

let gate: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function schedule(): Promise<void> {
  const next = gate.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  // Swallow rejections on the chain itself so one failure can't poison the gate.
  gate = next.catch(() => undefined);
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Disk cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  fetchedAt: number;
  url: string;
  body: T;
}

function cacheKeyFor(url: string): string {
  return createHash("sha1").update(url).digest("hex");
}

/**
 * The cache file for a URL.
 *
 * `cacheKeyFor` returns a sha1 digest, which cannot contain a path separator, but
 * the guard states that rather than assuming it: a future change to the key
 * function must not be able to turn a cache write into a path traversal.
 */
function cacheFile(url: string): string {
  const key = cacheKeyFor(url);
  if (!/^[0-9a-f]{40}$/.test(key)) {
    throw new Error(`refusing a non-digest cache key: ${key}`);
  }
  return join(CACHE_DIR, `${key}.json`);
}

async function readCache<T>(
  url: string,
  ttlMs: number,
): Promise<T | undefined> {
  try {
    const raw = await readFile(cacheFile(url), "utf8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.url !== url) return undefined;
    if (Date.now() - entry.fetchedAt > ttlMs) return undefined;
    return entry.body;
  } catch {
    return undefined;
  }
}

async function writeCache<T>(url: string, body: T): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const entry: CacheEntry<T> = { fetchedAt: Date.now(), url, body };
    await writeFile(cacheFile(url), JSON.stringify(entry), "utf8");
  } catch {
    // A cache write failure must never fail a refresh.
  }
}

/** Reads a cache entry ignoring its TTL. Used to report "data as of". */
export async function readCacheTimestamp(
  url: string,
): Promise<number | undefined> {
  try {
    const raw = await readFile(cacheFile(url), "utf8");
    const entry = JSON.parse(raw) as CacheEntry<unknown>;
    return entry.url === url ? entry.fetchedAt : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// fetchJson
// ---------------------------------------------------------------------------

export interface FetchOptions {
  /** Cache lifetime. `0` disables reading from cache (still writes). */
  ttlMs?: number;
  /** Total attempts including the first. */
  attempts?: number;
  /** Extra headers, merged over the defaults. */
  headers?: Record<string, string>;
  /** `Accept` header. Defaults to JSON. */
  accept?: string;
}

export interface FetchResult<T> {
  body: T;
  /** When the payload was actually retrieved from origin (or its cache entry). */
  fetchedAt: number;
  fromCache: boolean;
}

/**
 * GET a text document, honouring the global rate limit, disk cache and retries.
 *
 * Retries on network errors, 429 and 5xx only. A 4xx is a caller bug and is
 * thrown immediately — silently retrying a malformed query wastes the
 * rate-limit budget of a free service.
 */
export async function fetchText(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult<string>> {
  const {
    ttlMs = DEFAULT_TTL_MS,
    attempts = 4,
    headers = {},
    accept = "*/*",
  } = options;

  if (ttlMs > 0) {
    const cached = await readCache<string>(url, ttlMs);
    if (cached !== undefined) {
      return {
        body: cached,
        fetchedAt: (await readCacheTimestamp(url)) ?? Date.now(),
        fromCache: true,
      };
    }
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await schedule();
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          ...headers,
        },
      });

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 2 ** attempt * 1000;
        lastError = new HttpError(
          `HTTP ${response.status} from ${url}`,
          url,
          response.status,
        );
        if (attempt < attempts) await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        throw new HttpError(
          `HTTP ${response.status} from ${url}`,
          url,
          response.status,
        );
      }

      const text = await response.text();
      await writeCache(url, text);
      return { body: text, fetchedAt: Date.now(), fromCache: false };
    } catch (error) {
      if (error instanceof HttpError && error.status && error.status < 500) {
        throw error;
      }
      lastError = error;
      if (attempt < attempts) await sleep(2 ** attempt * 500);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new HttpError(`Failed to fetch ${url}`, url);
}

/**
 * GET a JSON document. Thin wrapper over `fetchText` so that caching, rate
 * limiting and retry behaviour are identical for both.
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult<T>> {
  const result = await fetchText(url, {
    accept: "application/json",
    ...options,
  });
  try {
    return { ...result, body: JSON.parse(result.body) as T };
  } catch {
    throw new HttpError(
      `Expected JSON from ${url} but got ${result.body.slice(0, 120)}`,
      url,
    );
  }
}
