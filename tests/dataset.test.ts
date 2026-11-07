/**
 * The served-dataset loader.
 *
 * The rules pinned here are the ones that keep a table honest: the manifest pins
 * the artifact URLs (so a refresh cannot mix two datasets in one view), nothing
 * renders before its data is loaded, and every failure is a sentence a user can act
 * on rather than `undefined is not an object` three components later.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_ARTIFACTS,
  artifactsLoaded,
  currentManifest,
  datasetIsStale,
  loadDataset,
  payload,
  resetDataset,
} from "../web/src/dataset.js";
import { DATASET_ID, manifestBody, stubDatasetFetch } from "./support/datasetFetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
  resetDataset();
});

describe("loadDataset", () => {
  it("loads the manifest and only the artifacts a page needs", async () => {
    const stub = stubDatasetFetch();
    await loadDataset(PAGE_ARTIFACTS.processing);

    expect(stub.calls).toEqual([
      "/api/data/manifest",
      `/api/data/${DATASET_ID}/process.json`,
      `/api/data/${DATASET_ID}/shop-access.json`,
    ]);
    expect(currentManifest()?.dataset).toBe(DATASET_ID);
    expect(artifactsLoaded(PAGE_ARTIFACTS.processing)).toBe(true);
    expect(payload("process")).toBeTypeOf("object");
  });

  it("does not refetch what is already in memory", async () => {
    const stub = stubDatasetFetch();
    await loadDataset(PAGE_ARTIFACTS["shop-to-ge"]);
    const before = stub.calls.length;
    await loadDataset(PAGE_ARTIFACTS["shop-to-ge"]);
    expect(stub.calls.length).toBe(before);
  });

  it("fetches only the extra artifact when a second page needs more", async () => {
    const stub = stubDatasetFetch();
    await loadDataset(PAGE_ARTIFACTS.processing);
    await loadDataset(PAGE_ARTIFACTS.earn);

    const artifactCalls = stub.calls.filter((url) => url.includes("/api/data/") && !url.endsWith("manifest"));
    expect(artifactCalls.filter((url) => url.endsWith("/process.json"))).toHaveLength(1);
    expect(artifactCalls.filter((url) => url.endsWith("/skilling.json"))).toHaveLength(1);
  });

  it("asks for the manifest uncached and the artifacts cacheable", async () => {
    const stub = stubDatasetFetch();
    await loadDataset(PAGE_ARTIFACTS.processing);
    const calls = stub.fetch.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    expect(calls[0]?.[1]?.cache).toBe("no-store");
    // Pinned to a dataset id, so an artifact URL can be kept by the browser.
    expect(calls[1]?.[1]?.cache).toBe("default");
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const stub = stubDatasetFetch();
    await Promise.all([loadDataset(PAGE_ARTIFACTS.processing), loadDataset(PAGE_ARTIFACTS.processing)]);
    expect(stub.calls.filter((url) => url.endsWith("manifest"))).toHaveLength(1);
  });

  it("explains that the server has published nothing yet", async () => {
    stubDatasetFetch({ manifestStatus: 503 });
    await expect(loadDataset(PAGE_ARTIFACTS.processing)).rejects.toThrow(/no prices published yet.*\/api\/status/s);
  });

  it("reports an HTTP failure with the status", async () => {
    stubDatasetFetch({ manifestStatus: 500 });
    await expect(loadDataset(PAGE_ARTIFACTS.processing)).rejects.toThrow(/HTTP 500/);
  });

  it("reports an unreachable server", async () => {
    stubDatasetFetch({ offline: true });
    await expect(loadDataset(PAGE_ARTIFACTS.processing)).rejects.toThrow(/Cannot reach the rscalc server/);
  });

  it("refuses a manifest that does not pin every artifact", async () => {
    stubDatasetFetch();
    const fetchStub = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ...manifestBody(),
            artifacts: { opportunities: "/api/data/x/opportunities.json" },
          }),
      } as Response),
    );
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadDataset(PAGE_ARTIFACTS.earn)).rejects.toThrow(/"shop-sinks" artifact/);
  });

  it("refuses an artifact body that is not JSON", async () => {
    // A body that is not JSON (an error page, a proxy) must be named as such.
    const fetchStub = vi.fn((input: string) =>
      input.endsWith("manifest")
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(manifestBody()) } as Response)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(new SyntaxError("Unexpected token <")),
          } as Response),
    );
    vi.stubGlobal("fetch", fetchStub);
    await expect(loadDataset(PAGE_ARTIFACTS.processing)).rejects.toThrow(/not valid JSON/);
  });

  it("never hands out an artifact that has not loaded", () => {
    expect(() => payload("skilling")).toThrow(/not loaded/);
  });

  it("forgets everything on reset, so a reload really refetches", async () => {
    stubDatasetFetch();
    await loadDataset(PAGE_ARTIFACTS.processing);
    resetDataset();

    expect(currentManifest()).toBeNull();
    expect(artifactsLoaded(PAGE_ARTIFACTS.processing)).toBe(false);
    expect(() => payload("process")).toThrow(/not loaded/);
  });
});

describe("datasetIsStale", () => {
  it("reports the newer dataset id once the server has published one", async () => {
    stubDatasetFetch();
    await loadDataset(PAGE_ARTIFACTS.processing);
    vi.unstubAllGlobals();

    stubDatasetFetch({ dataset: "20260102T000000Z" });
    await expect(datasetIsStale()).resolves.toBe("20260102T000000Z");
  });

  it("stays quiet when the served dataset is the loaded one", async () => {
    stubDatasetFetch();
    await loadDataset(PAGE_ARTIFACTS.processing);
    await expect(datasetIsStale()).resolves.toBeNull();
  });

  it("stays quiet when the server is unreachable", async () => {
    stubDatasetFetch();
    await loadDataset(PAGE_ARTIFACTS.processing);
    vi.unstubAllGlobals();

    stubDatasetFetch({ offline: true });
    await expect(datasetIsStale()).resolves.toBeNull();
  });

  it("does nothing before the first load", async () => {
    stubDatasetFetch();
    await expect(datasetIsStale()).resolves.toBeNull();
  });
});
