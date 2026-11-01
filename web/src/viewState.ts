/**
 * The view state that travels in the URL hash.
 *
 * The page hash already said which calculator you were on; this adds what you
 * were looking at — mode, sort, search text and the active filters — so a
 * filtered view can be linked, bookmarked and reloaded. Gold and column
 * visibility stay in `localStorage` (`storage.ts`, `columns.tsx`): they are
 * preferences, not part of a shared view.
 *
 * Only values that differ from the defaults are written, so a clean page keeps a
 * clean hash (`#/ge-to-shop`, not `#/ge-to-shop?mode=pessimistic&desc=1`).
 */

import { useEffect } from "react";

import { pageHash, type Page } from "./route";

export interface ViewState {
  mode?: string;
  sort?: string;
  /** Written only when ascending; the tables default to descending. */
  desc?: boolean;
  q?: string;
  members?: boolean;
  hideLocked?: boolean;
  minVolume?: number;
  minProfit?: number;
  skill?: string;
}

/**
 * The mode every page starts in. Written to the hash only when it differs, so a
 * page that has not been touched keeps a clean URL.
 */
const DEFAULT_MODE = "pessimistic";

/** Every page ranks by gp/hour until a header is clicked. */
const DEFAULT_SORT = "gpPerHour";

/** `1`/`0` only: anything else is a hand-edited hash we ignore. */
function readBool(raw: string | null): boolean | undefined {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return undefined;
}

/** Non-negative whole numbers only; `NaN`, negatives and junk are dropped. */
function readNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

/** Parse the query part of a hash into view state. Never throws. */
export function parseViewState(hash: string): ViewState {
  const start = hash.indexOf("?");
  if (start === -1) return {};

  const params = new URLSearchParams(hash.slice(start + 1));
  const state: ViewState = {};

  const mode = params.get("mode");
  if (mode !== null && mode !== "") state.mode = mode;

  const sort = params.get("sort");
  if (sort !== null && sort !== "") state.sort = sort;

  const desc = readBool(params.get("desc"));
  if (desc !== undefined) state.desc = desc;

  const q = params.get("q");
  if (q !== null && q !== "") state.q = q;

  const members = readBool(params.get("members"));
  if (members !== undefined) state.members = members;

  // Written as `locked=0` when the player hides locked shops.
  const locked = readBool(params.get("locked"));
  if (locked !== undefined) state.hideLocked = locked === false;

  const minVolume = readNumber(params.get("minvol"));
  if (minVolume !== undefined) state.minVolume = minVolume;

  const minProfit = readNumber(params.get("minprofit"));
  if (minProfit !== undefined) state.minProfit = minProfit;

  const skill = params.get("skill");
  if (skill !== null && skill !== "") state.skill = skill;

  return state;
}

/** Build the hash for a page and view. Defaults are omitted. */
export function buildViewHash(page: Page, state: ViewState): string {
  const params = new URLSearchParams();

  if (
    state.mode !== undefined &&
    state.mode !== "" &&
    state.mode !== DEFAULT_MODE
  ) {
    params.set("mode", state.mode);
  }
  if (
    state.sort !== undefined &&
    state.sort !== "" &&
    state.sort !== DEFAULT_SORT
  ) {
    params.set("sort", state.sort);
  }
  if (state.desc === false) params.set("desc", "0");

  const q = state.q?.trim();
  if (q !== undefined && q !== "") params.set("q", q);

  if (state.members === true) params.set("members", "1");
  if (state.hideLocked === true) params.set("locked", "0");
  if (state.minVolume !== undefined && state.minVolume > 0) {
    params.set("minvol", String(state.minVolume));
  }
  if (state.minProfit !== undefined && state.minProfit > 0) {
    params.set("minprofit", String(state.minProfit));
  }
  if (state.skill !== undefined && state.skill !== "all") {
    params.set("skill", state.skill);
  }

  const query = params.toString();
  return query === "" ? pageHash(page) : `${pageHash(page)}?${query}`;
}

/** The view encoded in the current URL, or an empty view outside a browser. */
export function currentViewState(): ViewState {
  if (typeof window === "undefined") return {};
  return parseViewState(window.location.hash);
}

/**
 * Pick a known key out of an unvalidated hash value.
 *
 * Returns the fallback when the URL names something this page does not sort by,
 * so a stale or hand-edited link cannot put the table into an unknown order.
 */
export function pickOne<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * Keep the URL in step with the view.
 *
 * `replaceState` rather than assigning `location.hash`: editing filters should
 * not fill the back button with one entry per keystroke, and it does not fire
 * `hashchange`, so the router cannot loop on itself.
 */
export function writeViewState(page: Page, state: ViewState): void {
  if (typeof window === "undefined") return;
  const hash = buildViewHash(page, state);
  if (window.location.hash === hash) return;
  window.history.replaceState(null, "", hash);
}

/**
 * Keep the URL in step with the page's current view.
 *
 * Called with a freshly built object on every render; `writeViewState` compares
 * the resulting hash before touching history, so an unchanged view is free.
 */
export function useShareableView(page: Page, state: ViewState): void {
  useEffect(() => {
    writeViewState(page, state);
  }, [page, state]);
}
