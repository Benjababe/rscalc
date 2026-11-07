/// <reference types="node" />
/**
 * The refresh scheduler.
 *
 * The pipeline is replaced with a small Node script, so these tests exercise the
 * real spawn -> publish -> status path (including exit codes and timeouts) without
 * pnpm, the network or the 1 req/s limiter.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatasetStore } from "../src/server/datasets.js";
import { setLogTransport } from "../src/server/log.js";
import { RefreshRunningError, Refresher } from "../src/server/refresh.js";
import {
  testConfig,
  writeArtifacts,
  writeFakeBuild,
  writeFakePipeline,
} from "./support/serverFixtures.js";

let root: string;
let dataDir: string;
let store: DatasetStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rscalc-refresh-"));
  dataDir = join(root, "data");
  const storeRoot = join(root, "runtime", "datasets");
  store = new DatasetStore(storeRoot, 3, { now: () => new Date("2026-01-01T00:00:00Z") });
  await store.init();
});

afterEach(async () => {
  setLogTransport(null);
  await rm(root, { recursive: true, force: true });
});

/**
 * Capture the server's own log lines.
 *
 * The point of the refresh job is that pipeline output reaches `journalctl`, not
 * just `/api/status`, so the assertion has to be on the log sink itself.
 */
function captureLog(): { lines: string[]; text: () => string } {
  const lines: string[] = [];
  setLogTransport({
    write: (line: string) => {
      lines.push(line);
    },
  });
  return { lines, text: () => lines.join("") };
}

async function refresherWith(mode: "ok" | "fail" | "slow", overrides: { refreshTimeoutMs?: number } = {}) {
  const script = await writeFakePipeline(join(root, "pipeline"), mode);
  const config = testConfig(root, {
    dataDir,
    refreshCommand: "pnpm refresh",
    refreshTimeoutMs: overrides.refreshTimeoutMs ?? 30_000,
  });
  const refresher = new Refresher(config, store, {
    command: [process.execPath, script, dataDir],
    now: Date.now,
  });
  return refresher;
}

async function waitForSettled(refresher: Refresher, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (refresher.status().state !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`refresh did not settle: ${JSON.stringify(refresher.status())}`);
}

describe("Refresher", () => {
  it("publishes a dataset and records the run", async () => {
    const refresher = await refresherWith("ok");
    refresher.trigger();
    await waitForSettled(refresher);

    const status = refresher.status();
    expect(status.state).toBe("idle");
    expect(status.error).toBeNull();
    expect(status.dataset).toBe(store.current()?.id);
    expect(status.finishedAt).not.toBeNull();
    expect(refresher.logTail(20).join("\n")).toContain("published dataset");
    expect(refresher.logTail(20).join("\n")).toContain("pipeline: pricing 5 artifacts");
  });

  it("reports a pipeline failure and keeps serving the previous dataset", async () => {
    await writeArtifacts(dataDir);
    const first = await store.publish(dataDir);

    const refresher = await refresherWith("fail");
    refresher.trigger();
    await waitForSettled(refresher);

    const status = refresher.status();
    expect(status.state).toBe("error");
    expect(status.error).toMatch(/exited with code 1/);
    expect(store.current()?.id).toBe(first.id);
    expect(refresher.logTail(20).join("\n")).toContain("simulated failure");
  });

  it("rejects a second trigger while one is running", async () => {
    const refresher = await refresherWith("slow");
    refresher.trigger();
    expect(() => refresher.trigger()).toThrow(RefreshRunningError);
    await waitForSettled(refresher);
  });

  it("times out a hung pipeline without publishing", async () => {
    const refresher = await refresherWith("slow", { refreshTimeoutMs: 150 });
    refresher.trigger();
    await waitForSettled(refresher);

    expect(refresher.status().state).toBe("error");
    expect(refresher.status().error).toMatch(/timed out/);
    expect(store.current()).toBeNull();
  });

  it("reports a publish collision instead of claiming success", async () => {
    await writeArtifacts(dataDir);
    await store.publish(dataDir);
    const refresher = await refresherWith("ok");
    refresher.trigger();
    await waitForSettled(refresher);

    expect(refresher.status().state).toBe("error");
    expect(refresher.status().error).toMatch(/already published/);
  });

  it("refuses to trigger when refreshing is disabled", () => {
    const config = testConfig(root, { dataDir, refreshEnabled: false });
    const refresher = new Refresher(config, store, { command: [process.execPath, "-e", ""] });
    expect(() => refresher.trigger()).toThrow(/disabled/);
  });

  it("schedules the next run only after the current one settles", async () => {
    const refresher = await refresherWith("ok");
    refresher.trigger();
    await waitForSettled(refresher);
    expect(refresher.status().nextRunAt).not.toBeNull();
    expect(refresher.status().intervalSeconds).toBe(4 * 60 * 60);
  });
});

describe("Refresher logging and rebuild", () => {
  it("writes every pipeline line to the server log, not just the status tail", async () => {
    const log = captureLog();
    const refresher = await refresherWith("ok");
    refresher.trigger();
    await waitForSettled(refresher);

    const text = log.text();
    expect(text).toContain("refresh started:");
    expect(text).toContain("pipeline: pricing 5 artifacts");
    expect(text).toContain("phase=refresh");
    expect(text).toContain("stream=stdout");
    expect(text).toContain("published dataset");

    // The ring behind /api/status still carries the same lines.
    expect(refresher.logTail(50).join("\n")).toContain("pipeline: pricing 5 artifacts");
  });

  it("logs a child's stderr at warn level with its stream", async () => {
    const log = captureLog();
    const refresher = await refresherWith("fail");
    refresher.trigger();
    await waitForSettled(refresher);

    const failed = log.lines.find((line) => line.includes("simulated failure"));
    expect(failed).toBeDefined();
    expect(failed).toContain("WARN");
    expect(failed).toContain("stream=stderr");
  });

  it("runs an optional rebuild after publishing and logs it too", async () => {
    const log = captureLog();
    const script = await writeFakePipeline(join(root, "pipeline"), "ok");
    const build = await writeFakeBuild(join(root, "pipeline"), "ok");
    const config = testConfig(root, { dataDir, buildCommand: "pnpm build" });
    const refresher = new Refresher(config, store, {
      command: [process.execPath, script, dataDir],
      buildCommand: [process.execPath, build],
    });

    refresher.trigger();
    await waitForSettled(refresher);

    const text = log.text();
    expect(text).toContain("build started:");
    expect(text).toContain("build: bundling the ui");
    expect(text).toContain("build finished");
    expect(text).toContain("phase=build");
    expect(refresher.status().state).toBe("idle");
    expect(store.current()).not.toBeNull();
  });

  it("keeps the published dataset when the rebuild fails, and says so", async () => {
    const log = captureLog();
    const script = await writeFakePipeline(join(root, "pipeline"), "ok");
    const build = await writeFakeBuild(join(root, "pipeline"), "fail");
    const config = testConfig(root, { dataDir, buildCommand: "pnpm build" });
    const refresher = new Refresher(config, store, {
      command: [process.execPath, script, dataDir],
      buildCommand: [process.execPath, build],
    });

    refresher.trigger();
    await waitForSettled(refresher);

    const status = refresher.status();
    expect(status.state).toBe("error");
    expect(status.error).toMatch(/build .*exited with code 2/);
    // The data is fresh and served; only the bundle rebuild failed.
    expect(status.dataset).toBe(store.current()?.id);
    expect(log.text()).toContain("build: vite died");
  });

  it("runs no rebuild when none is configured", async () => {
    const log = captureLog();
    const refresher = await refresherWith("ok");
    refresher.trigger();
    await waitForSettled(refresher);

    expect(log.text()).not.toContain("build started");
    expect(refresher.status().state).toBe("idle");
  });
});

describe("Refresher boot policy", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  async function bootRefresher(
    policy: "auto" | "always" | "never",
    publishedAgoMs: number | null,
  ): Promise<Refresher> {
    const localRoot = await mkdtemp(join(root, "boot-"));
    const localData = join(localRoot, "data");
    const publishedAt = publishedAgoMs === null ? now : new Date(now.getTime() - publishedAgoMs);
    const localStore = new DatasetStore(join(localRoot, "runtime", "datasets"), 3, {
      now: () => publishedAt,
    });
    await localStore.init();
    if (publishedAgoMs !== null) {
      await writeArtifacts(localData);
      await localStore.publish(localData);
    }
    const script = await writeFakePipeline(join(localRoot, "pipeline"), "ok");
    const config = testConfig(localRoot, { dataDir: localData, bootPolicy: policy });
    return new Refresher(config, localStore, {
      command: [process.execPath, script, localData],
      now: () => now.getTime(),
    });
  }

  it("refreshes on boot when nothing is published", async () => {
    expect((await bootRefresher("auto", null)).shouldRefreshOnBoot()).toBe(true);
  });

  it("does not refresh when the dataset is younger than the interval", async () => {
    expect((await bootRefresher("auto", 60 * 60 * 1000)).shouldRefreshOnBoot()).toBe(false);
  });

  it("refreshes when the dataset is at or past the interval", async () => {
    expect((await bootRefresher("auto", 4 * 60 * 60 * 1000)).shouldRefreshOnBoot()).toBe(true);
  });

  it("honours never and always", async () => {
    expect((await bootRefresher("never", null)).shouldRefreshOnBoot()).toBe(false);
    expect((await bootRefresher("always", 60 * 60 * 1000)).shouldRefreshOnBoot()).toBe(true);
  });
});
