/// <reference types="node" />
/**
 * The server fixture for the browser tests.
 *
 * The pages fetch their artifacts now, so a render test needs a `fetch` that
 * answers like the server: a manifest, then the pinned artifact URLs.
 * The bodies are the real `data/*.json` files, so the tests keep exercising the
 * artifacts the pipeline actually writes instead of a hand-written stand-in.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { vi } from "vitest";

import { ARTIFACT_NAMES, type ArtifactName } from "../../src/api/dataset.js";

export const DATASET_ID = "20260101T000000Z";
export const PRICES_AS_OF = "2026-01-01T00:00:00Z";

/**
 * The artifact exactly as the pipeline wrote it.
 *
 * Resolved from the working directory rather than `import.meta.url`: vitest
 * rewrites module paths, so a relative URL does not point at the repo from inside a
 * transformed test module. Vitest runs from the repo root.
 */
export function readArtifact(name: ArtifactName): unknown {
  const path = join(process.cwd(), "data", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function manifestBody(dataset = DATASET_ID): Record<string, unknown> {
  const artifacts: Record<string, string> = {};
  for (const name of ARTIFACT_NAMES) {
    artifacts[name] = `/api/data/${dataset}/${name}.json`;
  }
  return {
    dataset,
    generatedAt: PRICES_AS_OF,
    pricesAsOf: PRICES_AS_OF,
    publishedAt: PRICES_AS_OF,
    artifacts,
  };
}

/**
 * A minimal `Response`.
 *
 * Built by hand rather than with `new Response(...)` so the fixture does not
 * depend on which fetch globals the jsdom environment exposes; the loader reads
 * exactly `ok`, `status` and `json()`.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

export interface StubOptions {
  /** Answer the manifest with this HTTP status instead of a body. */
  manifestStatus?: number;
  /** Make the whole network fail. */
  offline?: boolean;
  /** Publish a different dataset id, as a later refresh would. */
  dataset?: string;
}

export interface FetchStub {
  fetch: ReturnType<typeof vi.fn>;
  calls: string[];
}

/** Install a `fetch` that answers the dataset API from the repo's artifacts. */
export function stubDatasetFetch(options: StubOptions = {}): FetchStub {
  const calls: string[] = [];
  const fetchStub = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (options.offline === true) return Promise.reject(new TypeError("fetch failed"));

    if (url.endsWith("/api/data/manifest")) {
      return Promise.resolve(
        options.manifestStatus === undefined
          ? jsonResponse(manifestBody(options.dataset ?? DATASET_ID))
          : jsonResponse({ error: "nope" }, options.manifestStatus),
      );
    }

    const match = /\/api\/data\/[^/]+\/([a-z-]+)\.json$/.exec(url);
    const name = match?.[1];
    if (name === undefined || !(ARTIFACT_NAMES as readonly string[]).includes(name)) {
      return Promise.resolve(jsonResponse({ error: "not found" }, 404));
    }
    return Promise.resolve(jsonResponse(readArtifact(name as ArtifactName)));
  });
  vi.stubGlobal("fetch", fetchStub);
  return { fetch: fetchStub, calls };
}
