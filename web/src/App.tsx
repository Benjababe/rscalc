import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { ComponentType } from "react";

import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "./theme";

import {
  PAGE_ARTIFACTS,
  artifactsLoaded,
  datasetIsStale,
  loadDataset,
} from "./dataset";
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

/** How often a long-lived tab asks whether the server published a new dataset. */
const STALE_POLL_MS = 5 * 60 * 1000;

type DataState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

/**
 * Load the artifacts this page needs.
 *
 * The page component is only rendered in the `ready` branch, which is what makes
 * the module-scope-free `payload()` reads inside the pages safe: a page module is
 * imported after its data is in memory, never before.
 */
function usePageData(page: Page): { state: DataState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DataState>(() =>
    artifactsLoaded(PAGE_ARTIFACTS[page]) ? { status: "ready" } : { status: "loading" },
  );

  useEffect(() => {
    if (artifactsLoaded(PAGE_ARTIFACTS[page])) {
      setState({ status: "ready" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    loadDataset(PAGE_ARTIFACTS[page]).then(
      () => {
        if (!cancelled) setState({ status: "ready" });
      },
      (cause: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [page, attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);
  return { state, retry };
}

/**
 * The dataset newer than the one on screen, if any.
 *
 * A four-hourly refresh is invisible to a tab that loaded before it, so the shell
 * asks the (tiny, `no-store`) manifest every few minutes and offers a reload. It
 * never swaps the data underneath a rendered table: the numbers a player is
 * reading stay consistent until they choose to reload.
 */
function useNewerDataset(): string | null {
  const [published, setPublished] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = (): void => {
      if (document.visibilityState === "hidden") return;
      void datasetIsStale().then((dataset) => {
        if (!cancelled && dataset !== null) setPublished(dataset);
      });
    };
    const timer = setInterval(check, STALE_POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);
  return published;
}

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
  const data = usePageData(page);
  const newerDataset = useNewerDataset();

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
            gold. This server re-derives the tables every four hours; the
            browser calls nothing but this site.
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

      {newerDataset !== null && (
        <div className="dataset-banner" role="status">
          <span>New prices are published on the server.</span>
          <button type="button" className="chip-clear" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      {data.state.status === "loading" && (
        <div className="page">
          <p className="empty" role="status">
            Loading prices…
          </p>
        </div>
      )}

      {data.state.status === "error" && (
        <div className="page">
          <div className="empty" role="alert">
            <p>
              <strong>Could not load the price data.</strong>
            </p>
            <p className="error-detail">{data.state.message}</p>
            <button type="button" className="chip-clear" onClick={data.retry}>
              Try again
            </button>
          </div>
        </div>
      )}

      {data.state.status === "ready" && (
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
      )}

      <footer className="footer">
        <p className="attribution">
          Item names and icons © Jagex. Wiki data CC BY-SA. Recipe data from the
          OSRS Wiki. Geo data from the OSRS Wiki map. Snapshots are rebuilt on
          the server every four hours; the browser calls nothing but this site.
        </p>
      </footer>
    </div>
  );
}
