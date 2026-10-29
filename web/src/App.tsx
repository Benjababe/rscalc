import { useEffect, useState } from "react";

import { GeToShopPage } from "./GeToShop";
import { ShopToGePage } from "./ShopToGe";
import {
  DEFAULT_PAGE,
  PAGE_LABELS,
  PAGES,
  pageHash,
  parsePageHash,
  type Page,
} from "./route";

/**
 * The shell: header, page tabs and attribution. Each page owns its data
 * artifact, controls, table and caveats, so the two directions can evolve
 * independently. Routing is a hash so the build stays a static bundle.
 */
export function App(): JSX.Element {
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
            Arbitrage between OSRS shops and the Grand Exchange, priced from the
            Wiki's real-time API. Both directions are static snapshots: this
            site makes no network calls.
          </p>
        </div>
        <nav className="pages" aria-label="Calculator direction">
          {PAGES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === page ? "page-tab active" : "page-tab"}
              onClick={() => navigate(candidate)}
              aria-current={candidate === page ? "page" : undefined}
            >
              {PAGE_LABELS[candidate]}
            </button>
          ))}
        </nav>
      </header>

      {page === "ge-to-shop" ? <GeToShopPage /> : <ShopToGePage />}

      <footer className="footer">
        <p className="attribution">
          Item names and icons © Jagex. Wiki data CC BY-SA. Geo data from the
          OSRS Wiki map. This page makes no network calls.
        </p>
      </footer>
    </div>
  );
}
