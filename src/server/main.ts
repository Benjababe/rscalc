/// <reference types="node" />
/**
 * `pnpm serve` — the rscalc server.
 *
 * It exists because the calculator's numbers are built, not queried: every table
 * in `data/*.json` comes from the wiki and price APIs, and the pure planners in
 * `src/domain` turn them into rankings. This process owns the two things a static
 * host could not do:
 *
 *  1. serve the built SPA *and* the published dataset, so a page renders current
 *     prices instead of a bundle compiled at build time;
 *  2. run the refresh pipeline on a schedule and publish a new dataset
 *     atomically, keeping the previous ones for open tabs and for rollback.
 *
 * It computes nothing itself: `pnpm refresh` remains the single source of truth
 * for every number, its zod schemas and its 1 request/second budget.
 */

import { join } from "node:path";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadEnvFile, resolveEnvFile } from "./env.js";
import { DatasetStore } from "./datasets.js";
import { error as logError, info, messageOf } from "./log.js";
import { Refresher } from "./refresh.js";
import { StaticFiles } from "./staticFiles.js";

async function main(): Promise<void> {
  // A repo-root `.env` is a convenience for local runs; the real environment wins,
  // so systemd's EnvironmentFile and Docker's -e keep working unchanged.
  const envFile = loadEnvFile(resolveEnvFile((key) => process.env[key], process.cwd()));
  if (envFile.loaded) {
    info("loaded environment file", {
      path: envFile.path,
      applied: envFile.applied.join(",") === "" ? undefined : envFile.applied.join(","),
      ignored: envFile.skipped.join(",") === "" ? undefined : envFile.skipped.join(","),
    });
  }

  const config = loadConfig((key) => process.env[key]);

  const store = new DatasetStore(join(config.runtimeDir, "datasets"), config.keepSnapshots);
  await store.init();

  const refresher = new Refresher(config, store);
  const statics = new StaticFiles(config.webDir);
  const app = createApp({ config, store, refresher, statics });

  const shutdown = new AbortController();
  refresher.start(shutdown.signal);

  const current = store.current();
  if (current === null) {
    info("no dataset published yet; /api/data answers 503 until the first refresh finishes");
  } else {
    info("serving published dataset", {
      dataset: current.id,
      pricesAsOf: current.pricesAsOf,
      publishedAt: current.publishedAt,
    });
  }
  if (!(await statics.available())) {
    info("frontend bundle missing; run `pnpm build`", { webDir: config.webDir });
  }

  const onListening = (): void => {
    info("listening", {
      addr: `${config.host === "" ? "0.0.0.0" : config.host}:${String(config.port)}`,
      repoDir: config.repoDir,
      refresh: config.refreshEnabled,
      intervalSeconds: Math.round(config.refreshIntervalMs / 1000),
      // The schedule is wall-clock aligned, so the operator can see in the log
      // which mark the first tick will land on (in this process's timezone).
      nextRefreshAt: refresher.status().nextRunAt ?? undefined,
      bootPolicy: config.bootPolicy,
    });
  };
  const server = config.host === ""
    ? app.listen(config.port, onListening)
    : app.listen(config.port, config.host, onListening);

  await new Promise<void>((resolve, reject) => {
    const stop = (signal: string): void => {
      info("shutting down", { signal });
      shutdown.abort();
      server.close((cause) => {
        if (cause !== undefined && cause !== null) reject(cause);
        else resolve();
      });
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
    server.once("error", reject);
  });
}

void main().catch((cause: unknown) => {
  logError("cannot start", { error: messageOf(cause) });
  process.exitCode = 1;
});
