import { useMemo, useState } from "react";

import {
  DEFAULT_HOP_SECONDS,
  DEFAULT_SECONDS_PER_TILE,
} from "../../src/domain/budget";
import { DEFAULT_SINK_HANDOVER_SECONDS } from "../../src/domain/shopSink";
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
  | "unitsPerWorld"
  | "worlds"
  | "margin"
  | "marginPct"
  | "geBuyPrice"
  | "shopAvgPrice"
  | "geTiles"
  | "itemName";

interface RowData {
  row: ShopSinkOpportunity;
  /** Recomputed with the user's travel speed; null when the distance is unknown. */
  tripSeconds: number | null;
  timeSeconds: number;
  gpPerHour: number | null;
}

const MODE_LABEL: Record<SellMode, string> = {
  pessimistic: "Instant buy (GE high)",
  patient: "Patient buy (GE low)",
};

/**
 * GE -> shop: buy on the Grand Exchange, sell the noted stack to a shop whose
 * stock table publishes a buy price, hopping worlds so each one resets the
 * shop's stock. Static snapshot; no network calls.
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
  const [hopSeconds, setHopSeconds] = useState(DEFAULT_HOP_SECONDS);
  const [secondsPerTile, setSecondsPerTile] = useState(
    DEFAULT_SECONDS_PER_TILE,
  );
  const [sortKey, setSortKey] = useState<SortKey>("gpPerHour");
  const [descending, setDescending] = useState(true);

  const ranking = DATA[mode];

  const rows = useMemo<RowData[]>(() => {
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

    // The artifact's gp/hour assumes the build's hop and travel defaults. Both
    // are interface/movement assumptions, not sourced per-shop data, so the UI
    // recomputes the time from the row's own distance and world count.
    const computed: RowData[] = filtered.map((row) => {
      const tripSeconds =
        row.geTiles === null
          ? null
          : 2 * row.geTiles * secondsPerTile + DEFAULT_SINK_HANDOVER_SECONDS;
      const hopSecondsTotal = row.worlds * hopSeconds;
      const travelSeconds =
        tripSeconds === null ? 0 : tripSeconds + hopSecondsTotal;
      const buySeconds =
        row.purchaseCap4h > 0
          ? (row.units / row.purchaseCap4h) * 4 * 3600
          : 0;
      const timeSeconds = Math.max(travelSeconds, buySeconds);
      const gpPerHour =
        tripSeconds === null
          ? null
          : timeSeconds > 0
            ? (row.profit * 3600) / timeSeconds
            : 0;
      return { row, tripSeconds, timeSeconds, gpPerHour };
    });

    const measure = (entry: RowData): number | null => {
      switch (sortKey) {
        case "gpPerHour":
          return entry.gpPerHour;
        case "profit":
          return entry.row.profit;
        case "spend":
          return entry.row.totalCost;
        case "units":
          return entry.row.units;
        case "unitsPerWorld":
          return entry.row.unitsPerWorld;
        case "worlds":
          return entry.row.worlds;
        case "margin":
          return entry.row.margin;
        case "marginPct":
          return entry.row.marginPct;
        case "geBuyPrice":
          return entry.row.geBuyPrice;
        case "shopAvgPrice":
          return entry.row.shopAvgPrice;
        case "geTiles":
          return entry.row.geTiles;
        case "itemName":
          return null;
        default:
          return null;
      }
    };

    return computed.sort((a, b) => {
      if (sortKey === "itemName") {
        return descending
          ? b.row.itemName.localeCompare(a.row.itemName)
          : a.row.itemName.localeCompare(b.row.itemName);
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

      const byShop = a.row.shopName.localeCompare(b.row.shopName);
      if (byShop !== 0) return byShop;
      return a.row.itemName.localeCompare(b.row.itemName);
    });
  }, [
    ranking,
    query,
    membersOnly,
    minProfit,
    minVolume,
    hopSeconds,
    secondsPerTile,
    sortKey,
    descending,
  ]);

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

  const bestRate = rows.reduce<RowData | undefined>((best, row) => {
    if (row.gpPerHour === null) return best;
    if (best === undefined) return row;
    return row.gpPerHour > (best.gpPerHour ?? Number.NEGATIVE_INFINITY)
      ? row
      : best;
  }, undefined);

  const bestProfit = rows.reduce<RowData | undefined>(
    (best, row) =>
      best === undefined || row.row.profit > best.row.profit ? row : best,
    undefined,
  );

  const shopCount = new Set(rows.map((entry) => entry.row.shopPage)).size;

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
          title="Minimum total profit for the planned sale"
        >
          Min profit
          <input
            className="num"
            type="number"
            min={0}
            step={1000}
            value={minProfit}
            onChange={(event) => setMinProfit(Number(event.target.value) || 0)}
            aria-label="Minimum total profit"
          />
        </label>

        <label
          className="toggle"
          title="Minimum units the GE can supply in a 4h window (buy limit and 24h volume)"
        >
          Min 4h supply
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

      <section className="controls budget">
        <div className="budget-inputs">
          <label className="toggle">
            <span className="label">World hop</span>
            <input
              className="num"
              type="number"
              min={0}
              step={1}
              value={hopSeconds}
              onChange={(event) =>
                setHopSeconds(Math.max(0, Number(event.target.value) || 0))
              }
              aria-label="World hop time in seconds"
            />
            s
          </label>

          <label className="toggle">
            <span className="label">Travel speed</span>
            <input
              className="num"
              type="number"
              min={0}
              step={0.05}
              value={secondsPerTile}
              onChange={(event) =>
                setSecondsPerTile(Math.max(0, Number(event.target.value) || 0))
              }
              aria-label="Seconds per game tile"
            />
            s / tile
          </label>
        </div>

        <p className="hint">
          Buy on the GE at{" "}
          <strong>{mode === "pessimistic" ? "high" : "low"}</strong> and sell to
          a shop that publishes a buy price. <strong>General stores are excluded</strong>{" "}
          for now. Items are collected as <strong>banknotes</strong>, so the
          whole purchase fits one inventory slot and there is no banking. Each
          fresh world resets the shop's stock to default: one GE↔shop trip plus{" "}
          <strong>{hopSeconds}s</strong> per world hop, with travel at{" "}
          <strong>{secondsPerTile}s</strong> per tile. The shop's offer falls by
          its <strong>delta%</strong> for every unit sold, which is what caps the
          batch on each world.
        </p>
      </section>

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
              ? `${bestRate.row.itemName} at ${bestRate.row.shopName}`
              : "No flip has a known Grand Exchange distance"
          }
          accent
        />
        <Stat
          label="Best profit"
          value={
            bestProfit === undefined
              ? "—"
              : `${formatGp(Math.round(bestProfit.row.profit))} gp`
          }
          title={
            bestProfit
              ? `${bestProfit.row.itemName} at ${bestProfit.row.shopName}`
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
                title="Average shop price across one world's batch; it falls as the shop fills"
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
                title="Total units sold across every world, capped by the GE purchase limit"
                right
              />
              <Th
                label="Batch"
                onClick={() => toggleSort("unitsPerWorld")}
                active={sortKey === "unitsPerWorld"}
                desc={descending}
                title="Units one fresh world absorbs before its next price stops paying"
                right
              />
              <Th
                label="Worlds"
                onClick={() => toggleSort("worlds")}
                active={sortKey === "worlds"}
                desc={descending}
                title="Worlds hopped; each one resets the shop's stock"
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
                title="Coins received from the shops minus the GE spend"
                right
              />
              <Th
                label="Trip"
                onClick={() => toggleSort("geTiles")}
                active={sortKey === "geTiles"}
                desc={descending}
                title="One Grand Exchange round trip; world hops are separate"
                right
              />
              <Th
                label="gp / hour"
                onClick={() => toggleSort("gpPerHour")}
                active={sortKey === "gpPerHour"}
                desc={descending}
                title="Profit ÷ the slower of travel plus hops and GE supply time; — when the distance is unknown"
                right
              />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((entry, index) => (
              <Row
                key={`${entry.row.itemId}-${entry.row.shopPage}`}
                data={entry}
                rank={index + 1}
                hopSeconds={hopSeconds}
              />
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
            GE tax on either leg — the 2% tax applies only to GE sales.
          </p>
          <p>
            <strong>The price falls as you sell.</strong> A shop pays less for
            every unit it takes: the <strong>delta%</strong> is the share of the
            item's value lost per unit (shown under the shop price as the drop
            per unit), and the offer never falls below 10% of value. The batch is
            the marginal sale that still beats the GE cost; a zero-margin unit is
            never sold. The shop is assumed to be at default stock when you
            arrive on each world.
          </p>
          <p>
            <strong>Notes remove banking; worlds reset the shop.</strong> GE
            purchases are collected as banknotes, so the whole quantity takes one
            inventory slot and there is no 27-unit load or bank trip. Instead,
            each fresh world resets that shop's stock, so the same falling price
            curve can be sold again after a hop. <strong>Qty</strong> totals the
            worlds, <strong>Batch</strong> is one world, and <strong>Worlds</strong>{" "}
            shows how many hops that takes. The plan is capped at{" "}
            <strong>200 worlds</strong> (the same ceiling as the shop → GE
            budget planner); a row marked <strong>world cap</strong> could sell
            more if you allowed more hops.
          </p>
          <p>
            <strong>Time.</strong> One GE↔shop round trip (this shop's own
            straight-line distance, doubled, plus a 3s interface handover), plus
            the world-hop time you set, versus the GE supplying the units under
            the 4h buy limit and 24h volume. The slower of the two is used. No
            banking time is charged. Where the wiki map gives no GE distance
            (another map, or no coordinates), <strong>gp / hour</strong> is{" "}
            <strong>—</strong> rather than assuming a trip.
          </p>
          <p>
            <strong>Only shops that publish a buy price are included.</strong>{" "}
            The wiki writes <code>N/A</code> when a shop does not buy an item at
            all (Eblis's ancient staff is one), even though its buy multiplier can
            still be non-zero. The stock table only covers items the shop stocks,
            so a specialist buying a related unlisted item is invisible, and{" "}
            <strong>general stores are excluded</strong>: they buy almost
            anything, but their table only describes what they sell. Both are
            known gaps, not silent assumptions.
          </p>
          <p>
            Distances are straight-line tiles, not a walking route, so corners,
            obstacles and teleports are not modelled and the trip is a lower
            bound. Other players competing for the same shop, and destocking
            between visits to the same world, are not modelled either. The
            200-world ceiling is an explicit assumption, not a sourced count.
          </p>
        </details>
      </footer>
    </div>
  );
}

function Row({
  data,
  rank,
  hopSeconds,
}: {
  data: RowData;
  rank: number;
  hopSeconds: number;
}): JSX.Element {
  const row = data.row;
  const tripTitle =
    data.tripSeconds === null
      ? "No Grand Exchange distance on this shop's map, so travel time is unknown"
      : `${Math.round(row.geTiles ?? 0).toLocaleString()} tiles each way, ${Math.round(
          data.tripSeconds,
        )}s round trip, plus ${row.worlds} hop${row.worlds === 1 ? "" : "s"} × ${hopSeconds}s`;
  const shopTitle = `Pays ${formatGp(row.shopFirstUnitPrice)} for the first unit and ${formatGp(
    row.shopLastUnitPrice,
  )} for the last on a fresh world; average ${formatGp(Math.round(row.shopAvgPrice))}. Each unit sold lowers the offer by ${row.priceDropPerUnit.toFixed(1)} gp (${row.deltaPct.toFixed(1)}% of value).`;
  const gpTitle =
    data.gpPerHour === null
      ? "The GE distance is unknown, so the hourly rate is not computed"
      : `Total time ${formatDuration(data.timeSeconds)} for ${row.units.toLocaleString()} units across ${row.worlds} worlds`;

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
          {formatGp(row.shopFirstUnitPrice)} → {formatGp(row.shopLastUnitPrice)}{" "}
          · −{row.deltaPct.toFixed(1)}%/unit
        </span>
      </td>
      <td
        className="right mono pos"
        title={row.atFloor ? "The last unit already paid the 10%-of-value floor" : undefined}
      >
        {formatGp(Math.round(row.margin))}
        <span className="cell-note">{row.marginPct.toFixed(1)}%</span>
      </td>
      <td className="right mono strong" title="Total across worlds, bounded by the GE 4h purchase cap">
        {row.units.toLocaleString()}
      </td>
      <td className="right mono" title="One fresh world's marginal sale before its price stops paying">
        {row.unitsPerWorld.toLocaleString()}
      </td>
      <td
        className="right mono dim"
        title={
          row.worldLimited
            ? `World ceiling reached (${row.worlds} worlds); the GE could supply more`
            : `${row.worlds} world${row.worlds === 1 ? "" : "s"} needed`
        }
      >
        {row.worlds.toLocaleString()}
        {row.worldLimited && <span className="cell-note">world cap</span>}
      </td>
      <td className="right mono">{formatGp(Math.round(row.totalCost))}</td>
      <td className="right mono pos">{formatGp(Math.round(row.profit))}</td>
      <td className="right mono dim" title={tripTitle}>
        {data.tripSeconds === null ? "—" : formatDuration(data.tripSeconds)}
      </td>
      <td className="right mono strong" title={gpTitle}>
        {data.gpPerHour === null ? "—" : formatGp(Math.round(data.gpPerHour))}
      </td>
    </tr>
  );
}
