/// <reference types="node" />
/**
 * Server logging.
 *
 * `no-console` is an error in this repo, so everything goes through
 * `process.stdout`/`process.stderr` here. Lines are single-line and greppable:
 * journald and `docker logs` both show one line per event.
 */

const LEVELS = { info: "stdout", warn: "stderr", error: "stderr" } as const;

export type LogLevel = keyof typeof LEVELS;
export type LogStream = "stdout" | "stderr";

/** Where formatted lines go. */
export interface LogTransport {
  write(line: string, stream: LogStream): void;
}

const streamTransport: LogTransport = {
  write(line, stream) {
    if (stream === "stderr") process.stderr.write(line);
    else process.stdout.write(line);
  },
};

let transport: LogTransport = streamTransport;

/**
 * Replace where formatted lines are written; `null` restores the real streams.
 *
 * Exists so tests can assert on the server log itself (the refresh job's promise
 * is that pipeline output reaches `journalctl`, not just `/api/status`). Production
 * code never calls this.
 */
export function setLogTransport(next: LogTransport | null): void {
  transport = next ?? streamTransport;
}

export function info(message: string, fields: Record<string, unknown> = {}): void {
  write("info", message, fields);
}

export function warn(message: string, fields: Record<string, unknown> = {}): void {
  write("warn", message, fields);
}

export function error(message: string, fields: Record<string, unknown> = {}): void {
  write("error", message, fields);
}

function write(level: LogLevel, message: string, fields: Record<string, unknown>): void {
  const parts = [new Date().toISOString(), level.toUpperCase(), message];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${formatValue(value)}`);
  }
  transport.write(`${parts.join(" ")}\n`, LEVELS[level]);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** `message` for anything thrown, without leaking a stack into a log field. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
