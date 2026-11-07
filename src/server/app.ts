/// <reference types="node" />
/**
 * The HTTP surface.
 *
 * Three things are served:
 *
 *  - `/api/data/manifest` + `/api/data/<dataset>/<name>.json` — the published
 *    data, so the browser renders current numbers instead of a bundle frozen at
 *    build time;
 *  - `/api/status` — what the refresh job is doing, including the log tail, so a
 *    stale site is diagnosable from a browser;
 *  - the built SPA, at every other path.
 *
 * Caching is the subtle part and is deliberate: pinned artifact URLs are
 * immutable, the manifest is `no-store` (it is the only thing that changes when a
 * dataset lands), hashed assets are immutable, and `index.html` is `no-cache`.
 */

import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import {
  ARTIFACT_NAMES,
  MANIFEST_PATH,
  artifactPath,
  type ArtifactName,
  type DatasetManifest,
} from "../api/dataset.js";
import type { ServerConfig } from "./config.js";
import type { Dataset, DatasetStore } from "./datasets.js";
import { info, messageOf } from "./log.js";
import { RefreshRunningError, type Refresher } from "./refresh.js";
import { acceptsGzip, type StaticFiles } from "./staticFiles.js";

export interface AppDeps {
  config: ServerConfig;
  store: DatasetStore;
  refresher: Refresher;
  statics: StaticFiles;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  if (deps.config.debug) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const startedAt = Date.now();
      res.on("finish", () => {
        info("request", {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - startedAt,
        });
      });
      next();
    });
  }

  app.get("/healthz", (_req: Request, res: Response) => {
    const dataset = deps.store.current();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      published: dataset !== null,
      dataset: dataset?.id ?? null,
      pricesAsOf: dataset?.pricesAsOf ?? null,
    });
  });

  app.get("/api/status", (_req: Request, res: Response) => {
    const dataset = deps.store.current();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      refresh: deps.refresher.status(),
      log: deps.refresher.logTail(60),
      dataset: dataset === null ? null : datasetSummary(dataset),
      config: {
        refreshEnabled: deps.config.refreshEnabled,
        bootPolicy: deps.config.bootPolicy,
        command: deps.config.refreshCommand,
        buildCommand: deps.config.buildCommand,
        intervalSeconds: Math.round(deps.config.refreshIntervalMs / 1000),
      },
    });
  });

  app.get(MANIFEST_PATH, (_req: Request, res: Response) => {
    const dataset = deps.store.current();
    res.setHeader("Cache-Control", "no-store");
    if (dataset === null) {
      res.status(503).json({
        error: "no dataset published yet",
        hint: "the first refresh has not finished; check /api/status",
      });
      return;
    }
    const etag = `"${dataset.id}"`;
    res.setHeader("ETag", etag);
    if (matchesEtag(_req.headers["if-none-match"], etag)) {
      res.status(304).end();
      return;
    }
    res.json(manifestFor(dataset));
  });

  app.get(
    "/api/data/:dataset/:file",
    handle(async (req: Request, res: Response) => {
      const datasetId = req.params.dataset ?? "";
      const file = req.params.file ?? "";
      const name = file.endsWith(".json") ? file.slice(0, -".json".length) : file;
      if (!isArtifactName(name) || file !== `${name}.json`) {
        res.status(404).json({ error: "unknown artifact" });
        return;
      }
      const dataset = await deps.store.load(datasetId);
      if (dataset === null) {
        res.status(404).json({ error: "unknown dataset", dataset: datasetId });
        return;
      }

      // The URL pins one dataset, so these bytes can never change.
      const etag = `"${dataset.id}:${name}"`;
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Vary", "Accept-Encoding");
      if (matchesEtag(req.headers["if-none-match"], etag)) {
        res.status(304).end();
        return;
      }

      if (acceptsGzip(req)) {
        const compressed = await readOptional(join(dataset.dir, `${name}.json.gz`));
        if (compressed !== null) {
          res.setHeader("Content-Encoding", "gzip");
          res.setHeader("Content-Length", String(compressed.length));
          res.status(200).end(compressed);
          return;
        }
      }
      const raw = await readFile(join(dataset.dir, `${name}.json`));
      res.setHeader("Content-Length", String(raw.length));
      res.status(200).end(raw);
    }),
  );

  app.post("/api/refresh", (_req: Request, res: Response) => {
    if (deps.config.refreshToken === "") {
      res.status(403).json({
        error: "manual refresh is disabled; set RSCALC_REFRESH_TOKEN to enable POST /api/refresh",
      });
      return;
    }
    if (!tokenMatches(_req.headers["x-rscalc-token"], deps.config.refreshToken)) {
      res.status(403).json({ error: "bad token" });
      return;
    }
    try {
      deps.refresher.trigger();
    } catch (cause) {
      if (cause instanceof RefreshRunningError) {
        res.status(409).json({ error: cause.message });
        return;
      }
      res.status(503).json({ error: messageOf(cause) });
      return;
    }
    res.status(202).json({ state: "running" });
  });

  // Unknown API paths must never fall through to the SPA: a JSON client asking
  // for a missing endpoint should not receive an HTML page with a 200.
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "no such endpoint" });
  });

  app.use(
    handle(async (req: Request, res: Response) => {
      await serveFrontend(deps, req, res);
    }),
  );

  // Express recognises an error handler by its four-argument shape; `next` must be
  // declared even though this one never delegates.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((cause: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = messageOf(cause);
    info("request failed", { error: message });
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: message });
  });

  return app;
}

async function serveFrontend(deps: AppDeps, req: Request, res: Response): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).type("text/plain").send("method not allowed\n");
    return;
  }
  if (!(await deps.statics.available())) {
    res
      .status(503)
      .type("text/plain")
      .send("web/dist is missing: run `pnpm build` (or `pnpm dev` for the Vite dev server)\n");
    return;
  }

  const path = req.path;
  const name = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  // Content-hashed build output is immutable; anything else may change per release.
  const immutable = name.startsWith("assets/");
  if (await deps.statics.serve(req, res, name, { immutable })) return;
  if (immutable) {
    res.status(404).type("text/plain").send("asset not found\n");
    return;
  }
  // Hash routing means no per-route server logic; a stray path loads the shell.
  await deps.statics.serve(req, res, "index.html", { immutable: false });
}

export function manifestFor(dataset: Dataset): DatasetManifest {
  const artifacts = {} as Record<ArtifactName, string>;
  for (const name of ARTIFACT_NAMES) {
    artifacts[name] = artifactPath(dataset.id, name);
  }
  return {
    dataset: dataset.id,
    generatedAt: dataset.generatedAt,
    pricesAsOf: dataset.pricesAsOf,
    publishedAt: dataset.publishedAt === "" ? null : dataset.publishedAt,
    artifacts,
  };
}

function datasetSummary(dataset: Dataset): Record<string, unknown> {
  return {
    id: dataset.id,
    generatedAt: dataset.generatedAt,
    pricesAsOf: dataset.pricesAsOf,
    publishedAt: dataset.publishedAt === "" ? null : dataset.publishedAt,
  };
}

/** Wrap an async handler so express never receives an unhandled rejection. */
function handle(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch((cause: unknown) => {
      next(cause);
    });
  };
}

function isArtifactName(value: string): value is ArtifactName {
  return (ARTIFACT_NAMES as readonly string[]).includes(value);
}

function matchesEtag(header: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (raw === undefined) return false;
  return raw
    .split(",")
    .map((part) => part.trim())
    .includes(etag);
}

function tokenMatches(header: string | string[] | undefined, expected: string): boolean {
  const provided = Buffer.from(Array.isArray(header) ? header.join(",") : (header ?? ""));
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}
