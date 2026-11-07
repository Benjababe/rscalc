// @vitest-environment jsdom
/**
 * The shell's data gate.
 *
 * Pages read the served dataset, so the shell owes the player three behaviours:
 * say what is happening while it loads, say what went wrong (and offer a retry)
 * when the server cannot be reached, and tell a long-lived tab when the server has
 * published newer prices — without swapping the numbers under a table being read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { App } from "../web/src/App.js";
import { resetDataset } from "../web/src/dataset.js";
import { stubDatasetFetch } from "./support/datasetFetch.js";

function rows(): HTMLElement[] {
  return [...document.querySelectorAll("tbody tr")] as HTMLElement[];
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetDataset();
});

describe("App data gate", () => {
  it("says it is loading before the data arrives", () => {
    // A fetch that never settles keeps the loading branch on screen.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<App />);

    expect(screen.getByRole("status").textContent).toContain("Loading prices");
  });

  it("renders the leaderboard once the dataset loads", async () => {
    stubDatasetFetch();
    render(<App />);

    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(screen.queryByText(/Could not load the price data/)).toBeNull();
  });

  it("explains a server with no dataset yet and retries", async () => {
    stubDatasetFetch({ manifestStatus: 503 });
    render(<App />);

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Could not load the price data");
    expect(alert.textContent).toContain("no prices published yet");

    // The server finished its first refresh; the retry must fetch and render.
    vi.unstubAllGlobals();
    stubDatasetFetch();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers a reload when the server publishes a newer dataset", async () => {
    stubDatasetFetch();
    render(<App />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(screen.queryByText(/New prices are published/)).toBeNull();

    // A later refresh published a new dataset; the poll runs on focus.
    vi.unstubAllGlobals();
    stubDatasetFetch({ dataset: "20260102T000000Z" });
    fireEvent(window, new Event("focus"));

    await waitFor(() => expect(screen.getByText(/New prices are published/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    // The table is untouched until the player chooses to reload.
    expect(rows().length).toBeGreaterThan(0);
  });

  it("stays quiet when the server is unreachable during a poll", async () => {
    stubDatasetFetch();
    render(<App />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));

    vi.unstubAllGlobals();
    stubDatasetFetch({ offline: true });
    fireEvent(window, new Event("focus"));

    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(screen.queryByText(/New prices are published/)).toBeNull();
  });
});
