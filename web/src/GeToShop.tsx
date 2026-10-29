import { useMemo, useState } from "react";

import type {
  SellMode,
  ShopSinkOpportunity,
  ShopSinksPayload,
} from "../../src/types";
import { wikiUrl } from "../../src/util/wiki";
import { formatDuration, formatGp, formatTime } from "./format";
import { Stat, Th } from "./ui";

import payload from "../../data/shop-sinks.json";

type SortKey =
  | "gpPerHour"
  | "profit"
  | "spend"
  | "units"
  | "loads"
  | "margin"
  | "marginPct"
  | "geBuyPrice"
  | "shopAvgPrice"
  | "geTiles"
  | "itemName";

const MODE_LABEL: Record<SellMode, string> = {
  pessimistic: "Instant buy (GE high)",
  patient: "Patient buy (GE low)",
};

/**
 * GE -> shop: buy on the Grand Exchange, sell the units to a shop whose stock
 * table publishes a buy price. Static snapshot; no network calls.
 */
// SAFETY: `data/shop-sinks.json` is only written by `scripts/refresh-sinks.ts`,
// which validates the payload with `ShopSinksPayloadSchema` first.
const DATA = payload as unknown as ShopSinksPayload;

export function GeToShopPage(): JSX.Element {
  const [mode, setMode] = useState<SellMode>("pessimistic");
  const [query, setQuery] = useState("");
  const [membersOnly, setMembersOnly] = useState(false);
  const [minProfit, setMinProfit] = useState(0);
  const [minVolume, setMinVolume] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("gpPerHour");
  const [descending, setDescending] = useState(true);

  const ranking = DATA[mode];

  const rows = useMemo<ShopSinkOpportunity[]>(() => {
    const needle = query.trim().toLowerCase();

    const filtered = ranking.opportunities.filter((opp) => {
      if (membersOnly && !opp.members) return false;
      if (opp.profit < minProfit) return false;
      if (opp.purchaseCap4h < minVolume) return false;
      if (needle === "") return true;
      return (
        opp.itemName.toLowerCase().includes(needle) ||
        opp.shopName.toLowerCase().includes(needle) ||
        (opp.location ?? "").toLowerCase().includes(needle)
      );
    });

    const measure = (row: ShopSinkOpportunity): number | null => {
      switch (sortKey) {
        case "gpPerHour":
          return row.gpPerHour;
        case "profit":
          return row.profit;
        case "spend":
          return row.totalCost;
        case "units":
          return row.units;
        case "loads":
          return row.loads;
        case "margin":
          return row.margin;
        case "marginPct":
          return row.marginPct;
        case "geBuyPrice":
          return row.geBuyPrice;
        case "shopAvgPrice":
          return row.shopAvgPrice;
        case "geTiles":
          return row.geTiles;
        case "itemName":
          return null;
        default:
          return null;
      }
    };

    return [...filtered].sort((a, b) => {
      if (sortKey === "itemName") {
        return descending
          ? b.itemName.localeCompare(a.itemName)
          : a.itemName.localeCompare(b.itemName);
      }

      const aValue = measure(a);
      const bValue = measure(b);
      if (aValue === null || bValue === null) {
        if (aValue !== bValue) {
          // Unknown travel is never better than a known time, whichever way the
          // column is sorted.
          return aValue === null ? 1 : -1;
        }
      } else if (aValue !== bValue) {
        return descending ? bValue - aValue : aValue - bValue;
      }

      const byShop = a.shopName.localeCompare(b.shopName);
      if (byShop !== 0) return byShop;
      return a.itemName.localeCompare(b.itemName);
    });
  }, [ranking, query, membersOnly, minProfit, minVolume, sortKey, descending]);

  if (ranking.opportunities.length === 0) {
    return (
      <div className="page">
        <p className="empty">
          {DATA.gePoint === null
            ? "The shop catalogue has no Grand Exchange location, so no flips could be priced."
            : "No GE → shop flips are profitable in this snapshot."}
        </p>
      </div>
    );
  }

  const bestRate = rows.reduce<ShopSinkOpportunity | undefined>((best, row) => {
    if (row.gpPerHour === null) return best;
    if (best === undefined) return row;
    return row.gpPerHour > (best.gpPerHour ?? Number.NEGATIVE_INFINITY)
      ? row
      : best;
  }, undefined);

  const bestProfit = rows.reduce<ShopSinkOpportunity | undefined>(
    (best, row) => (best === undefined || row.profit > best.profit ? row : best),
    undefined,
  );

  const shopCount = new Set(rows.map((row) => row.shopPage)).size;

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  return (
    <div className="page">
      <div className="pagebar">
        <div className="asof">
          <span className="label">GE prices as of</span>
          <strong>{formatTime(ranking.pricesAsOf)}</strong>
          <span className="label">built {formatTime(DATA.generatedAt)}</span>
        </div>
      </div>

      <section className="controls">
        <div className="modes" role="group" aria-label="Buy mode">
          {(["pessimistic", "patient"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? "mode active" : "mode"}
              onClick={() => setMode(m)}
              aria-pressed={m === mode}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <input
          className="search"
          type="search"
          placeholder="Filter by item, shop or location…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter"
        />

        <label className="toggle">
          <input
            type="checkbox"
            checked={membersOnly}
            onChange={(event) => setMembersOnly(event.target.checked)}
          />
          Members only
        </label>

        <label
          className="toggle"
          title="Minimum total profit for one planned sale"
        >
          Min profit / run
          <input
            className="num"
            type="number"
            min={0}
            step={100}
            value={minProfit}
            onChange={(event) => setMinProfit(Number(event.target.value) || 0)}
            aria-label="Minimum profit per run"
          />
        </label>

        <label
          className="toggle"
          title="Minimum units the GE can supply in a 4h window (buy limit and 24h volume)"
        >
          Min 4h volume
          <input
            className="num"
            type="number"
            min={0}
            step={10}
            value={minVolume}
            onChange={(event) => setMinVolume(Number(event.target.value) || 0)}
            aria-label="Minimum purchasable units per 4 hours"
          />
        </label>
      </section>

      <p className="hint">
        Buy on the GE at{" "}
        <strong>{mode === "pessimistic" ? "high" : "low"}</strong> and sell to a
        shop that publishes a buy price. <strong>General stores are excluded</strong>{" "}
        for now. A shop pays less for every unit it takes, so <strong>Qty</strong>{" "}
        stops where its next price no longer beats what you paid; the GE buy limit
        and 24h volume cap the purchase too. No GE tax applies on either leg. The
        origin is the Grand Exchange at{" "}
        {DATA.gePoint === null ? (
          <strong>an unknown location</strong>
        ) : (
          <strong>
            {DATA.gePoint.x}, {DATA.gePoint.y}
          </strong>
        )}
        ; trip time is the slower of walking the loads and waiting for the GE to
        supply them.
      </p>

      <section className="stats">
        <Stat label="Flips" value={rows.length.toLocaleString()} />
        <Stat
          label="Best gp / hour"
          value={
            bestRate?.gpPerHour != null
              ? formatGp(Math.round(bestRate.gpPerHour))
              : "—"
          }
          title={
            bestRate
              ? `${bestRate.itemName} at ${bestRate.shopName}`
              : "No flip has a known Grand Exchange distance"
          }
          accent
        />
        <Stat
          label="Best profit / run"
          value={
            bestProfit === undefined
              ? "—"
              : `${formatGp(Math.round(bestProfit.profit))} gp`
          }
          title={
            bestProfit
              ? `${bestProfit.itemName} at ${bestProfit.shopName}`
              : undefined
          }
        />
        <Stat
          label="Shops with results"
          value={shopCount.toLocaleString()}
          title="Distinct shops in the filtered rows"
        />
      </section>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th className="num-col">#</th>
              <Th
                label="Item"
                onClick={() => toggleSort("itemName")}
                active={sortKey === "itemName"}
                desc={descending}
                title="Item name; click to sort"
              />
              <th>Shop</th>
              <th className="loc-col">Location</th>
              <Th
                label="GE buy"
                onClick={() => toggleSort("geBuyPrice")}
                active={sortKey === "geBuyPrice"}
                desc={descending}
                title="What one unit costs on the GE in this mode; purchases carry no tax"
                right
              />
              <Th
                label="Shop pays"
                onClick={() => toggleSort("shopAvgPrice")}
                active={sortKey === "shopAvgPrice"}
                desc={descending}
                title="Average shop price across the planned units; it falls as the shop fills"
                right
              />
              <Th
                label="Margin"
                onClick={() => toggleSort("margin")}
                active={sortKey === "margin"}
                desc={descending}
                title="Average profit per unit after the GE cost"
                right
              />
              <Th
                label="Qty"
                onClick={() => toggleSort("units")}
                active={sortKey === "units"}
                desc={descending}
                title="Units worth selling, capped by the shop price curve and the GE 4h purchase cap"
                right
              />
              <Th
                label="Spend"
                onClick={() => toggleSort("spend")}
                active={sortKey === "spend"}
                desc={descending}
                title="Coins paid on the GE"
                right
              />
              <Th
                label="Profit"
                onClick={() => toggleSort("profit")}
                active={sortKey === "profit"}
                desc={descending}
                title="Coins received from the shop minus the GE spend"
                right
              />
              <Th
                label="Loads"
                onClick={() => toggleSort("loads")}
                active={sortKey === "loads"}
                desc={descending}
                title="Inventory loads; 27 non-stackable units each, one slot for a stackable item"
                right
              />
              <Th
                label="Trip"
                onClick={() => toggleSort("geTiles")}
                active={sortKey === "geTiles"}
                desc={descending}
                title="One Grand Exchange round trip: straight-line distance × 2 at the chosen walking speed"
                right
              />
              <Th
                label="gp / hour"
                onClick={() => toggleSort("gpPerHour")}
                active={sortKey === "gpPerHour"}
                desc={descending}
                title="Profit ÷ the slower of travel and GE supply time; — when the distance is unknown"
                right
              />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((row, index) => (
              <Row key={`${row.itemId}-${row.shopPage}`} row={row} rank={index + 1} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="empty">No flips match these filters.</p>
        )}
        {rows.length > 300 && (
          <p className="empty">
            Showing the top 300 of {rows.length.toLocaleString()}.
          </p>
        )}
      </div>

      <footer className="footer">
        <details className="caveats">
          <summary>Assumptions &amp; caveats</summary>
          <p>
            <strong>Buy</strong> is what one unit costs on the GE in the selected
            mode: <strong>instant buy</strong> pays the latest <code>high</code>{" "}
            and is the number to trust; <strong>patient buy</strong> rests an
            offer at the latest <code>low</code> and may never fill. There is no
            GE tax on either leg — the 2% tax applies only to GE sales. The shop
            pays less for every unit it takes, and never less than 10% of the
            item's value, so the plan stops at the marginal unit that no longer
            beats the GE cost. The first and last shop prices are shown in the
            cell's tooltip; the cell itself is the average across the quantity.
          </p>
          <p>
            <strong>Qty</strong> is bounded by the GE, not the shop: the
            4-hour buy limit and the 24h traded volume on this mode's side of the
            book, split into a 4-hour slice. Unlike the shop → GE page, the buy
            limit is a real purchase cap here. A GE buy limit is reported as
            metadata elsewhere; here it directly limits the plan.
          </p>
          <p>
            <strong>Loads and time.</strong> A backpack holds 28 items; the coin
            stack you buy offers with takes one slot, so a load carries 27
            non-stackable units. Stackable items occupy one slot for the whole
            stack. Each load costs a Grand Exchange round trip whose length is
            this shop's own straight-line distance to the GE, doubled, at the
            travel speed assumed by the data build — not a global trip time.
            Time is the slower of walking those loads and waiting for the GE to
            supply the units. Where the wiki map gives no GE distance (another
            map, or no coordinates), <strong>gp / hour</strong> is shown as{" "}
            <strong>—</strong> rather than assuming a trip.
          </p>
          <p>
            <strong>Only shops that publish a buy price are included.</strong>{" "}
            The wiki writes <code>N/A</code> when a shop does not buy an item at
            all (Eblis's ancient staff is one), even though its buy multiplier can
            still be non-zero. We require the published price. The stock table
            only covers items the shop stocks, so this page cannot see a
            specialist shop buying a related item it does not list, and{" "}
            <strong>general stores are excluded</strong>: they buy almost
            anything, but their table only describes what they sell. Both are
            known gaps, not silent assumptions.
          </p>
          <p>
            Shop stock is assumed to be at its default level on arrival. In
            practice a shop fills up as you sell and slowly destocks afterwards,
            so repeat runs from the same shop are optimistic; restock and destock
            timers are not modelled. Distances are straight-line tiles, not a
            walking route, so corners, obstacles and teleports are not modelled
            and the trip is a lower bound. Other players competing for the same
            shop are not modelled either.
          </p>
        </details>
      </footer>
    </div>
  );
}

function Row({
  row,
  rank,
}: {
  row: ShopSinkOpportunity;
  rank: number;
}): JSX.Element {
  const tripTitle =
    row.geTiles === null
      ? "No Grand Exchange distance on this shop's map, so travel time is unknown"
      : `${Math.round(row.geTiles).toLocaleString()} tiles each way, ${Math.round(
          row.tripSeconds ?? 0,
        )}s round trip`;
  const shopTitle = `Pays ${formatGp(row.shopFirstUnitPrice)} for the first unit and ${formatGp(
    row.shopLastUnitPrice,
  )} for the last; average ${formatGp(Math.round(row.shopAvgPrice))}. The price falls as the shop fills.`;

  return (
    <tr>
      <td className="num-col">{rank}</td>
      <td className="item">
        <a
          className="name wiki-link"
          href={wikiUrl(row.itemName)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {row.itemName}
        </a>
        {row.members && <span className="badge">P2P</span>}
      </td>
      <td className="shop" title={row.shopPage}>
        <a
          className="wiki-link"
          href={wikiUrl(row.shopPage)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {row.shopName}
        </a>
      </td>
      <td className="loc loc-col">{row.location ?? "—"}</td>
      <td className="right mono">{formatGp(row.geBuyPrice)}</td>
      <td className="right mono" title={shopTitle}>
        {formatGp(Math.round(row.shopAvgPrice))}
        <span className="cell-note">
          {formatGp(row.shopFirstUnitPrice)} → {formatGp(row.shopLastUnitPrice)}
        </span>
      </td>
      <td className="right mono pos" title={row.atFloor ? "The last unit already paid the 10%-of-value floor" : undefined}>
        {formatGp(Math.round(row.margin))}
        <span className="cell-note">{row.marginPct.toFixed(1)}%</span>
      </td>
      <td className="right mono strong">{row.units.toLocaleString()}</td>
      <td className="right mono">{formatGp(Math.round(row.totalCost))}</td>
      <td className="right mono pos">{formatGp(Math.round(row.profit))}</td>
      <td
        className="right mono dim"
        title={
          row.stackable === true
            ? "Stackable: one inventory slot holds the whole quantity"
            : `Non-stackable: ${row.unitsPerLoad} units per inventory load`
        }
      >
        {row.loads.toLocaleString()}
      </td>
      <td className="right mono dim" title={tripTitle}>
        {row.tripSeconds === null ? "—" : formatDuration(row.tripSeconds)}
      </td>
      <td
        className="right mono strong"
        title={
          row.gpPerHour === null
            ? "Bank-distance equivalent unknown for the GE → shop trip, so the hourly rate is not computed"
            : `Buy time ${formatDuration(row.timeSeconds)} for ${row.units.toLocaleString()} units`
        }
      >
        {row.gpPerHour === null ? "—" : formatGp(Math.round(row.gpPerHour))}
      </td>
    </tr>
  );
}
