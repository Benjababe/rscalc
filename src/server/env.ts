/// <reference types="node" />
/**
 * `.env` loading for `pnpm serve`.
 *
 * The server reads its configuration from the process environment (see
 * `config.ts`), which is what systemd's `EnvironmentFile=` and Docker's `-e`
 * provide. For a local run that is awkward — nobody wants to export five
 * variables before every `pnpm serve` — so a `.env` at the repo root is loaded
 * first, if it exists.
 *
 * Precedence is the conventional one and is the whole point of this module:
 *
 *   real environment  >  .env  >  built-in defaults
 *
 * A variable that is already set (systemd, Docker, an expiring `FOO=bar pnpm
 * serve`) is never overwritten, so a stray `.env` on a server cannot quietly
 * redirect production. `.env` is gitignored; nothing here logs values, only the
 * names it took from the file.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { messageOf, warn } from "./log.js";

export interface EnvFileResult {
  path: string;
  /** False when the file does not exist: the normal case on a server. */
  loaded: boolean;
  /** Variables taken from the file (the environment had no value for them). */
  applied: string[];
  /** Variables the file sets but the environment already had. */
  skipped: string[];
}

/**
 * Where the `.env` lives: `RSCALC_ENV_FILE` when set, else `<cwd>/.env`.
 *
 * `cwd` rather than the module's location: `pnpm serve` runs from the package
 * root, and that is where a repo-local `.env` belongs.
 */
export function resolveEnvFile(getenv: (key: string) => string | undefined, cwd: string): string {
  const explicit = getenv("RSCALC_ENV_FILE");
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim();
  return join(cwd, ".env");
}

/**
 * Apply `path` to `env`, without overriding anything already set.
 *
 * `node:util.parseEnv` does the parsing, so quoting, `#` comments and blank lines
 * behave exactly as `node --env-file` does. A malformed or unreadable file is a
 * warning, not a crash: the server can still serve the last published dataset
 * with defaults, and refusing to start would be the worse failure.
 */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): EnvFileResult {
  const result: EnvFileResult = { path, loaded: false, applied: [], skipped: [] };
  if (!existsSync(path)) return result;

  let parsed: Record<string, string | undefined>;
  try {
    parsed = parseEnv(readFileSync(path, "utf8"));
  } catch (cause) {
    warn("cannot read the environment file; continuing with the real environment", {
      path,
      error: messageOf(cause),
    });
    return result;
  }

  result.loaded = true;
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) continue;
    const existing = env[key];
    // An exported-but-empty variable counts as unset, so `RSCALC_CONTACT=` in a
    // systemd unit does not shadow the file a user just wrote.
    if (existing !== undefined && existing !== "") {
      result.skipped.push(key);
      continue;
    }
    env[key] = value;
    result.applied.push(key);
  }
  return result;
}
