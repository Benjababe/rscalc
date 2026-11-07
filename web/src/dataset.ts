/**
 * The served dataset.
 *
 * The pages used to `import` their JSON, which meant the numbers were frozen into
 * the bundle at build time and a price refresh required a rebuild and redeploy.
 * The server publishes a dataset and serves it, so a page loads its
 * artifacts at runtime and a refresh on the server is visible on the next load
 * without touching the frontend build.
 *
 * Two rules keep that safe:
 *
 *  1. **The manifest pins the artifacts.** It carries the dataset id and one URL
 *     per artifact (`/api/data/<id>/<name>.json`). A page resolves the manifest
 *     once and then fetches those exact URLs, so a refresh that swaps the current
 *     dataset mid-load cannot mix two sets of numbers in one table.
 *  2. **Nothing renders before its artifacts are loaded.** `payload()` throws
 *     rather than returning `undefined`; `App` gates each page on `loadDataset`,
 *     and a page module never reads the store at import time.
 */

import { ARTIFACT_NAMES, type ArtifactName } from "../../src/api/dataset";

// Re-exported so callers import one module; the list itself lives in the shared
// contract because the server publishes exactly these five.
export { ARTIFACT_NAMES, type ArtifactName };

import type { Page } from "./route";

/**
 * Which artifacts each page needs. `earn` joins every family, so it needs all of
 * them; the detail pages load only their own artifact plus the access table.
 */
export const PAGE_ARTIFACTS: Record<Page, readonly ArtifactName[]> = {
  earn: ["opportunities", "shop-sinks", "process", "skilling", "shop-access"],
  "shop-to-ge": ["opportunities", "shop-access"],
  "ge-to-shop": ["shop-sinks", "shop-access"],
  processing: ["process", "shop-access"],
  skilling: ["skilling", "shop-access"],
};

export interface DatasetManifest {
  /** Fixed-width UTC stamp, e.g. 20260101T000000Z. */
  dataset: string;
  /** Newest `generatedAt` across the artifacts, or null when unstated. */
  generatedAt: string | null;
  /** When the GE quotes behind the tables were fetched. */
  pricesAsOf: string | null;
  /** When the server copied this set. */
  publishedAt: string | null;
  /** Pinned URL per artifact. */
  artifacts: Record<ArtifactName, string>;
}

/** A manifest or artifact the browser could not use. */
export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

const MANIFEST_URL = "/api/data/manifest";

let manifest: DatasetManifest | null = null;
const artifacts = new Map<ArtifactName, unknown>();
let loading: Promise<DatasetManifest> | null = null;

/** The dataset this page is showing, or null before the first load. */
export function currentManifest(): DatasetManifest | null {
  return manifest;
}

/** True when every named artifact is already in memory. */
export function artifactsLoaded(names: readonly ArtifactName[]): boolean {
  return names.every((name) => artifacts.has(name));
}

/**
 * One artifact of the current dataset.
 *
 * Returns `unknown`: each page casts it to the shape its script validated, and
 * those casts are documented where they happen. The server will only publish a
 * file that parsed as JSON, so the failure mode this can still hide is a schema
 * change between the pipeline and this bundle — which the casts' comments already
 * flag as the one place to look.
 */
export function payload(name: ArtifactName): unknown {
  if (!artifacts.has(name)) {
    throw new Error(
      `dataset artifact "${name}" is not loaded; loadDataset() must resolve before a page renders`,
    );
  }
  return artifacts.get(name);
}

/**
 * Load the artifacts a page needs, resolving immediately when they are already
 * in memory. Concurrent callers share one in-flight request (React 18's
 * StrictMode double-invokes effects in development).
 */
export async function loadDataset(
  needed: readonly ArtifactName[],
): Promise<DatasetManifest> {
  if (manifest !== null && artifactsLoaded(needed)) return manifest;
  if (loading === null) {
    loading = fetchDataset(needed).finally(() => {
      loading = null;
    });
  }
  const loaded = await loading;
  // A second caller may need an artifact the first did not ask for.
  if (!artifactsLoaded(needed)) return loadDataset(needed);
  return loaded;
}

async function fetchDataset(needed: readonly ArtifactName[]): Promise<DatasetManifest> {
  const next = await fetchManifest();
  const missing = needed.filter((name) => !artifacts.has(name));
  const bodies = await Promise.all(
    missing.map(async (name) => [name, await fetchArtifact(name, next.artifacts[name])] as const),
  );
  for (const [name, body] of bodies) artifacts.set(name, body);
  manifest = next;
  return next;
}

async function fetchManifest(): Promise<DatasetManifest> {
  // The manifest must never be cached: it is the one thing that changes when a new
  // dataset lands. The artifact URLs it pins are immutable, so those may be cached.
  const response = await request(MANIFEST_URL, "no-store");
  if (response.status === 503) {
    throw new DatasetError(
      "The server has no prices published yet: its first refresh has not finished. Check /api/status and reload.",
    );
  }
  if (!response.ok) {
    throw new DatasetError(`Cannot load ${MANIFEST_URL}: HTTP ${response.status}`);
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new DatasetError(`${MANIFEST_URL} did not return JSON`);
  }
  return parseManifest(raw);
}

async function fetchArtifact(name: ArtifactName, url: string): Promise<unknown> {
  const response = await request(url);
  if (!response.ok) {
    throw new DatasetError(`Cannot load the ${name} data: HTTP ${response.status} (${url})`);
  }
  try {
    return await response.json();
  } catch {
    throw new DatasetError(`The ${name} data at ${url} is not valid JSON`);
  }
}

async function request(url: string, cache: RequestCache = "default"): Promise<Response> {
  try {
    return await fetch(url, { cache, headers: { Accept: "application/json" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DatasetError(`Cannot reach the rscalc server (${url}): ${reason}`);
  }
}

/**
 * Validate the manifest before anything trusts it. The server is ours, but an
 * error page or a proxy returning HTML must fail with a message that says what is
 * wrong instead of a `undefined is not an object` three components later.
 */
function parseManifest(raw: unknown): DatasetManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new DatasetError("The dataset manifest is not an object");
  }
  const record = raw as Record<string, unknown>;
  const dataset = record.dataset;
  if (typeof dataset !== "string" || dataset === "") {
    throw new DatasetError("The dataset manifest has no dataset id");
  }
  const rawArtifacts = record.artifacts;
  if (typeof rawArtifacts !== "object" || rawArtifacts === null) {
    throw new DatasetError(`Dataset ${dataset} lists no artifacts`);
  }
  const artifactsRecord = rawArtifacts as Record<string, unknown>;
  const pinned = {} as Record<ArtifactName, string>;
  for (const name of ARTIFACT_NAMES) {
    const url = artifactsRecord[name];
    if (typeof url !== "string" || url === "") {
      throw new DatasetError(`Dataset ${dataset} does not publish the "${name}" artifact`);
    }
    pinned[name] = url;
  }
  return {
    dataset,
    generatedAt: optionalString(record.generatedAt),
    pricesAsOf: optionalString(record.pricesAsOf),
    publishedAt: optionalString(record.publishedAt),
    artifacts: pinned,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * True when the server has published a dataset other than the one on screen.
 * Polled by the shell so a long-lived tab is told the numbers are stale (a 4-hour
 * refresh is invisible to a page that loaded before it).
 */
export async function datasetIsStale(): Promise<string | null> {
  if (manifest === null) return null;
  let response: Response;
  try {
    response = await fetch(MANIFEST_URL, { cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    const next = parseManifest(await response.json());
    return next.dataset === manifest.dataset ? null : next.dataset;
  } catch {
    return null;
  }
}

/** Drop everything loaded. Used by tests to get a cold store per case. */
export function resetDataset(): void {
  manifest = null;
  artifacts.clear();
  loading = null;
}
