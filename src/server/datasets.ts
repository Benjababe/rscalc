/// <reference types="node" />
/**
 * Published datasets.
 *
 * The pipeline writes `data/*.json` in place, one file at a time. Serving those
 * directly would mean a request could read a half-written artifact, and a refresh
 * could leave the UI with one new artifact and one old one. So the server
 * publishes a **dataset**: it copies all five artifacts into a directory named
 * with a UTC stamp, validates each one parses, precompresses it, and only then
 * swaps the `current` pointer — one `rename(2)`, so a reader sees the old set or
 * the new set and nothing in between.
 *
 * Older datasets are kept (default three) for two reasons: a tab that loaded the
 * previous manifest holds pinned URLs, and a bad refresh can be rolled back by
 * pointing `current` at the previous directory.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";

import {
  ARTIFACT_NAMES,
  DATASET_ID_PATTERN,
  datasetIdFrom,
  type ArtifactName,
} from "../api/dataset.js";
import { messageOf, warn } from "./log.js";

const gzip = promisify(gzipCallback);

const POINTER_FILE = "current";
const META_FILE = "meta.json";

/** One immutable, published set of artifacts. */
export interface Dataset {
  id: string;
  dir: string;
  /** Newest `generatedAt` across the artifacts, or null when none states one. */
  generatedAt: string | null;
  /** When the GE quotes behind the tables were fetched. */
  pricesAsOf: string | null;
  /** When this server published the set (ISO). */
  publishedAt: string;
}

interface DatasetMeta {
  id: string;
  generatedAt: string | null;
  pricesAsOf: string | null;
  publishedAt: string;
  artifacts: readonly string[];
}

export interface DatasetStoreOptions {
  now?: () => Date;
}

/** `data-…` ids are the only thing the store will accept as a path segment. */
export function isDatasetId(value: string): boolean {
  return DATASET_ID_PATTERN.test(value);
}

export class DatasetStore {
  private readonly root: string;
  private readonly keep: number;
  private readonly now: () => Date;
  private readonly retained = new Map<string, Dataset>();
  private currentDataset: Dataset | null = null;
  private publishing = false;

  constructor(root: string, keep: number, options: DatasetStoreOptions = {}) {
    if (keep < 2) throw new Error(`keepSnapshots must be at least 2, got ${keep}`);
    this.root = root;
    this.keep = keep;
    this.now = options.now ?? (() => new Date());
  }

  /** Read the pointer left by the previous process. A broken pointer is not fatal. */
  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try {
      const dataset = await this.readPointer();
      if (dataset !== null) {
        this.currentDataset = dataset;
        this.retained.set(dataset.id, dataset);
      }
    } catch (cause) {
      warn("published dataset is unreadable; waiting for the next refresh", {
        error: messageOf(cause),
      });
    }
  }

  /** The dataset the API serves, or null before the first publish. */
  current(): Dataset | null {
    return this.currentDataset;
  }

  /**
   * Resolve a dataset id, including a retained older one: a page that read the
   * previous manifest must keep loading its pinned URLs after a refresh lands.
   */
  async load(id: string): Promise<Dataset | null> {
    if (!isDatasetId(id)) return null;
    const cached = this.retained.get(id);
    if (cached !== undefined) return cached;
    try {
      const dataset = await readDataset(join(this.root, id), id);
      this.retained.set(id, dataset);
      return dataset;
    } catch {
      return null;
    }
  }

  /**
   * Publish `dataDir` as a new dataset.
   *
   * All-or-nothing: a missing or malformed artifact throws, the staging directory
   * is removed, and the served dataset is untouched.
   */
  async publish(dataDir: string): Promise<Dataset> {
    if (this.publishing) throw new Error("a publish is already in progress");
    this.publishing = true;
    try {
      return await this.publishLocked(dataDir);
    } finally {
      this.publishing = false;
    }
  }

  private async publishLocked(dataDir: string): Promise<Dataset> {
    const id = datasetIdFrom(this.now());
    const finalDir = join(this.root, id);
    if (await pathExists(finalDir)) {
      throw new Error(`dataset ${id} already published; wait for the next second`);
    }

    const staging = join(this.root, `.${id}.tmp`);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });

    let published = false;
    try {
      let newestGenerated: string | null = null;
      let newestPrices: string | null = null;

      for (const name of ARTIFACT_NAMES) {
        const { raw, parsed } = await readArtifact(dataDir, name);
        const timestamps = artifactTimestamps(parsed);
        newestGenerated = newestTimestamp(newestGenerated, timestamps.generatedAt);
        newestPrices = newestTimestamp(newestPrices, timestamps.pricesAsOf);

        await writeFile(join(staging, `${name}.json`), raw);
        await writeFile(join(staging, `${name}.json.gz`), await gzip(Buffer.from(raw, "utf8"), {
          level: 9,
        }));
      }

      const meta: DatasetMeta = {
        id,
        generatedAt: newestGenerated,
        pricesAsOf: newestPrices,
        publishedAt: this.now().toISOString(),
        artifacts: ARTIFACT_NAMES,
      };
      await writeFile(join(staging, META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
      await rename(staging, finalDir);
      published = true;

      const dataset: Dataset = {
        id,
        dir: finalDir,
        generatedAt: newestGenerated,
        pricesAsOf: newestPrices,
        publishedAt: meta.publishedAt,
      };
      await this.writePointer(id);
      this.currentDataset = dataset;
      this.retained.set(id, dataset);
      await this.prune(id);
      return dataset;
    } finally {
      // Only a successful publish leaves the staging name behind (as the final
      // directory); anything else is cleaned up so the id can be reused later.
      if (!published) await rm(staging, { recursive: true, force: true });
    }
  }

  /** Delete all but the newest `keep` datasets, never the served one. */
  private async prune(currentId: string): Promise<void> {
    let entries: string[];
    try {
      entries = (await readdir(this.root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && isDatasetId(entry.name))
        .map((entry) => entry.name);
    } catch (cause) {
      warn("cannot list datasets for pruning", { error: messageOf(cause) });
      return;
    }

    // Fixed-width UTC stamps sort lexicographically in chronological order.
    entries.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    const keep = new Set<string>([currentId]);
    for (const id of entries) {
      if (keep.size >= this.keep) break;
      keep.add(id);
    }
    for (const id of entries) {
      if (keep.has(id)) continue;
      try {
        await rm(join(this.root, id), { recursive: true, force: true });
        this.retained.delete(id);
      } catch (cause) {
        warn("cannot prune dataset", { dataset: id, error: messageOf(cause) });
      }
    }
  }

  private async readPointer(): Promise<Dataset | null> {
    const raw = await readFile(join(this.root, POINTER_FILE), "utf8").catch((cause: unknown) => {
      if (isNotFound(cause)) return null;
      throw cause;
    });
    if (raw === null) return null;
    const id = raw.trim();
    if (!isDatasetId(id)) throw new Error(`current pointer holds a malformed dataset id "${id}"`);
    return readDataset(join(this.root, id), id);
  }

  private async writePointer(id: string): Promise<void> {
    const staging = join(this.root, `.${POINTER_FILE}.tmp`);
    await writeFile(staging, `${id}\n`);
    await rename(staging, join(this.root, POINTER_FILE));
  }
}

async function readDataset(dir: string, id: string): Promise<Dataset> {
  const raw = await readFile(join(dir, META_FILE), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error(`dataset ${id} meta is not an object`);
  // SAFETY: the object was written by this module; the fields are checked below.
  const meta = parsed as Partial<DatasetMeta>;
  if (meta.id !== id) throw new Error(`dataset ${id} meta says "${String(meta.id)}"`);
  for (const name of ARTIFACT_NAMES) {
    await stat(join(dir, `${name}.json`));
  }
  return {
    id,
    dir,
    generatedAt: optionalString(meta.generatedAt),
    pricesAsOf: optionalString(meta.pricesAsOf),
    publishedAt: typeof meta.publishedAt === "string" ? meta.publishedAt : "",
  };
}

/**
 * Read one artifact and refuse anything that is not a JSON object.
 *
 * The pipeline validates each artifact with zod before writing it; this is the
 * second gate, for the case that matters here — a file truncated by a killed
 * refresh, or a script that died halfway through writing 8 MB of JSON.
 */
async function readArtifact(
  dataDir: string,
  name: ArtifactName,
): Promise<{ raw: string; parsed: Record<string, unknown> }> {
  const path = join(dataDir, `${name}.json`);
  const raw = await readFile(path, "utf8").catch((cause: unknown) => {
    throw new Error(`reading artifact ${name}: ${messageOf(cause)}`);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`artifact ${name} is not valid JSON (${String(raw.length)} bytes)`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`artifact ${name} is not a JSON object`);
  }
  // SAFETY: JSON.parse returned an object, and the guard above excluded null and
  // arrays; every value stays unknown until optionalString checks it.
  return { raw, parsed: parsed as Record<string, unknown> };
}

function artifactTimestamps(artifact: Record<string, unknown>): {
  generatedAt: string | null;
  pricesAsOf: string | null;
} {
  return {
    generatedAt: optionalString(artifact.generatedAt),
    pricesAsOf: optionalString(artifact.pricesAsOf),
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Keep whichever RFC3339 timestamp is later, echoing the original string. */
function newestTimestamp(current: string | null, candidate: string | null): string | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  const a = Date.parse(current);
  const b = Date.parse(candidate);
  if (Number.isNaN(a)) return candidate;
  if (Number.isNaN(b)) return current;
  return b > a ? candidate : current;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === "ENOENT"
  );
}
