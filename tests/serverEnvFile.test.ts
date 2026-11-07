/// <reference types="node" />
/**
 * `.env` loading for `pnpm serve`.
 *
 * The precedence is the only thing here that can bite: a `.env` must never win
 * over the real environment, or a stray file on a server would quietly redirect
 * production. Everything else is "does it parse like node --env-file".
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEnvFile, resolveEnvFile } from "../src/server/env.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rscalc-envfile-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeEnvFile(contents: string): Promise<string> {
  const path = join(root, ".env");
  await writeFile(path, contents);
  return path;
}

describe("resolveEnvFile", () => {
  it("defaults to a .env in the working directory", () => {
    expect(resolveEnvFile(() => undefined, "/srv/rscalc")).toBe(join("/srv/rscalc", ".env"));
  });

  it("honours RSCALC_ENV_FILE", () => {
    expect(resolveEnvFile((key) => (key === "RSCALC_ENV_FILE" ? "/etc/rscalc.env" : undefined), "/srv")).toBe(
      "/etc/rscalc.env",
    );
  });

  it("treats a blank override as unset", () => {
    expect(resolveEnvFile((key) => (key === "RSCALC_ENV_FILE" ? "   " : undefined), "/srv")).toBe(
      join("/srv", ".env"),
    );
  });
});

describe("loadEnvFile", () => {
  it("reports a missing file without failing", () => {
    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFile(join(root, "absent.env"), env);
    expect(result.loaded).toBe(false);
    expect(result.applied).toEqual([]);
    expect(env).toEqual({});
  });

  it("applies variables the environment does not already set", async () => {
    const path = await writeEnvFile('RSCALC_CONTACT=me@example.com\nRSCALC_ADDR=:9000\n');
    const env: NodeJS.ProcessEnv = {};
    const result = loadEnvFile(path, env);

    expect(result.loaded).toBe(true);
    expect(result.applied.sort()).toEqual(["RSCALC_ADDR", "RSCALC_CONTACT"]);
    expect(env.RSCALC_CONTACT).toBe("me@example.com");
    expect(env.RSCALC_ADDR).toBe(":9000");
  });

  it("never overrides the real environment", async () => {
    const path = await writeEnvFile("RSCALC_CONTACT=from-file@example.com\nRSCALC_ADDR=:9000\n");
    // What systemd's EnvironmentFile or `docker -e` would have supplied.
    const env: NodeJS.ProcessEnv = { RSCALC_CONTACT: "from-systemd@example.com" };
    const result = loadEnvFile(path, env);

    expect(env.RSCALC_CONTACT).toBe("from-systemd@example.com");
    expect(env.RSCALC_ADDR).toBe(":9000");
    expect(result.skipped).toEqual(["RSCALC_CONTACT"]);
    expect(result.applied).toEqual(["RSCALC_ADDR"]);
  });

  it("lets the file fill a variable that was exported empty", async () => {
    const path = await writeEnvFile("RSCALC_CONTACT=me@example.com\n");
    const env: NodeJS.ProcessEnv = { RSCALC_CONTACT: "" };
    loadEnvFile(path, env);
    expect(env.RSCALC_CONTACT).toBe("me@example.com");
  });

  it("parses like node --env-file: comments, blanks and quotes", async () => {
    const path = await writeEnvFile(
      ['# a comment', '', 'RSCALC_CONTACT="me@example.com"', "RSCALC_REFRESH_TOKEN='a b c'", "RSCALC_ADDR=:8080"].join("\n"),
    );
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(path, env);

    expect(env.RSCALC_CONTACT).toBe("me@example.com");
    expect(env.RSCALC_REFRESH_TOKEN).toBe("a b c");
    expect(env.RSCALC_ADDR).toBe(":8080");
  });

  it("produces configuration the server accepts", async () => {
    const path = await writeEnvFile("RSCALC_CONTACT=me@example.com\nRSCALC_ADDR=127.0.0.1:9100\n");
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(path, env);

    const { loadConfig } = await import("../src/server/config.js");
    const config = loadConfig((key) => env[key], root);
    expect(config.contact).toBe("me@example.com");
    expect(config.port).toBe(9100);
    expect(config.host).toBe("127.0.0.1");
  });
});
