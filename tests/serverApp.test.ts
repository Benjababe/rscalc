/// <reference types="node" />
/**
 * The HTTP surface, over a real socket.
 *
 * One process per case on an ephemeral port, raw `node:http` requests so the tests
 * see exactly what a browser would: status codes, caching headers, and gzip bytes
 * that fetch would have silently decompressed.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatasetManifest } from "../src/api/dataset.js";
import { createApp } from "../src/server/app.js";
import type { ServerConfig } from "../src/server/config.js";
import { DatasetStore } from "../src/server/datasets.js";
import { Refresher } from "../src/server/refresh.js";
import { StaticFiles } from "../src/server/staticFiles.js";
import {
  rawRequest,
  start,
  testConfig,
  writeArtifacts,
  writeFakePipeline,
  writeWebDist,
  type RawResponse,
  type RunningServer,
} from "./support/serverFixtures.js";

interface Harness {
  server: RunningServer;
  config: ServerConfig;
  store: DatasetStore;
  refresher: Refresher;
  root: string;
  dataDir: string;
  /** Moves the publish clock, so a refresh does not collide with the fixture. */
  advanceClock: () => void;
}

let harness: Harness | null = null;

async function setup(options: { publish?: boolean; refreshToken?: string } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "rscalc-app-"));
  const dataDir = join(root, "data");
  const webDir = join(root, "web", "dist");
  const runtimeDir = join(root, "runtime");
  await writeArtifacts(dataDir);
  await writeWebDist(webDir);

  let clock = new Date("2026-01-01T00:00:00Z");
  const store = new DatasetStore(join(runtimeDir, "datasets"), 3, { now: () => clock });
  await store.init();
  if (options.publish !== false) await store.publish(dataDir);

  const config = testConfig(root, {
    dataDir,
    webDir,
    runtimeDir,
    refreshToken: options.refreshToken ?? "",
  });
  const script = await writeFakePipeline(join(root, "pipeline"), "ok");
  const refresher = new Refresher(config, store, {
    command: [process.execPath, script, dataDir],
    now: Date.now,
  });
  const statics = new StaticFiles(webDir);
  const server = await start(createApp({ config, store, refresher, statics }));
  return {
    server,
    config,
    store,
    refresher,
    root,
    dataDir,
    advanceClock: () => {
      clock = new Date(clock.getTime() + 1000);
    },
  };
}

beforeEach(async () => {
  harness = await setup();
});

afterEach(async () => {
  if (harness !== null) {
    await harness.server.close();
    await rm(harness.root, { recursive: true, force: true });
    harness = null;
  }
});

function current(): Harness {
  if (harness === null) throw new Error("harness missing");
  return harness;
}

async function get(path: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return rawRequest(current().server.port, path, { headers });
}

async function getJSON<T>(path: string): Promise<{ response: RawResponse; body: T }> {
  const response = await get(path);
  return { response, body: JSON.parse(response.body.toString("utf8")) as T };
}

describe("health and status", () => {
  it("reports the served dataset", async () => {
    const { response, body } = await getJSON<{ ok: boolean; published: boolean; dataset: string }>("/healthz");
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.published).toBe(true);
    expect(body.dataset).toBe(current().store.current()?.id);
  });

  it("reports the schedule and the dataset in /api/status", async () => {
    const { response, body } = await getJSON<{
      refresh: { state: string; intervalSeconds: number; dataset: string | null };
      dataset: { id: string; pricesAsOf: string | null } | null;
      config: { refreshEnabled: boolean; command: string; buildCommand: string };
    }>("/api/status");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(body.refresh.state).toBe("idle");
    expect(body.refresh.intervalSeconds).toBe(4 * 60 * 60);
    expect(body.refresh.dataset).toBe(current().store.current()?.id);
    expect(body.dataset?.id).toBe(current().store.current()?.id);
    expect(body.config.command).toBe("pnpm refresh");
    expect(body.config.buildCommand).toBe("");
  });
});

describe("the data API", () => {
  it("publishes a manifest that pins every artifact to one dataset", async () => {
    const { response, body } = await getJSON<DatasetManifest>("/api/data/manifest");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const dataset = current().store.current();
    expect(body.dataset).toBe(dataset?.id);
    expect(body.pricesAsOf).toBe(dataset?.pricesAsOf);

    const urls = Object.entries(body.artifacts);
    expect(urls.map(([name]) => name).sort()).toEqual(
      ["opportunities", "process", "shop-access", "shop-sinks", "skilling"],
    );
    for (const [, url] of urls) {
      expect(url).toBe(`/api/data/${String(dataset?.id)}/${url.split("/").pop() ?? ""}`);
    }
  });

  it("answers 304 for a manifest the caller already has", async () => {
    const first = await get("/api/data/manifest");
    const etag = String(first.headers.etag);
    const again = await get("/api/data/manifest", { "If-None-Match": etag });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it("answers 503 with a next step before anything is published", async () => {
    await current().server.close();
    await rm(current().root, { recursive: true, force: true });
    harness = await setup({ publish: false });

    const { response, body } = await getJSON<{ error: string; hint: string }>("/api/data/manifest");
    expect(response.status).toBe(503);
    expect(body.hint).toContain("/api/status");
  });

  it("serves the precompressed artifact and marks it immutable", async () => {
    const dataset = current().store.current();
    const path = `/api/data/${String(dataset?.id)}/opportunities.json`;
    const response = await get(path, { "Accept-Encoding": "gzip" });
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers["cache-control"]).toContain("immutable");
    expect(response.headers["content-type"]).toContain("application/json");

    const plain = await readFile(join(dataset?.dir ?? "", "opportunities.json"), "utf8");
    expect(gunzipSync(response.body).toString("utf8")).toBe(plain);

    const etag = String(response.headers.etag);
    const revalidated = await get(path, { "If-None-Match": etag });
    expect(revalidated.status).toBe(304);
  });

  it("serves plain JSON to a client that cannot decompress", async () => {
    const dataset = current().store.current();
    const response = await get(`/api/data/${String(dataset?.id)}/shop-access.json`);
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(response.body.toString("utf8"))).toBeTypeOf("object");
  });

  it("404s unknown artifacts, unknown datasets and traversal attempts", async () => {
    const id = String(current().store.current()?.id);
    for (const path of [
      `/api/data/${id}/secret.json`,
      `/api/data/${id}/opportunities.json.txt`,
      `/api/data/${id}/opportunities`,
      "/api/data/19990101T000000Z/opportunities.json",
      "/api/data/garbage/opportunities.json",
      "/api/data/%2e%2e%2f%2e%2e%2fetc/opportunities.json",
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
    }
  });

  it("keeps serving a pinned older dataset after a refresh lands", async () => {
    const old = current().store.current();
    await writeArtifacts(current().dataDir);
    current().advanceClock();
    const next = await current().store.publish(current().dataDir);
    expect(next.id).not.toBe(old?.id);

    const pinned = await get(`/api/data/${String(old?.id)}/opportunities.json`);
    expect(pinned.status).toBe(200);

    const { body } = await getJSON<DatasetManifest>("/api/data/manifest");
    expect(body.dataset).toBe(next.id);
  });
});

describe("the SPA", () => {
  it("serves index.html without caching it", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body.toString("utf8")).toContain("rscalc");
  });

  it("serves hashed assets immutably and compressed", async () => {
    const response = await get("/assets/app-abc123.js", { "Accept-Encoding": "gzip" });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
    expect(response.headers["content-type"]).toContain("text/javascript");
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(response.body).toString("utf8")).toContain("console.log");
  });

  it("404s a missing asset instead of returning index.html", async () => {
    const response = await get("/assets/gone-000000.js");
    expect(response.status).toBe(404);
    expect(response.body.toString("utf8")).not.toContain("<html");
  });

  it("falls back to the shell for an unknown path", async () => {
    const response = await get("/some/deep/link");
    expect(response.status).toBe(200);
    expect(response.body.toString("utf8")).toContain("rscalc");
  });

  it("explains how to build the bundle when web/dist is missing", async () => {
    await rm(join(current().root, "web"), { recursive: true, force: true });
    const response = await get("/");
    expect(response.status).toBe(503);
    expect(response.body.toString("utf8")).toContain("pnpm build");
  });

  it("does not serve the SPA for an unknown API path", async () => {
    const response = await get("/api/nope");
    expect(response.status).toBe(404);
    expect(response.body.toString("utf8")).not.toContain("<html");
  });

  it("does not escape the web root", async () => {
    await writeFile(join(current().root, "secret.txt"), "nope");
    for (const path of ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt"]) {
      const response = await get(path);
      expect(response.body.toString("utf8")).not.toContain("nope");
    }
  });
});

describe("POST /api/refresh", () => {
  it("is disabled without a token", async () => {
    const response = await rawRequest(current().server.port, "/api/refresh", { method: "POST" });
    expect(response.status).toBe(403);
    expect(response.body.toString("utf8")).toContain("RSCALC_REFRESH_TOKEN");
  });

  it("rejects a wrong token and accepts the right one", async () => {
    await current().server.close();
    await rm(current().root, { recursive: true, force: true });
    harness = await setup({ refreshToken: "s3cret" });

    const wrong = await rawRequest(current().server.port, "/api/refresh", {
      method: "POST",
      headers: { "X-Rscalc-Token": "nope" },
    });
    expect(wrong.status).toBe(403);

    current().advanceClock();
    const accepted = await rawRequest(current().server.port, "/api/refresh", {
      method: "POST",
      headers: { "X-Rscalc-Token": "s3cret" },
    });
    expect(accepted.status).toBe(202);

    const deadline = Date.now() + 15_000;
    while (current().refresher.status().state === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(current().refresher.status().state).toBe("idle");
  });
});
