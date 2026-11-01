import { lazy, Suspense, useEffect, useState } from "react";
import type { ComponentType } from "react";

import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "./theme";

import {
  DEFAULT_PAGE,
  PAGE_LABELS,
  PAGE_TITLES,
  PAGES,
  pageHash,
  parsePageHash,
  type Page,
} from "./route";

const EarnPage = lazy(() =>
  import("./Earn").then((module) => ({ default: module.EarnPage })),
);
const ShopToGePage = lazy(() =>
  import("./ShopToGe").then((module) => ({ default: module.ShopToGePage })),
);
const GeToShopPage = lazy(() =>
  import("./GeToShop").then((module) => ({ default: module.GeToShopPage })),
);
const ProcessingPage = lazy(() =>
  import("./Processing").then((module) => ({ default: module.ProcessingPage })),
);
const SkillingPage = lazy(() =>
  import("./Skilling").then((module) => ({ default: module.SkillingPage })),
);

/**
 * Which component renders which page.
 *
 * A record rather than a ternary chain: the chain fell through to `ShopToGePage`
 * for anything unrecognised, so a page added to `route.ts` but not here would
 * silently render the shop page. With `Record<Page, ...>` that is a type error
 * instead, and the router's exhaustive list is what the compiler checks.
 */
const PAGE_COMPONENTS: Record<Page, ComponentType> = {
  earn: EarnPage,
  "shop-to-ge": ShopToGePage,
  "ge-to-shop": GeToShopPage,
  processing: ProcessingPage,
  skilling: SkillingPage,
};

function CurrentPage({ page }: { page: Page }): JSX.Element {
  const Component = PAGE_COMPONENTS[page];
  return <Component />;
}

/**
 * The shell: header, page tabs and attribution. Each page owns its data
 * artifact, controls, table and caveats, so the directions can evolve
 * independently. Routing is a hash so the build stays a static bundle.
 */
export function App(): JSX.Element {
  const { theme, toggle: toggleTheme } = useTheme();
  const [page, setPage] = useState<Page>(() =>
    typeof window === "undefined" ? DEFAULT_PAGE : parsePageHash(window.location.hash),
  );

  useEffect(() => {
    const sync = (): void => setPage(parsePageHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function navigate(next: Page): void {
    setPage(next);
    const hash = pageHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>rscalc</h1>
          <p className="sub">
            A gp-earning calculator for Old School RuneScape: shop runs, Grand
            Exchange flips and deterministic processing, priced from the
            Wiki&apos;s real-time API and ranked by gp per hour at your own
            gold. Every number is a static snapshot, so the site makes no
            external API calls.
          </p>
        </div>
        <div className="header-actions">
          <nav className="pages" aria-label="Calculator">
            {PAGES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={candidate === page ? "page-tab active" : "page-tab"}
                onClick={() => navigate(candidate)}
                aria-current={candidate === page ? "page" : undefined}
                title={PAGE_TITLES[candidate]}
              >
                {PAGE_LABELS[candidate]}
              </button>
            ))}
          </nav>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <Suspense
        fallback={
          <div className="page">
            <p className="empty" role="status">
              Loading calculator…
            </p>
          </div>
        }
      >
        <CurrentPage page={page} />
      </Suspense>

      <footer className="footer">
        <p className="attribution">
          Item names and icons © Jagex. Wiki data CC BY-SA. Recipe data from the
          OSRS Wiki. Geo data from the OSRS Wiki map. The snapshots are static;
          no external API calls.
        </p>
      </footer>
    </div>
  );
}
