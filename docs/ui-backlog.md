# UI improvements backlog

Candidate work on the web UI, gathered from an audit of the built bundle
(`pnpm build` + `pnpm preview`) rather than from assumptions. Every item below
was observed or measured in the browser; each entry says what was measured, so
it can be re-checked after a change.

**Scope note:** nothing here touches the pricing engine, the tax formula, the
travel model or the artifacts. These are presentation, accessibility and
ergonomics changes over the same numbers.

**Out of scope:** the site is desktop-only. Mobile is not a target for the
foreseeable future, so there is no card-per-row table layout or touch-first
redesign planned; a narrow window is served only by the existing column hiding
in the media queries. Do not add mobile work here without a request.

Legend: **impact** is user-visible benefit, **effort** is rough size of the
change (S ≈ under an hour, M ≈ half a day, L ≈ a day or more).

## Status

|Item|State|
|-|-|
|1.1 Surface the 300-row cap|**done** — replaced by pagination (`web/src/paging.tsx`)|
|1.2 Shareable view state|**done** — view in the hash + Copy link|
|1.3 Table accessibility|**done** — `scope`, `aria-sort`, `<caption>`, focusable region|
|1.4 Gold input ergonomics|**done** — `web/src/money.ts` + `GoldInput.tsx`|
|1.5 Stale snapshot warning|**done** — `StaleWarning` in `web/src/ui.tsx`|
|1.6 Document head metadata|**done** — `web/index.html`|
|1.7 Empty-state exit|**done** — clear-filters in the chip row and the empty panel|
|1.8 `prefers-reduced-motion`|**done** — `web/src/styles.css`|
|2.1 Remove duplicated page orchestration|**done** — `FilterToolbar`, `BudgetPanel`, `settings`, `sorting`, `matching`|
|2.2 Throttle re-planning|**done** — deferred query + memoised stats|
|2.3 UI-level tests|**done** — jsdom render tests for page + controls|
|3.1 Light theme|**done** — header toggle, opens dark, remembered|
|3.2 Keyboard shortcut to focus search|**done** — `/` and Ctrl/Cmd+K|
|3.3 Sticky toolbar|**dropped** — built, reviewed, removed|

**Open:** 4.1 (see below). Every other item has landed except 3.3, which was
built and dropped by request.

### 4.1 One table component with a native column toggle

- **Where:** `web/src/DataTable.tsx` (new), `web/src/ui.tsx` (`Results.tools`).
- **Observed:** each page repeated the same four pieces — a `colgroup` filtered by
  visibility, a `<thead>` with a `visible.has(...)` guard around every header, a
  `<tbody>` with the matching guard around every cell, and a `ColumnPicker` wired
  into its own toolbar. Three pages had the picker, two had a static `COLUMNS`
  array with no toggle at all, and adding one column meant editing four places.
- **Change:** a page declares `DataColumn<Row>[]` (key, label, width, sort key,
  tooltip, cell renderer) and renders `<DataTable columns={...} paged={...}
  sort={...} />`. The table owns the caption, widths, sortable headers with
  `aria-sort`, the rank column, the row count, the pager, the empty state **and the
  Columns picker**, which now sits in the result bar as part of the table rather
  than in each page's toolbar. Visibility is persisted per `tableId`; a
  mode-switching table passes `allColumns` so hiding a column in one mode keeps it
  hidden in the other; a `required` column can never be hidden.
- **Landed:** `#/skilling` (gained the toggle, which it never had), `#/processing`
  and `#/ge-to-shop` (their own picker buttons removed). `tests/dataTable.test.tsx`
  pins the rank numbering, the sortable headers, the native picker, per-`tableId`
  persistence, the required column and the empty state.
- **Open:** `#/shop-to-ge` and `#/earn` still use the old pattern. Their column sets
  are mode-dependent, so the migration is a `makeColumns()` builder plus
  `columnsForMode()` / `allColumns()` helpers (the shape `#/ge-to-shop` now uses);
  nothing in `DataTable` blocks them.

---

## 1. High impact, small effort

### 1.1 Surface the 300-row cap

- **Where:** `web/src/ShopToGe.tsx:831`, `web/src/GeToShop.tsx:689`,
  `web/src/Processing.tsx:701`.
- **Observed:** each page rendered `rows.slice(0, 300)` and printed
  "Showing the top 300 of N" as a `<p class="empty">` **inside** the scrolling
  `.tablewrap` (measured on Shop → GE: 2,151 matches, 300 rows in the DOM).
  The notice was only reachable by scrolling to the bottom of a 74vh box, so
  the truncation was effectively invisible.
- **Done:** the cap is gone. `usePagedRows` pages the filtered rows (default
  100, options 50/100/250), the count above the table reads
  `1–100 of 1,909 opportunities`, and a pager below the table jumps to any
  page. Filtering or re-sorting returns to page 1. Verified: 1,909 rows split
  across 20 pages with each row appearing exactly once, and the last page
  showing 1,901–1,909.

### 1.2 Shareable, deep-linkable view state

- **Where:** `web/src/viewState.ts` (new), `web/src/route.ts`, all three pages.
- **Done.** The hash now carries the view after the page:
  `#/ge-to-shop?mode=patient&sort=profit&desc=0&q=emerald&minprofit=1000`.
  Encoded: `mode`, `sort`, `desc` (only when ascending), `q`, `members`,
  `locked=0` (hide locked), `minvol`, `minprofit`, `skill`. Gold and column
  visibility stay in `localStorage` — they are preferences, not part of a shared
  view. Only values that differ from the defaults are written, so an untouched
  page keeps a clean `#/ge-to-shop`.
- **Copy link** sits next to the column picker in the shared toolbar and reports
  `Copied` / `Copy failed` in place, because a silent clipboard write leaves the
  player unsure whether anything happened.
- **Router bug found while testing:** `parsePageHash` matched the whole hash, so
  `#/ge-to-shop?q=rune` fell through to the default page and loaded the wrong
  calculator. It now matches the path before `?`; `tests/route.test.ts` pins it.
- **Writes use `replaceState`,** not `location.hash =`, so editing filters does
  not put one history entry per keystroke on the back button, and it cannot
  re-trigger the router.
- **Tested:** `tests/viewState.test.ts` (17 cases) covers the round trip, the
  omission of defaults, junk in hand-edited hashes (negative or non-numeric
  amounts, `members=true`, unknown keys) and `pickOne`. In the browser a deep
  link restored mode, search, chips, thresholds, sort key and direction on all
  three pages; editing them updated the hash without growing history; and the
  copy button wrote the current URL (success, rejection and missing-clipboard
  paths all checked).

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

### 2.1 Remove the duplicated page orchestration

- **Where:** `web/src/ShopToGe.tsx` and `web/src/GeToShop.tsx`.
- **Observed:** both independently implemented filter → plan → sort → stats, so a
  fix had to be written twice and could drift. The toolbar card alone was 224
  lines in `ShopToGe` and 225 in `GeToShop`, ~90% identical; the budget card was
  another 90-190 lines each. `ShopToGe` even kept its own
  `DEFAULT_HOP_SECONDS = 10` while `GeToShop` imported the same value from
  `src/domain/budget`.
- **Done:** the shared pieces live in their own modules — `FilterToolbar.tsx`
  (mode switch, search, freshness line, chip row, clear link, `FilterCheck`,
  `FilterNumber`), `BudgetPanel.tsx` (gold field, presets, hint, `TravelFields`),
  `settings.ts` (`useBudgetSettings` — the only writer of `rscalc.budget` — and
  `useTravelSettings`), `sorting.ts` (`useSort` + `sortByMeasure`, the
  unknown-values-last rule) and `matching.ts` (`matchesQuery`).
- **Result:** 3,165 → 3,186 lines in total, but the three pages lost ~430 lines
  of duplicated orchestration between them; the remainder is page-specific
  columns, cell rendering, stats and caveats, which is what the item asked to
  keep.
- **Verified:** the rendered `.page` text of all three pages in both modes was
  hashed before and after the refactor — six snapshots, byte-identical (for
  example Shop → GE pessimistic `8862615f`, 15,000 chars, 1,909 rows). Sort
  toggling, search, clear-filters, the skill filter, the budget/shop view switch
  and the travel fields were exercised afterwards.
- **One behaviour change:** `matchesQuery` joins the fields and matches the
  joined text, so a query may now span two fields ("rune shop" finds *Astral
  rune* at *Baba Yaga's Magic Shop*). The shop pages already worked this way; the
  processing page now matches identically instead of field by field.

### 2.2 Throttle re-planning while typing

- **Where:** the `useMemo` that runs `planWithBudget` over every filtered row in
  `ShopToGe.tsx` / `GeToShop.tsx` / `Processing.tsx`, and the stat cards below it.
- **Done, and what it actually bought.** Two things changed:

  1. The stat cards are memoised on `rows`. They re-scanned (and, for the median
     margin, copied and sorted) the whole result set on every render, including
     renders where the rows had not changed at all — opening a basket, toggling a
     column, flipping the budget/shop view.
  2. The search string feeds the planner through `useDeferredValue`, so the input
     updates immediately and the planning render is interruptible.

- **Measured** (same harness before and after, Shop → GE, 1,909 rows; synchronous
  cost of a keystroke):

  | case | before | after |
  |---|---|---|
  | clear the box (re-plans 1,909 rows) | 12.8–15.1ms | 0.2–0.4ms |
  | first characters of a query | 14.6 / 12.9ms | 9.3 / 8.7ms |
  | burst of five characters, until settled | ~325ms (30ms gaps) | ~327ms |
  | mode switch | 30–33ms | 25–33ms |

- **Honest conclusion:** the deferral moves planning off the keystroke path; it
  does not reduce total work. A burst of typing still costs the same wall-clock
  time to settle, because React flushes the pending render inside the next
  keystroke. What improves is that no single character blocks the input for
  ~13ms, which matters on a slower machine or a bigger snapshot.
- **Rejected:** a 150ms debounce was implemented and measured first. It reduced
  the number of computations but made the user-visible settle worse — ~470ms
  versus ~325ms at 30ms keystroke gaps, ~885ms versus ~800ms at 120ms — because
  every query pays the 150ms wait. With planning already this cheap, the latency
  is not worth a throughput gain nobody can see.
- **Verified:** all six rendered snapshots (three pages × both modes) hash
  identically to before, so no number changed.

### 2.3 UI-level tests

- **Where:** `tests/shopToGePage.test.tsx`, `tests/uiControls.test.tsx` (new).
- **Done.** `jsdom` and `@testing-library/react` are dev dependencies; UI tests
  opt into the DOM per file with `// @vitest-environment jsdom`, so the pure
  suites keep running in node. `vitest.config.ts` now includes `*.test.tsx`.
- **Page tests** render the real `ShopToGePage` against the committed artifact:
  it shows one page of 100 rows with the range above the table; a search hides
  non-matching rows; an impossible query shows the empty state and its clear
  button restores the full list; a header click sorts, flips `aria-sort` on the
  second click, and leaves exactly one column sorted; the column picker removes
  a column; Next pages to `101–200` with row numbering continuing; and a URL
  with `q=` and `members=1` restores that view.
- **Control tests** cover what the page cannot reach cheaply: the gold field's
  shorthand (`2.5m` → 2,500,000 committed, junk not committed, blur restores the
  committed amount), the copy link's success/refused/absent-clipboard labels,
  and the `/` shortcut focusing the box from the body but not from a field the
  player is already typing in.
- **Cost:** ~3.4s for both files including the 2.5MB artifact, so the whole
  suite is still under 5s.
- **Not covered:** the GE → shop and processing pages are only exercised by the
  shared components they use; a page-level test for them is the obvious next
  step if their page-specific cells change.

---

## 3. Larger / optional

### 3.1 Light theme

- **Done, as a switch rather than an OS preference.** A button in the header
  (`web/src/ThemeToggle.tsx`) flips between dark and light; `web/src/theme.ts`
  owns the state, the `data-theme` attribute and the `localStorage` entry
  (`rscalc.theme`). The icons are inline SVG (solid crescent for dark, outlined
  sun for light, both `currentColor`) rather than the ☾/☀ glyphs, which render at
  a different weight and baseline in every font stack and are swapped for emoji on
  some platforms. **The site always opens dark** unless the player has chosen
  otherwise, so this is keyed off `:root[data-theme="light"]` and deliberately
  not off `prefers-color-scheme` — that would have let a light-preferring OS
  override the stated default. `tests/theme.test.ts` asserts no such media query
  exists.
- **Tokenised first.** Every colour in `web/src/styles.css` is now a token (39 of
  them, grouped by role), because the earlier toolbar work had left ~28 literals
  behind (`#3d4451` borders, `#1a1d23` fields, `#1f232b` row hover, the gold
  `rgba()` rings). Gold needed splitting: it works as a fill in both themes, but
  gold *text* on white fails every threshold, so `--accent-text` goes dark in
  light mode and a test enforces that it is never used for a background or
  border.
- **Contrast measured** in light mode: body text 18.1:1, dim 6.3:1, accent-text
  6.3:1, links 7.7:1, positive 5.4:1, badge 7.2:1, text on the gold fill 10.4:1,
  placeholder 4.8:1 (the first value came out at 3.0:1 and was darkened).
- **Dark is unchanged** — checked element by element, not assumed: computed
  colours of 20 selectors matched the pre-refactor values exactly.
- **Verified in the browser:** a fresh visit is dark with the moon glyph and
  `aria-pressed="false"`; clicking switches `data-theme` to `light`, the palette
  and `<meta name="theme-color">` follow, and the choice survives a reload;
  clicking again returns to dark.
- **A trap worth recording:** the literal→token sweep also rewrote the token
  *definitions* (25 became self-referential, e.g. `--badge-bg: var(--badge-bg)`),
  and a naive `color: var(--accent)` replacement also hit `border-color:` and
  `background-color:`. Both fail as "invalid at computed-value time" — the
  element silently loses its colour instead of erroring. `tests/theme.test.ts`
  pins the invariants: identical token sets in both themes, no token keeping its
  dark value, no colour literal outside the token blocks, no unused or undefined
  token, and `--accent-text` used only as a text colour.

### 3.2 Keyboard shortcut to focus search

`/` (or `Ctrl`/`Cmd`+`K`) focuses the search field from anywhere on the page.
Small, but the search is now the primary control.

- **Done.** `web/src/searchShortcut.ts` decides this from the key, the modifiers
  and whether the focused element already accepts typing, so it never steals a
  `/` from a number field, a `select` or the search box itself. `Shift`+`/` still
  fires, because that is how `/` is typed on most layouts; anything with `Alt`
  is left to the window manager, and a key another handler already claimed
  (`defaultPrevented`) is left alone. Bundled into the shared `FilterToolbar`, so
  all three pages get it.
- **Discoverability:** a small `kbd` showing `/` sits at the right edge of the
  field and fades out once the field has focus. The input also carries
  `aria-keyshortcuts="/ Control+K Meta+K"`.
- **Tested:** `tests/searchShortcut.test.ts` (13 cases) covers the key/modifier
  matrix, the typing-target guard and the `defaultPrevented` case without a DOM.
  Verified in the browser that a real `/` keypress moves focus and does *not*
  insert the character, and that `/` typed inside a number input, a `select` or
  the search box itself is untouched.

### 3.3 Sticky toolbar — dropped

The toolbar scrolled away while the table kept a sticky header, so a filter
change after scrolling down meant scrolling back up.

- **Built, reviewed and removed.** `position: sticky` plus a `useStuck` hook
  worked: the toolbar pinned at `top: 0`, dropped the source timestamps, and
  pulled the chip row onto one line (117px → 107px while pinned).
- **Why it went anyway:** it was not wanted. The table already has its own
  scroll container with a sticky header, so the page only scrolls a little
  beyond the toolbar, and the extra pinned band covered table rows for that
  small gain. This is a product decision, not a technical one — the code was
  removed and the page is back to a normal scrolling toolbar.
- **Do not re-add** without a request, the same way mobile is out of scope.

---

## Suggested batching

If these are taken in order, two coherent commits cover the cheap wins:

1. **Table chrome and accessibility** — 1.1, 1.3, 1.7, 1.8, plus the metadata
   in 1.6. Mechanical, no behaviour change, easy to review. **Landed.**
2. **Shareable state and input ergonomics** — 1.2, 1.4, 1.5. Adds URL state and
   input parsing; wants its own tests. **Landed.**
3. **Page deduplication** — 2.1. **Landed**, verified by hashing the rendered
   text of all three pages in both modes before and after.

Nothing remains open. (3.3 was built and dropped by request.)
