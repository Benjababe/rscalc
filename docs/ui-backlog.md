# UI improvements backlog

Candidate work on the web UI, gathered from an audit of the built bundle
(`pnpm build` + `pnpm preview`) rather than from assumptions. Every item below
was observed or measured in the browser; each entry says what was measured, so
it can be re-checked after a change.

**Scope note:** nothing here touches the pricing engine, the tax formula, the
travel model or the artifacts. These are presentation, accessibility and
ergonomics changes over the same numbers.

Legend: **impact** is user-visible benefit, **effort** is rough size of the
change (S ≈ under an hour, M ≈ half a day, L ≈ a day or more).

---

## 1. High impact, small effort

### 1.1 Surface the 300-row cap

- **Where:** `web/src/ShopToGe.tsx:831`, `web/src/GeToShop.tsx:689`,
  `web/src/Processing.tsx:701`.
- **Observed:** each page renders `rows.slice(0, 300)` and prints
  "Showing the top 300 of N" as a `<p class="empty">` **inside** the scrolling
  `.tablewrap` (measured on Shop → GE: 2,151 matches, 300 rows in the DOM).
  The notice is only reachable by scrolling to the bottom of a 74vh box, so the
  truncation is effectively invisible.
- **Change:** move the count into the results area above the table
  (`2,151 matches · top 300 shown`), and optionally add a "show more" control
  that raises the cap.
- **Impact: high · Effort: S.**

### 1.2 Shareable, deep-linkable view state

- **Where:** `web/src/route.ts` (hash holds the page only), `storage.ts`
  (persists gold/view), `columns.tsx` (persists column visibility).
- **Observed:** mode, sort key, sort direction, search text, members-only,
  hide-locked and the numeric thresholds all reset on reload. A filtered or
  sorted view cannot be linked or bookmarked.
- **Change:** encode `mode`, `sort`, `desc`, `q` and the active filters in the
  hash (the existing `pageHash`/`parsePageHash` pattern extends naturally).
  Keep `localStorage` as the default for gold and columns, and add a
  **Copy link** affordance next to the toolbar.
- **Impact: high · Effort: M.**

### 1.3 Table accessibility

- **Where:** `web/src/ui.tsx` (`Th`), `.tablewrap` in all three pages.
- **Measured in the running build:** 15 `<th>` elements, **0** with
  `scope`, 11 sortable headers, **0** with `aria-sort`, no `<caption>`, and
  `.tablewrap` reports `tabIndex: -1` with no `role` — a scrollable region that
  keyboard users cannot reliably scroll.
- **Change:**
  - `scope="col"` on every header cell.
  - `aria-sort="ascending" | "descending" | "none"` driven by the existing
    `active` / `desc` props in `Th`.
  - `<caption class="visually-hidden">` naming each table.
  - `role="region"`, `tabindex="0"` and `aria-label` on `.tablewrap`.
- **Impact: high · Effort: S.**

### 1.4 Gold input ergonomics

- **Where:** the `Gold available` field in the budget card of all three pages.
- **Observed:** the field is a `type="number"` with `step={100_000}`; buying
  power is usually typed as `100000000`, which is easy to get wrong by an order
  of magnitude — the single most damaging input error on the site.
- **Change:** accept shorthand (`100m`, `2.5k`, `150k`) and render the parsed
  value with thousands separators while idle. Keep the parsed result an integer
  gp value, and keep the existing presets.
- **Impact: high · Effort: S.**

### 1.5 Warn when the snapshot is stale

- **Where:** the `.asof` meta line in the toolbar.
- **Observed:** `data/*.json` is committed, so `pricesAsOf` can be days old.
  The UI shows the timestamp but never flags that it is old.
- **Change:** show a warning chip (`prices are 14h old`) when
  `pricesAsOf` is older than ~24h. This matches the project rule that a wrong
  number presented confidently is the worst outcome.
- **Impact: high · Effort: S.**

### 1.6 Document head metadata

- **Where:** `web/index.html`.
- **Observed:** no `<meta name="description">`, no `theme-color`, no
  `<link rel="icon">`, no Open Graph tags.
- **Change:** add a description, `theme-color` (`#14161a`), a small favicon and
  OG/Twitter tags so link previews are not blank.
- **Impact: medium · Effort: S.**

### 1.7 Give the empty states an exit

- **Where:** the three "No … match these filters" paragraphs.
- **Observed:** with members-only, hide-locked, a search string and a numeric
  threshold active, an empty table offers no way back.
- **Change:** add a **Clear filters** button that resets every filter to its
  default (and, once 1.2 lands, drops the query from the hash).
- **Impact: medium · Effort: S.**

### 1.8 Respect `prefers-reduced-motion`

- **Where:** `web/src/styles.css` — the 140ms transitions added to chips,
  search, inputs and the mode switch.
- **Observed:** no `prefers-reduced-motion` rule exists in the stylesheet.
- **Change:** a single media query that drops the transitions.
- **Impact: medium · Effort: S (3 lines).**

---

## 2. Medium effort

### 2.1 Mobile table layout

- **Where:** `.tablewrap` / `.results-table` under the 720px breakpoint.
- **Observed:** at ≤720px the table keeps 10+ columns in a horizontal scroller;
  the informative columns (gp/hour, shop) end up off-screen.
- **Change:** a card-per-row layout below the breakpoint — item and gp/hour
  prominent, shop and margin secondary — or, at minimum, a pinned first column.
  The sticky `thead` is already correct for the desktop case.
- **Impact: high · Effort: M.**

### 2.2 Remove the duplicated page orchestration

- **Where:** `web/src/ShopToGe.tsx` (1,124 lines) and `web/src/GeToShop.tsx`
  (930 lines).
- **Observed:** both independently implement filter → plan → sort → stats, so a
  fix has to be written twice and can drift.
- **Change:** extract shared hooks/components (`useFilteredRows`, `useSort`,
  `useResultsTable`, `useBudgetInputs`) and keep each page to its columns,
  labels and planner call.
- **Impact: medium (maintainability) · Effort: M.**

### 2.3 Throttle re-planning while typing

- **Where:** the `useMemo` that runs `planWithBudget` over every filtered row in
  `ShopToGe.tsx` / `GeToShop.tsx` / `Processing.tsx`.
- **Measured on a desktop-class machine** (Shop → GE, 2,151 rows): 17–75ms per
  keystroke, 75ms per mode switch. Acceptable here, but a mid-range phone is
  3–5× slower and the cost lands on every character.
- **Change:** `useDeferredValue` (or a ~150ms debounce) on the search string,
  and memoise the derived stats — the median-margin stat currently copies and
  sorts the whole row array on every render.
- **Impact: medium · Effort: S–M.**

### 2.4 UI-level tests

- **Where:** `tests/`.
- **Observed:** only pure helpers are covered (`columns.test.ts`,
  `storage.test.ts`, `route.test.ts`); nothing exercises rendering.
- **Change:** add jsdom render tests pinning the behaviours that are easy to
  break — a filter hides matching rows, a header click flips `aria-sort` and the
  order, the column picker round-trips through `localStorage`. Requires
  `jsdom` + `@testing-library/react` as dev dependencies, so it should be a
  deliberate, separate change.
- **Impact: medium · Effort: M.**

---

## 3. Larger / optional

### 3.1 Light theme

The palette is a single dark set of custom properties in `:root`
(`--bg`, `--panel`, `--panel-2`, `--line`, `--text`, `--dim`, `--accent`).
A `prefers-color-scheme: light` block that only redefines those variables is
tractable; the hardcoded greys introduced in the toolbar work (`#1e222a`,
`#15181d`, `#1d2128`, `#3d4451`) would need to become variables first.

### 3.2 Keyboard shortcut to focus search

`/` (or `Ctrl`/`Cmd`+`K`) focuses the search field from anywhere on the page.
Small, but the search is now the primary control.

### 3.3 Sticky toolbar

The toolbar scrolls away while the table keeps a sticky header. Pinning the
chip row (collapsed to one line once scrolled) would keep filters reachable
while browsing a long result set.

---

## Suggested batching

If these are taken in order, two coherent commits cover the cheap wins:

1. **Table chrome and accessibility** — 1.1, 1.3, 1.7, 1.8, plus the metadata
   in 1.6. Mechanical, no behaviour change, easy to review.
2. **Shareable state and input ergonomics** — 1.2, 1.4, 1.5. Adds URL state and
   input parsing; wants its own tests.

Then 2.1 (mobile) and 2.2 (deduplication) as standalone pieces of work.
