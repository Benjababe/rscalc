/// <reference types="node" />
import { join } from "node:path";

/**
 * Server configuration: the whole environment surface in one place.
 *
 * Every value has a default that works when the process is started from the repo
 * root, so a home-lab box needs to set `RSCALC_CONTACT` and nothing else.
 */

export type BootPolicy = "auto" | "always" | "never";

export interface ServerConfig {
  /** Listen port. */
  port: number;
  /** Bind address; empty means every interface. */
  host: string;
  /** Holds package.json, scripts/, data/ and web/. */
  repoDir: string;
  /** Where `pnpm refresh` writes data/*.json. */
  dataDir: string;
  /** The built SPA. */
  webDir: string;
  /** Published datasets and the refresh log. */
  runtimeDir: string;
  /** The pipeline invocation, split on whitespace and run without a shell. */
  refreshCommand: string;
  /**
   * Optional frontend rebuild (RSCALC_BUILD_CMD), run after a successful publish.
   * Empty means no rebuild: new prices do not need one, because the bundle carries
   * only code. Set it if the box also builds the UI and you want those logs too.
   */
  buildCommand: string;
  /**
   * The refresh cadence. The scheduler ticks on this interval's wall-clock marks
   * (4h => 00:00, 04:00, ... in the server's timezone), not one interval after
   * the previous run finished.
   */
  refreshIntervalMs: number;
  refreshTimeoutMs: number;
  /** false serves the last published dataset and never runs the pipeline. */
  refreshEnabled: boolean;
  bootPolicy: BootPolicy;
  /** How many published datasets stay on disk (>= 2, for rollback). */
  keepSnapshots: number;
  /** Enables POST /api/refresh when non-empty. */
  refreshToken: string;
  /** Sent to the pipeline as RSCALC_CONTACT; required when refreshing. */
  contact: string;
  debug: boolean;
}

export type Env = (key: string) => string | undefined;

const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MINUTE = 60_000;

/** `4h`, `30m`, `90s`, `2d` or a bare number of seconds. */
export function parseDuration(raw: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(raw.trim());
  if (match === null) throw new Error(`not a duration: ${raw}`);
  const value = Number(match[1]);
  const units: Record<string, number> = { ms: 1, s: 1000, m: MINUTE, h: 60 * MINUTE, d: 24 * 60 * MINUTE };
  const factor = units[match[2] ?? "s"] ?? 1000;
  return Math.round(value * factor);
}

export function loadConfig(getenv: Env, cwd: string = process.cwd()): ServerConfig {
  const read = (key: string): string | undefined => {
    const value = getenv(key)?.trim();
    return value === undefined || value === "" ? undefined : value;
  };

  const { host, port } = parseAddr(read("RSCALC_ADDR") ?? ":8080");
  const repoDir = read("RSCALC_REPO_DIR") ?? cwd;

  const intervalRaw = read("RSCALC_REFRESH_INTERVAL");
  const intervalMs = intervalRaw === undefined ? DEFAULT_INTERVAL_MS : parseDuration(intervalRaw);
  const timeoutRaw = read("RSCALC_REFRESH_TIMEOUT");
  const timeoutMs = timeoutRaw === undefined ? 60 * MINUTE : parseDuration(timeoutRaw);

  const keep = Number(read("RSCALC_KEEP_SNAPSHOTS") ?? "3");
  const bootPolicy = (read("RSCALC_REFRESH_ON_BOOT") ?? "auto").toLowerCase();
  const refreshEnabled = parseBool(read("RSCALC_REFRESH") ?? "true", "RSCALC_REFRESH");
  const contact = read("RSCALC_CONTACT") ?? "";
  const refreshCommand = read("RSCALC_REFRESH_CMD") ?? "pnpm refresh";

  if (!Number.isInteger(keep) || keep < 2) {
    throw new Error(`RSCALC_KEEP_SNAPSHOTS must be an integer >= 2, got ${String(read("RSCALC_KEEP_SNAPSHOTS"))}`);
  }
  if (bootPolicy !== "auto" && bootPolicy !== "always" && bootPolicy !== "never") {
    throw new Error(`RSCALC_REFRESH_ON_BOOT must be auto, always or never, got "${bootPolicy}"`);
  }
  if (intervalMs < MINUTE) {
    throw new Error(`RSCALC_REFRESH_INTERVAL must be at least 1m, got ${intervalRaw}`);
  }
  if (timeoutMs < 1000) {
    throw new Error(`RSCALC_REFRESH_TIMEOUT must be at least 1s, got ${timeoutRaw}`);
  }
  if (refreshCommand.split(/\s+/).filter((part) => part !== "").length === 0) {
    throw new Error("RSCALC_REFRESH_CMD is empty");
  }
  if (refreshEnabled && contact === "") {
    // Deliberate: a refresh without a contact sends the placeholder User-Agent
    // from src/api/http.ts, which the wiki API is entitled to throttle. Fail at
    // startup rather than silently on the first 429.
    throw new Error("RSCALC_CONTACT is required when refreshing is enabled (e.g. RSCALC_CONTACT=you@example.com)");
  }

  return {
    host,
    port,
    repoDir,
    dataDir: read("RSCALC_DATA_DIR") ?? join(repoDir, "data"),
    webDir: read("RSCALC_WEB_DIR") ?? join(repoDir, "web", "dist"),
    runtimeDir: read("RSCALC_RUNTIME_DIR") ?? join(repoDir, "runtime"),
    refreshCommand,
    buildCommand: read("RSCALC_BUILD_CMD") ?? "",
    refreshIntervalMs: intervalMs,
    refreshTimeoutMs: timeoutMs,
    refreshEnabled,
    bootPolicy,
    keepSnapshots: keep,
    refreshToken: read("RSCALC_REFRESH_TOKEN") ?? "",
    contact,
    debug: read("RSCALC_DEBUG") !== undefined,
  };
}

/** `:8080`, `8080` or `127.0.0.1:8080`. */
export function parseAddr(raw: string): { host: string; port: number } {
  const trimmed = raw.trim();
  const separator = trimmed.lastIndexOf(":");
  const host = separator <= 0 ? "" : trimmed.slice(0, separator);
  const portRaw = separator === -1 ? trimmed : trimmed.slice(separator + 1);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`RSCALC_ADDR must be <host>:<port>, got "${raw}"`);
  }
  return { host: host === "" ? "" : host, port };
}

function parseBool(raw: string, key: string): boolean {
  switch (raw.toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
  }
  throw new Error(`${key} must be a boolean, got "${raw}"`);
}
