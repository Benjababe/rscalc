/// <reference types="node" />
/**
 * Fixtures for the server tests.
 *
 * The artifacts are stand-ins: the pipeline validates the real ones with zod, so
 * what the server needs from them here is only "valid JSON object with the two
 * timestamps". The fake pipeline is a small Node script, which keeps the tests
 * free of shell quoting and of pnpm.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

import type { Express } from "express";

import { ARTIFACT_NAMES } from "../../src/api/dataset.js";
import { loadConfig, type ServerConfig } from "../../src/server/config.js";

export function testConfig(root: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const env: Record<string, string> = {
    RSCALC_CONTACT: "test@example.com",
    RSCALC_REPO_DIR: root,
  };
  const config = loadConfig((key) => env[key], root);
  return { ...config, ...overrides };
}

/** One artifact body: a JSON object carrying the timestamps the server reads. */
export function artifactJSON(name: string, stamp: string): string {
  return `${JSON.stringify({ generatedAt: stamp, pricesAsOf: stamp, name, rows: [] }, null, 2)}\n`;
}

export async function writeArtifacts(
  dir: string,
  stamps: Record<string, string> = {},
  overrides: Record<string, string> = {},
): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const name of ARTIFACT_NAMES) {
    const body = overrides[name] ?? artifactJSON(name, stamps[name] ?? "2026-01-01T00:00:00Z");
    await writeFile(join(dir, `${name}.json`), body);
  }
}

export async function writeWebDist(dir: string): Promise<void> {
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "index.html"), '<!doctype html><html><body>rscalc</body></html>');
  // Big enough that gzip is unambiguously smaller.
  await writeFile(join(dir, "assets", "app-abc123.js"), `console.log(${JSON.stringify("x".repeat(4096))});`);
}

/** The fake pipeline: writes a fresh data dir, optionally failing or sleeping. */
export async function writeFakePipeline(dir: string, mode: "ok" | "fail" | "slow" = "ok"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `fake-pipeline-${mode}.mjs`);
  const body = `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dataDir = process.argv[2];
const names = ${JSON.stringify(ARTIFACT_NAMES)};
if (process.argv[3] !== "touch-nothing") {
  mkdirSync(dataDir, { recursive: true });
  for (const name of names) {
    writeFileSync(
      join(dataDir, name + ".json"),
      JSON.stringify({ generatedAt: "2026-02-01T00:00:00Z", pricesAsOf: "2026-02-01T00:00:00Z", name }),
    );
  }
}
process.stdout.write("pipeline: pricing " + names.length + " artifacts\\n");
${
  mode === "fail"
    ? 'process.stderr.write("pipeline: simulated failure\\n");\nprocess.exit(1);'
    : mode === "slow"
      ? "await new Promise((resolve) => setTimeout(resolve, 3000));"
      : ""
}
`;
  await writeFile(path, body);
  return path;
}

/** A stand-in for `pnpm build`: prints lines, optionally fails. */
export async function writeFakeBuild(dir: string, mode: "ok" | "fail" = "ok"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `fake-build-${mode}.mjs`);
  // console.log rather than process.stdout.write("...\n"): the generated file then
  // needs no escaped newlines, which keeps this fixture readable.
  const lines = [
    `console.log(${JSON.stringify("build: bundling the ui")});`,
    mode === "fail"
      ? `console.error(${JSON.stringify("build: vite died")});`
      : `console.log(${JSON.stringify("build: wrote web/dist")});`,
    ...(mode === "fail" ? ["process.exit(2);"] : []),
  ];
  await writeFile(path, `${lines.join("\n")}\n`);
  return path;
}

export interface RunningServer {
  base: string;
  port: number;
  close: () => Promise<void>;
}

/** Listen on an ephemeral port so tests never collide with a real server. */
export async function start(app: Express): Promise<RunningServer> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${String(address.port)}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((cause) => {
          if (cause === undefined || cause === null) resolve();
          else reject(cause);
        });
      }),
  };
}

/** A temp dir layout matching the real repo: data/, web/dist/, runtime/. */
export async function writeLayout(root: string): Promise<{ dataDir: string; webDir: string; runtimeDir: string }> {
  const dataDir = join(root, "data");
  const webDir = join(root, "web", "dist");
  const runtimeDir = join(root, "runtime");
  await writeArtifacts(dataDir);
  await writeWebDist(webDir);
  await mkdir(runtimeDir, { recursive: true });
  return { dataDir, webDir, runtimeDir };
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * A raw HTTP request.
 *
 * `node:http` rather than `fetch` on purpose: fetch decompresses a gzip response
 * and hides `Content-Encoding`, which is exactly what the artifact tests assert.
 */
export function rawRequest(
  port: number,
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        // No keep-alive: a reused socket would hold `server.close()` open for its
        // idle timeout, turning every teardown into a 4-second wait.
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}
