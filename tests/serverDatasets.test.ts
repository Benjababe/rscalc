/// <reference types="node" />
/**
 * The dataset store: publish is all-or-nothing, ids are URL-safe, and pruning
 * never deletes the set that is being served.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ARTIFACT_NAMES } from "../src/api/dataset.js";
import { DatasetStore, isDatasetId } from "../src/server/datasets.js";
import { writeArtifacts } from "./support/serverFixtures.js";

let root: string;
let dataDir: string;
let storeRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rscalc-store-"));
  dataDir = join(root, "data");
  storeRoot = join(root, "runtime", "datasets");
  await writeArtifacts(dataDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function newStore(keep = 3, now?: () => Date): Promise<DatasetStore> {
  const store = new DatasetStore(storeRoot, keep, now === undefined ? {} : { now });
  await store.init();
  return store;
}

describe("DatasetStore", () => {
  it("publishes every artifact, compressed, plus a meta and a pointer", async () => {
    const store = await newStore();
    const dataset = await store.publish(dataDir);

    expect(isDatasetId(dataset.id)).toBe(true);
    for (const name of ARTIFACT_NAMES) {
      const plain = await readFile(join(dataset.dir, `${name}.json`), "utf8");
      const compressed = await readFile(join(dataset.dir, `${name}.json.gz`));
      expect(gunzipSync(compressed).toString("utf8")).toBe(plain);
    }
    const pointer = await readFile(join(storeRoot, "current"), "utf8");
    expect(pointer.trim()).toBe(dataset.id);
    expect(store.current()?.id).toBe(dataset.id);

    const meta: unknown = JSON.parse(await readFile(join(dataset.dir, "meta.json"), "utf8"));
    expect(meta).toMatchObject({ id: dataset.id, artifacts: [...ARTIFACT_NAMES] });
  });

  it("takes the newest timestamp across the artifacts", async () => {
    await writeArtifacts(dataDir, {
      opportunities: "2026-01-02T00:00:00Z",
      process: "2026-01-03T00:00:00Z",
      skilling: "2026-01-01T00:00:00Z",
    });
    const dataset = await (await newStore()).publish(dataDir);
    expect(dataset.generatedAt).toBe("2026-01-03T00:00:00Z");
    expect(dataset.pricesAsOf).toBe("2026-01-03T00:00:00Z");
  });

  it("refuses invalid JSON and leaves the served dataset alone", async () => {
    let clock = new Date("2026-01-01T00:00:00Z");
    const store = await newStore(3, () => clock);
    const first = await store.publish(dataDir);
    clock = new Date(clock.getTime() + 1000);

    await writeArtifacts(dataDir, {}, { skilling: '{"generatedAt":"2026-01-02T00:00:00Z","skills":[' });
    await expect(store.publish(dataDir)).rejects.toThrow(/not valid JSON/);

    expect(store.current()?.id).toBe(first.id);
    const entries = await readdir(storeRoot);
    expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a data dir that is missing an artifact", async () => {
    const store = await newStore();
    await rm(join(dataDir, "shop-access.json"));
    await expect(store.publish(dataDir)).rejects.toThrow(/shop-access/);
    expect(store.current()).toBeNull();
  });

  it("keeps the previous dataset readable after a publish", async () => {
    let clock = new Date("2026-01-01T00:00:00Z");
    const store = await newStore(3, () => clock);
    const first = await store.publish(dataDir);
    clock = new Date("2026-01-01T00:00:01Z");
    const second = await store.publish(dataDir);

    expect(second.id).not.toBe(first.id);
    expect((await store.load(first.id))?.id).toBe(first.id);
    expect(store.current()?.id).toBe(second.id);
  });

  it("prunes to the configured count but never the served dataset", async () => {
    let clock = new Date("2026-01-01T00:00:00Z");
    const store = await newStore(2, () => clock);
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      clock = new Date(clock.getTime() + 1000);
      ids.push((await store.publish(dataDir)).id);
    }

    expect(await store.load(ids[0] ?? "")).toBeNull();
    expect((await store.load(ids[2] ?? ""))?.id).toBe(ids[2]);
    expect(store.current()?.id).toBe(ids[3]);

    const dirs = (await readdir(storeRoot)).filter((name) => isDatasetId(name));
    expect(dirs.sort()).toEqual([ids[2], ids[3]].sort());
  });

  it("refuses to reuse a dataset id from the same second", async () => {
    const store = await newStore(3, () => new Date("2026-05-01T12:00:00Z"));
    await store.publish(dataDir);
    await expect(store.publish(dataDir)).rejects.toThrow(/already published/);
  });

  it("rejects anything that is not a dataset id as a path segment", async () => {
    const store = await newStore();
    for (const id of ["", "..", "../datasets", "20260101T000000Z/../..", "20260101T000000Z.json"]) {
      expect(await store.load(id)).toBeNull();
    }
  });

  it("resumes the published dataset after a restart", async () => {
    const first = await (await newStore()).publish(dataDir);
    const reopened = await newStore();
    expect(reopened.current()?.id).toBe(first.id);
    expect(reopened.current()?.pricesAsOf).toBe(first.pricesAsOf);
  });

  it("survives a broken pointer by serving nothing until the next refresh", async () => {
    await (await newStore()).publish(dataDir);
    await writeFile(join(storeRoot, "current"), "garbage\n");
    const reopened = await newStore();
    expect(reopened.current()).toBeNull();
  });
});

describe("ARTIFACT_NAMES", () => {
  it("is the five artifacts the pipeline writes", () => {
    // The UI's PAGE_ARTIFACTS and the server's publish loop both read this list,
    // so a sixth artifact is one edit, not three.
    expect([...ARTIFACT_NAMES]).toEqual([
      "opportunities",
      "shop-sinks",
      "process",
      "skilling",
      "shop-access",
    ]);
  });
});
