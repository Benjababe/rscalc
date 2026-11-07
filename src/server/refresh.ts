/// <reference types="node" />
/**
 * The refresh scheduler.
 *
 * Every `RSCALC_REFRESH_INTERVAL` (4 hours by default) this runs the pipeline
 * (`pnpm refresh`), which re-derives every table from the wiki and price APIs, and
 * then publishes the result as a dataset. It computes nothing itself: the
 * TypeScript pipeline stays the single source of truth for the numbers, its zod
 * schemas and its 1 request/second budget.
 *
 * Three properties matter more than the schedule:
 *
 *  - **one at a time.** The pipeline writes `data/*.json` in place and the HTTP
 *    gateway allows one request per second; a second concurrent run would
 *    interleave writes. A trigger while running is rejected, not queued.
 *  - **a failure is visible.** Exit code, timeout and publish errors are recorded
 *    in the status and the log tail, so `/api/status` answers "why is this stale?"
 *    without shell access.
 *  - **a failure is not served.** The current dataset stays; only a complete,
 *    parseable set is published.
 */

import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";

import type { ServerConfig } from "./config.js";
import type { Dataset, DatasetStore } from "./datasets.js";
import { error as logError, info, messageOf, warn } from "./log.js";

export type RunState = "idle" | "running" | "error";

/** What `/api/status` reports about the refresh job. */
export interface RefreshStatus {
  state: RunState;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  error: string | null;
  dataset: string | null;
  nextRunAt: string | null;
  intervalSeconds: number;
}

/** A refresh is already running; the caller should answer 409, not queue. */
export class RefreshRunningError extends Error {
  constructor() {
    super("a refresh is already running");
    this.name = "RefreshRunningError";
  }
}

const LOG_LINES = 400;

interface RecordOptions {
  level?: "info" | "warn" | "error";
  /** Which command produced the line. */
  phase?: "refresh" | "build";
  /** Which pipe a child line came from. */
  stream?: "stdout" | "stderr";
  /** Publish metadata, so the log line carries it too. */
  dataset?: string;
  pricesAsOf?: string | null;
}

export interface RefresherOptions {
  /** Overrides the parsed command, so tests can drive it without a shell. */
  command?: string[];
  /** Overrides the parsed rebuild command (see RSCALC_BUILD_CMD). */
  buildCommand?: string[];
  now?: () => number;
}

export class Refresher {
  private readonly config: ServerConfig;
  private readonly store: DatasetStore;
  private readonly command: string[];
  private readonly buildCommand: string[];
  private readonly now: () => number;
  private readonly logLines: string[] = [];

  private state: RunState = "idle";
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private durationMs = 0;
  private lastError: string | null = null;
  private datasetId: string | null = null;
  private nextRunAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(config: ServerConfig, store: DatasetStore, options: RefresherOptions = {}) {
    this.config = config;
    this.store = store;
    this.command = options.command ?? splitCommand(config.refreshCommand);
    this.buildCommand = options.buildCommand ?? splitCommand(config.buildCommand);
    this.now = options.now ?? Date.now;
  }

  status(): RefreshStatus {
    const running = this.state === "running";
    return {
      state: this.state,
      startedAt: this.startedAt === null ? null : new Date(this.startedAt).toISOString(),
      finishedAt: this.finishedAt === null ? null : new Date(this.finishedAt).toISOString(),
      durationMs: running && this.startedAt !== null ? this.now() - this.startedAt : this.durationMs,
      error: this.lastError,
      dataset: this.datasetId ?? this.store.current()?.id ?? null,
      nextRunAt: this.nextRunAt === null ? null : new Date(this.nextRunAt).toISOString(),
      intervalSeconds: Math.round(this.config.refreshIntervalMs / 1000),
    };
  }

  /** The tail of the last run's output, for `/api/status`. */
  logTail(limit: number): string[] {
    return limit <= 0 ? [...this.logLines] : this.logLines.slice(-limit);
  }

  /**
   * Start a refresh in the background.
   *
   * Throws `RefreshRunningError` when one is in flight, and a plain `Error` when
   * refreshing is switched off.
   */
  trigger(): void {
    if (!this.config.refreshEnabled) {
      throw new Error("refreshing is disabled (RSCALC_REFRESH=off)");
    }
    if (this.state === "running") throw new RefreshRunningError();
    void this.run();
  }

  /** Begin the schedule. Idempotent enough for one call at startup. */
  start(signal: AbortSignal): void {
    if (!this.config.refreshEnabled) {
      info("refresh scheduler disabled; serving the last published dataset");
      return;
    }
    this.scheduleNext();
    if (this.shouldRefreshOnBoot()) {
      info("published data is missing or older than the refresh interval; refreshing now");
      this.triggerSafely();
    }
    signal.addEventListener(
      "abort",
      () => {
        this.stopped = true;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
      },
      { once: true },
    );
  }

  /**
   * "auto" is the default because a reboot is exactly when a snapshot goes stale:
   * waiting four hours for the first tick would serve yesterday's prices with
   * today's timestamp.
   */
  shouldRefreshOnBoot(): boolean {
    switch (this.config.bootPolicy) {
      case "always":
        return true;
      case "never":
        return false;
      case "auto":
        break;
    }
    const current = this.store.current();
    if (current === null) return true;
    const published = Date.parse(current.publishedAt);
    if (Number.isNaN(published)) return true;
    return this.now() - published >= this.config.refreshIntervalMs;
  }

  private triggerSafely(): void {
    try {
      this.trigger();
    } catch (cause) {
      if (!(cause instanceof RefreshRunningError)) {
        logError("cannot start scheduled refresh", { error: messageOf(cause) });
      }
    }
  }

  /** Schedule the next run `interval` after this one finished (no drift stacking). */
  private scheduleNext(): void {
    if (this.stopped || !this.config.refreshEnabled) return;
    this.nextRunAt = this.now() + this.config.refreshIntervalMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.triggerSafely();
    }, this.config.refreshIntervalMs);
    // Do not keep the event loop alive for a scheduled refresh; the HTTP server
    // owns the process lifetime.
    this.timer.unref();
  }

  private async run(): Promise<void> {
    const startedAt = this.now();
    this.state = "running";
    this.startedAt = startedAt;
    this.finishedAt = null;
    this.lastError = null;

    try {
      this.record(`refresh started: ${this.command.join(" ")}`, { phase: "refresh" });
      await this.exec(this.command, "refresh");

      const dataset = await this.store.publish(this.config.dataDir);
      this.datasetId = dataset.id;
      this.record(describePublish(dataset, this.now() - startedAt), {
        dataset: dataset.id,
        pricesAsOf: dataset.pricesAsOf,
      });

      // Rebuilding the SPA is not needed for new prices (the bundle is code only),
      // but a box that also builds the UI can have those logs land here too.
      if (this.buildCommand.length > 0) {
        this.record(`build started: ${this.buildCommand.join(" ")}`, { phase: "build" });
        await this.exec(this.buildCommand, "build");
        this.record("build finished", { phase: "build" });
      }
      this.state = "idle";
    } catch (cause) {
      this.lastError = messageOf(cause);
      this.state = "error";
      this.record(`refresh failed: ${this.lastError}`, { level: "error" });
    } finally {
      this.finishedAt = this.now();
      this.durationMs = this.finishedAt - startedAt;
      this.scheduleNext();
    }
  }

  /**
   * Run one command, streaming **every** line into two places:
   *
   *  - the ring tail that `/api/status` reports, so a stale site is diagnosable
   *    from a browser;
   *  - the server's own log (`process.stdout`/`stderr`), so `journalctl -u rscalc`
   *    and `docker logs` show the whole pipeline rather than "refresh published".
   *
   * stderr is logged at `warn` with `stream=stderr`: pnpm writes its progress and
   * many warnings there, and a line's origin is worth keeping.
   */
  private exec(command: string[], phase: "refresh" | "build"): Promise<void> {
    const bin = command[0];
    if (bin === undefined) return Promise.reject(new Error(`no ${phase} command configured`));
    const args = command.slice(1);
    return new Promise((resolve, reject) => {
      // Typed as ChildProcess rather than the stdio overload's narrowed type: the
      // tuple is ["ignore", "pipe", "pipe"], so stdin is null and stdout/stderr
      // are readable, which the overload resolution cannot express in one type.
      const child: ChildProcess = spawn(bin, args, {
        cwd: this.config.repoDir,
        env: { ...process.env, RSCALC_CONTACT: this.config.contact },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.config.refreshTimeoutMs);

      const streams: Array<[typeof child.stdout, "stdout" | "stderr"]> = [
        [child.stdout, "stdout"],
        [child.stderr, "stderr"],
      ];
      for (const [stream, name] of streams) {
        if (stream === null) continue;
        const lines = readline.createInterface({ input: stream });
        lines.on("line", (line: string) => {
          this.record(line, {
            level: name === "stderr" ? "warn" : "info",
            phase,
            stream: name,
          });
        });
      }

      child.on("error", (cause) => {
        clearTimeout(timer);
        reject(new Error(`cannot run ${bin}: ${cause.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`${phase} timed out after ${formatDuration(this.config.refreshTimeoutMs)}`));
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${phase} (${command.join(" ")}) exited with code ${String(code)}`));
      });
    });
  }

  /**
   * Record one line of run output in the ring tail and in the server log.
   *
   * `level` defaults to info; lifecycle lines pass their fields so the log carries
   * the same structured data `/api/status` reports.
   */
  private record(text: string, options: RecordOptions = {}): void {
    const trimmed = text.trimEnd();
    if (trimmed === "") return;

    this.logLines.push(trimmed);
    if (this.logLines.length > LOG_LINES) this.logLines.splice(0, this.logLines.length - LOG_LINES);

    const fields: Record<string, unknown> = {
      phase: options.phase,
      stream: options.stream,
      dataset: options.dataset,
      pricesAsOf: options.pricesAsOf,
    };
    switch (options.level ?? "info") {
      case "error":
        logError(trimmed, fields);
        return;
      case "warn":
        warn(trimmed, fields);
        return;
      case "info":
        info(trimmed, fields);
        return;
    }
  }
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${String(Math.round(ms))}ms` : `${String(Math.round(ms / 1000))}s`;
}

function describePublish(dataset: Dataset, elapsedMs: number): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return `published dataset ${dataset.id} (prices as of ${dataset.pricesAsOf ?? "unknown"}) in ${String(seconds)}s`;
}

function splitCommand(raw: string): string[] {
  return raw.split(/\s+/).filter((part) => part !== "");
}
