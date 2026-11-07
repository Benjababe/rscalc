/**
 * The API contract between the server and the browser.
 *
 * Dependency-free on purpose: the web bundle imports these names, so anything
 * added here ships to the browser. The server validates the payloads it writes
 * with zod in its own modules, next to the code that produces them.
 */

/**
 * The artifacts the UI consumes. `pnpm refresh` writes exactly these five into
 * `data/`, the server publishes them as one dataset, and a page loads the subset
 * it needs.
 */
export const ARTIFACT_NAMES = [
  "opportunities",
  "shop-sinks",
  "process",
  "skilling",
  "shop-access",
] as const;

export type ArtifactName = (typeof ARTIFACT_NAMES)[number];

/** Where the shell asks which dataset is current and where its files are. */
export const MANIFEST_PATH = "/api/data/manifest";

/** Pinned artifact URL. The dataset id in the path makes the response immutable. */
export function artifactPath(dataset: string, name: ArtifactName): string {
  return `/api/data/${dataset}/${name}.json`;
}

/**
 * What `GET /api/data/manifest` returns.
 *
 * The URLs are pinned to the dataset id rather than to "current", so a page that
 * read the manifest keeps loading one consistent set of numbers even if a refresh
 * swaps the served dataset while it is still fetching.
 */
export interface DatasetManifest {
  dataset: string;
  generatedAt: string | null;
  pricesAsOf: string | null;
  publishedAt: string | null;
  artifacts: Record<ArtifactName, string>;
}

/** How a dataset id is written: fixed-width UTC, safe as a URL segment. */
export const DATASET_ID_PATTERN = /^\d{8}T\d{6}Z$/;

/** Timestamp layout matching `DATASET_ID_PATTERN`. */
export function datasetIdFrom(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
