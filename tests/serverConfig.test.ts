/// <reference types="node" />
/**
 * `loadConfig` is the whole environment surface of the server, so its defaults and
 * its refusals are pinned here. The refusals matter as much as the defaults: a
 * misconfigured box should fail at startup with one sentence, not publish a
 * dataset built without a contact address or with a 10-second interval.
 */

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, parseAddr, parseDuration } from "../src/server/config.js";

function env(values: Record<string, string>): (key: string) => string | undefined {
  return (key) => values[key];
}

const contact = { RSCALC_CONTACT: "ops@example.com" };

describe("loadConfig", () => {
  it("defaults to a 4-hour refresh from the repo root", () => {
    const config = loadConfig(env({ ...contact }), "/srv/rscalc");
    expect(config.refreshIntervalMs).toBe(4 * 60 * 60 * 1000);
    expect(config.refreshTimeoutMs).toBe(60 * 60 * 1000);
    expect(config.port).toBe(8080);
    expect(config.bootPolicy).toBe("auto");
    expect(config.refreshEnabled).toBe(true);
    expect(config.keepSnapshots).toBe(3);
    expect(config.refreshCommand).toBe("pnpm refresh");
    expect(config.dataDir).toBe(join("/srv/rscalc", "data"));
    expect(config.webDir).toBe(join("/srv/rscalc", "web", "dist"));
    expect(config.runtimeDir).toBe(join("/srv/rscalc", "runtime"));
  });

  it("requires a contact address when refreshing is enabled", () => {
    expect(() => loadConfig(env({}), "/srv/rscalc")).toThrow(/RSCALC_CONTACT/);
  });

  it("allows no contact when refreshing is off", () => {
    const config = loadConfig(env({ RSCALC_REFRESH: "off" }), "/srv/rscalc");
    expect(config.refreshEnabled).toBe(false);
  });

  it("has no rebuild step by default and reads RSCALC_BUILD_CMD", () => {
    expect(loadConfig(env({ ...contact }), "/srv/rscalc").buildCommand).toBe("");
    const withBuild = loadConfig(env({ ...contact, RSCALC_BUILD_CMD: "pnpm build" }), "/srv/rscalc");
    expect(withBuild.buildCommand).toBe("pnpm build");
  });

  it("reads the documented overrides", () => {
    const config = loadConfig(
      env({
        ...contact,
        RSCALC_ADDR: "127.0.0.1:9000",
        RSCALC_REFRESH_INTERVAL: "30m",
        RSCALC_REFRESH_TIMEOUT: "5m",
        RSCALC_KEEP_SNAPSHOTS: "5",
        RSCALC_REFRESH_ON_BOOT: "ALWAYS",
        RSCALC_REFRESH_TOKEN: "s3cret",
      }),
      "/srv/rscalc",
    );
    expect(config.port).toBe(9000);
    expect(config.host).toBe("127.0.0.1");
    expect(config.refreshIntervalMs).toBe(30 * 60 * 1000);
    expect(config.refreshTimeoutMs).toBe(5 * 60 * 1000);
    expect(config.keepSnapshots).toBe(5);
    expect(config.bootPolicy).toBe("always");
    expect(config.refreshToken).toBe("s3cret");
  });

  it("rejects values that would silently break the schedule", () => {
    const cases: Record<string, string>[] = [
      { RSCALC_REFRESH_INTERVAL: "four hours" },
      { RSCALC_REFRESH_INTERVAL: "10s" },
      { RSCALC_REFRESH_TIMEOUT: "nope" },
      { RSCALC_KEEP_SNAPSHOTS: "1" },
      { RSCALC_KEEP_SNAPSHOTS: "lots" },
      { RSCALC_REFRESH: "maybe" },
      { RSCALC_REFRESH_ON_BOOT: "sometimes" },
      { RSCALC_ADDR: "not-an-address:http" },
    ];
    for (const extra of cases) {
      expect(() => loadConfig(env({ ...contact, ...extra })), JSON.stringify(extra)).toThrow();
    }
  });
});

describe("parseDuration", () => {
  it("accepts the units a person types", () => {
    expect(parseDuration("4h")).toBe(4 * 60 * 60 * 1000);
    expect(parseDuration("30m")).toBe(30 * 60 * 1000);
    expect(parseDuration("90s")).toBe(90 * 1000);
    expect(parseDuration("1d")).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration("1500ms")).toBe(1500);
    expect(parseDuration("45")).toBe(45 * 1000);
  });

  it("rejects anything else", () => {
    expect(() => parseDuration("soon")).toThrow();
  });
});

describe("parseAddr", () => {
  it("reads the three shapes people write", () => {
    expect(parseAddr(":8080")).toEqual({ host: "", port: 8080 });
    expect(parseAddr("8080")).toEqual({ host: "", port: 8080 });
    expect(parseAddr("127.0.0.1:9000")).toEqual({ host: "127.0.0.1", port: 9000 });
  });

  it("rejects a bad port", () => {
    expect(() => parseAddr("127.0.0.1:http")).toThrow();
    expect(() => parseAddr(":99999")).toThrow();
  });
});
