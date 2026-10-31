/**
 * Rank shop -> GE opportunities and print them.
 *
 *   pnpm report                       # top 25, pessimistic (instant sell at low)
 *   pnpm report --mode=patient        # list at high and wait
 *   pnpm report --limit=50 --members  # members only
 *   pnpm report --write               # also write data/opportunities.json
 *   pnpm report --shop="Lundail's Arena-side Rune Shop" --gold=5000000
 *                                     # one shop's multi-item basket
 *
 * The basket flags are --shop, --gold, --hop and --speed. They print every
 * profitable item in that shop bought in the same visits, sharing world hops
 * and bank loads. The ranking filters (--limit, --members, --min-*, --write) do
 * not apply to a basket; --infinite does, matching the ranking default.
 *
 * Two sell modes, because shop -> GE is a *sell* operation:
 *   pessimistic = sell instantly at `low`  (guaranteed fill, worse price)
 *   patient     = list at `high`           (better price, may not fill)
 * See docs/shop-mechanics.md §8.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import {
  planPurchaseFast,
  planShopBasket,
  type ShopBasketItem,
} from '../src/domain/basket.js';
import {
  DEFAULT_HOP_SECONDS,
  DEFAULT_SECONDS_PER_TILE,
} from '../src/domain/budget.js';
import { netProceeds } from '../src/domain/tax.js';
import { targetSellPrice, volume24hForMode } from '../src/domain/profit.js';
import { INFINITE_STOCK_PURCHASE_CAP } from '../src/domain/shopPrice.js';
import { rank, toShopRow, type RankOptions } from '../src/engine/rank.js';
import { readJsonFile } from '../src/util/json.js';
import { formatLocalTime } from '../src/util/time.js';
import {
  MarketSnapshotSchema,
  RankingSchema,
  ShopCatalogSchema,
  type MarketSnapshot,
  type Ranking,
  type SellMode,
  type ShopCatalog,
  type ShopEntry,
} from '../src/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOPS = join(ROOT, 'data', 'shops.json');
const MARKET = join(ROOT, 'data', 'market.json');
const OUT = join(ROOT, 'data', 'opportunities.json');

interface Cli {
  mode: SellMode;
  limit: number;
  members: boolean;
  minVolume4h: number;
  minMargin: number;
  includeInfinite: boolean;
  write: boolean;
  shop: string | null;
  gold: number;
  hopSeconds: number;
  secondsPerTile: number;
}

function nonNegativeNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number, got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    mode: 'pessimistic',
    limit: 25,
    members: false,
    minVolume4h: 0,
    minMargin: 1,
    includeInfinite: false,
    write: false,
    shop: null,
    gold: 1_000_000,
    hopSeconds: DEFAULT_HOP_SECONDS,
    secondsPerTile: DEFAULT_SECONDS_PER_TILE,
  };

  for (const arg of argv) {
    if (arg === '--members') cli.members = true;
    else if (arg === '--write') cli.write = true;
    else if (arg === '--infinite') cli.includeInfinite = true;
    else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value !== 'pessimistic' && value !== 'patient') {
        throw new Error(`--mode must be pessimistic or patient, got "${value}"`);
      }
      cli.mode = value;
    } else if (arg.startsWith('--limit=')) cli.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--min-volume4h=')) {
      cli.minVolume4h = Number(arg.slice('--min-volume4h='.length));
    } else if (arg.startsWith('--min-margin=')) {
      cli.minMargin = Number(arg.slice('--min-margin='.length));
    } else if (arg.startsWith('--shop=')) {
      cli.shop = arg.slice('--shop='.length);
    } else if (arg.startsWith('--gold=')) {
      cli.gold = nonNegativeNumber(arg.slice('--gold='.length), '--gold');
    } else if (arg.startsWith('--hop=')) {
      cli.hopSeconds = nonNegativeNumber(arg.slice('--hop='.length), '--hop');
    } else if (arg.startsWith('--speed=')) {
      cli.secondsPerTile = nonNegativeNumber(arg.slice('--speed='.length), '--speed');
    } else {
      throw new Error(`Unknown argument "${arg}". See docs or the header of this file.`);
    }
  }

  if (cli.shop !== null && cli.shop.trim() === '') {
    throw new Error('--shop needs a shop name or wiki page title');
  }
  if (cli.shop !== null && cli.write) {
    throw new Error('--write writes both full rankings; it cannot be combined with --shop');
  }

  return cli;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  const catalog = await readJsonFile(SHOPS, ShopCatalogSchema);
  const market = await readJsonFile(MARKET, MarketSnapshotSchema);

  if (cli.shop !== null) {
    printShopBasket(catalog, market, cli);
    return;
  }

  const base: RankOptions = {
    mode: cli.mode,
    minVolume4h: cli.minVolume4h,
    minMargin: cli.minMargin,
    membersOnly: cli.members,
    includeInfiniteStock: cli.includeInfinite,
  };

  const ranking = rank(catalog, market, { ...base, limit: cli.limit });

  process.stdout.write(
    `\n${cli.mode.toUpperCase()} mode — selling at GE ${cli.mode === 'pessimistic' ? 'low (instant)' : 'high (patient)'}\n`,
  );
  process.stdout.write(
    `prices as of ${formatLocalTime(market.pricesAsOf)} | ${catalog.shopCount} shops | ${Object.keys(market.quotes).length} priced items\n`,
  );
  process.stdout.write(`${'='.repeat(132)}\n`);
  process.stdout.write(
    pad('#', 3) +
      pad('Item', 26) +
      pad('Shop', 24) +
      pad('Buy', 9) +
      pad('Sell', 9) +
      pad('Tax', 7) +
      pad('Margin', 8) +
      pad('Qty', 5) +
      pad('gp/4h', 12) +
      pad('Loc', 18) +
      '\n',
  );
  process.stdout.write(`${'-'.repeat(132)}\n`);

  if (ranking.opportunities.length === 0) {
    process.stdout.write('No profitable opportunities found with these filters.\n');
  }

  ranking.opportunities.forEach((opp, i) => {
    process.stdout.write(
      pad(String(i + 1), 3) +
        pad(truncate(opp.itemName, 25), 26) +
        pad(truncate(opp.shopName, 23), 24) +
        pad(formatGp(Math.round(opp.avgCost)), 9) +
        pad(formatGp(opp.sellPrice), 9) +
        pad(formatGp(opp.taxPerUnit), 7) +
        pad(formatGp(Math.round(opp.margin)), 8) +
        pad(String(opp.units), 5) +
        pad(formatGp(Math.round(opp.gpPer4h)), 12) +
        pad(truncate(opp.location ?? '-', 17), 18) +
        '\n',
    );
  });

  process.stdout.write(`${'-'.repeat(132)}\n`);
  process.stdout.write(
    `Buy = average cost/unit across the qty you'd take. Qty = units from ONE shop visit\n` +
      `before the marginal unit stops being profitable. gp/4h is one shop visit's sellable units, capped by 24h volume; the GE buy limit is metadata, not a sell cap.\n`,
  );

  if (cli.write) {
    const payload = {
      generatedAt: new Date().toISOString(),
      pessimistic: buildFull(catalog, market, base, 'pessimistic'),
      patient: buildFull(catalog, market, base, 'patient'),
    };
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    process.stdout.write(`\nwrote ${OUT.slice(ROOT.length + 1)} (both modes, ${payload.pessimistic.count} + ${payload.patient.count} rows)\n`);
  }
}

function buildFull(
  catalog: Parameters<typeof rank>[0],
  market: Parameters<typeof rank>[1],
  base: RankOptions,
  mode: SellMode,
): Ranking {
  return RankingSchema.parse(rank(catalog, market, { ...base, mode }));
}

interface BasketMeta {
  name: string;
  sellPrice: number;
  netSellPerUnit: number;
}

/** Resolve one exact shop page, refusing an ambiguous substring match. */
function resolveShop(
  catalog: ShopCatalog,
  query: string,
): { page: string; entries: ShopEntry[] } {
  const needle = query.trim().toLowerCase();
  const exact = catalog.entries.filter(
    (entry) =>
      entry.shopPage.toLowerCase() === needle ||
      entry.shopName.toLowerCase() === needle,
  );
  const matches =
    exact.length > 0
      ? exact
      : catalog.entries.filter(
          (entry) =>
            entry.shopPage.toLowerCase().includes(needle) ||
            entry.shopName.toLowerCase().includes(needle),
        );

  const pages = [...new Set(matches.map((entry) => entry.shopPage))];
  if (pages.length === 0) {
    throw new Error(`No shop matches "${query}".`);
  }
  if (pages.length > 1) {
    const list = pages
      .slice(0, 10)
      .map((page) => `  ${page}`)
      .join('\n');
    throw new Error(
      `"${query}" matches ${pages.length} shops:\n${list}${pages.length > 10 ? '\n  …' : ''}\nUse the exact wiki page title.`,
    );
  }

  const page = pages[0] as string;
  return {
    page,
    entries: catalog.entries.filter((entry) => entry.shopPage === page),
  };
}

/**
 * Print one shop's multi-item basket: every profitable item bought in the same
 * visits, with world hops and bank loads charged once for the basket.
 */
function printShopBasket(
  catalog: ShopCatalog,
  market: MarketSnapshot,
  cli: Cli,
): void {
  const { page, entries } = resolveShop(catalog, cli.shop ?? '');
  const shopName = entries[0]?.shopName ?? page;
  const location = entries.find((entry) => entry.location !== null)?.location ?? '—';
  const bankTiles = entries.find((entry) => entry.bankTiles !== null)?.bankTiles ?? null;
  const nearestBank = entries.find((entry) => entry.nearestBank !== null)?.nearestBank ?? null;
  const membersShop = entries.some((entry) => entry.members);
  const hasInfinite = entries.some((entry) => entry.infiniteStock);

  const items: ShopBasketItem[] = [];
  const meta = new Map<string, BasketMeta>();

  entries.forEach((entry, index) => {
    if (entry.infiniteStock && !cli.includeInfinite) return;
    if (entry.itemId === null) return;
    const row = toShopRow(entry);
    if (row === null) return;
    const quote = market.quotes[String(entry.itemId)];
    if (quote === undefined) return;

    const sellPrice = targetSellPrice(quote, cli.mode);
    if (sellPrice === null) return;
    const netSellPerUnit = netProceeds(sellPrice);
    const volume4h = Math.floor(volume24hForMode(quote, cli.mode) / 6);
    const cap = Math.max(0, volume4h);
    if (cap <= 0) return;

    const perWorldMax = row.infiniteStock
      ? INFINITE_STOCK_PURCHASE_CAP
      : row.baseStock;
    const full = planPurchaseFast(row, netSellPerUnit, {
      maxUnits: Math.min(cap, perWorldMax),
      minUnitProfit: 1,
    });
    if (full.units <= 0 || full.profit <= 0) return;

    const id = `${entry.itemId}:${index}`;
    items.push({
      id,
      name: entry.itemName,
      row,
      netSellPerUnit,
      maxUnits: cap,
      stackable: quote.stackable,
      members: quote.members || entry.members,
    });
    meta.set(id, {
      name: entry.itemName,
      sellPrice,
      netSellPerUnit,
    });
  });

  const plan = planShopBasket(items, cli.gold, {
    hopSeconds: cli.hopSeconds,
    bankTiles,
    secondsPerTile: cli.secondsPerTile,
  });

  let bankLine: string;
  if (bankTiles === null) {
    bankLine = `no bank distance on this shop's map${
      plan.nonStackableUnits === 0 ? ' (not needed: all purchased goods stack)' : ''
    }`;
  } else {
    bankLine = `${nearestBank ?? 'bank'} at ${bankTiles.toFixed(1)} tiles`;
  }

  process.stdout.write(`\nSHOP BASKET — ${shopName}\n`);
  process.stdout.write(
    `${location} • ${membersShop ? 'members shop' : 'free-to-play shop'} • bank: ${bankLine}\n`,
  );
  process.stdout.write(
    `${cli.mode.toUpperCase()} mode — selling at GE ${cli.mode === 'pessimistic' ? 'low (instant)' : 'high (patient)'} • ` +
      `gold ${formatGp(cli.gold)} gp • hop ${cli.hopSeconds}s • travel ${cli.secondsPerTile}s/tile\n`,
  );
  process.stdout.write(`${'='.repeat(112)}\n`);

  if (items.length === 0) {
    process.stdout.write(
      'No profitable items in this shop for this mode and item set.\n' +
        (hasInfinite && !cli.includeInfinite
          ? 'Infinite-stock items are omitted unless --infinite is passed.\n'
          : ''),
    );
    return;
  }

  process.stdout.write(
    pad('Item', 28) +
      pad('Buy', 9) +
      pad('Avg cost', 10) +
      pad('Sell', 8) +
      pad('Net', 8) +
      pad('Spend', 12) +
      pad('Profit', 12) +
      pad('/world', 8) +
      pad('Slots', 7) +
      pad('Cap', 9) +
      '\n',
  );
  process.stdout.write(`${'-'.repeat(112)}\n`);

  for (const item of plan.items) {
    if (item.units <= 0 && item.unitsPerWorld <= 0) continue;
    const details = meta.get(item.id);
    const slotLabel = stackabilityLabel(item.stackable);
    process.stdout.write(
      pad(truncate(details?.name ?? item.id, 27), 28) +
        pad(item.units.toLocaleString('en-US'), 9) +
        pad(formatGp(Math.round(item.avgCost)), 10) +
        pad(formatGp(details?.sellPrice ?? 0), 8) +
        pad(formatGp(details?.netSellPerUnit ?? 0), 8) +
        pad(formatGp(item.totalCost), 12) +
        pad(formatGp(item.profit), 12) +
        pad(String(item.unitsPerWorld), 8) +
        pad(slotLabel, 7) +
        pad(item.cap === null ? '—' : formatGp(item.cap), 9) +
        '\n',
    );
  }

  process.stdout.write(`${'-'.repeat(112)}\n`);
  process.stdout.write(
    `Totals: ${plan.units.toLocaleString('en-US')} units • spend ${formatGp(plan.totalCost)} gp • ` +
      `leftover ${formatGp(plan.leftover)} gp • profit ${formatGp(plan.profit)} gp\n`,
  );
  let bankTripDetail = '';
  if (plan.bankTrips > 0) {
    bankTripDetail = plan.bankTimeKnown
      ? ` (${formatDuration(plan.bankSecondsTotal)} total, ${formatDuration(plan.bankSecondsPerTrip)} each)`
      : ' (bank distance unknown)';
  }

  process.stdout.write(
    `Worlds: ${plan.worlds} (${formatDuration(plan.hopSecondsTotal)} hopping) • ` +
      `bank trips: ${plan.bankTrips}${bankTripDetail}` +
      ` • sell time: ${formatDuration(plan.sellSeconds)} across ${plan.offerSlots} GE slot${plan.offerSlots === 1 ? '' : 's'}\n`,
  );
  process.stdout.write(
    `Time: ${formatDuration(plan.timeSeconds)} • gp/hour: ${
      plan.gpPerHour === null
        ? '— (bank distance unknown for the non-stackable part)'
        : formatGp(Math.round(plan.gpPerHour))
    }\n`,
  );

  const notes: string[] = [];
  if (plan.budgetLimited) notes.push('budget limited');
  if (plan.worldLimited) notes.push('world limit reached');
  if (plan.marginLimited) notes.push('one or more items hit the margin floor');
  if (plan.stackableSlots > 0) {
    const typeWord = plan.stackableSlots === 1 ? 'type' : 'types';
    if (plan.nonStackableUnits > 0) {
      const verb = plan.stackableSlots === 1 ? 'reserves' : 'reserve';
      const object = plan.stackableSlots === 1 ? 'a slot' : 'slots';
      notes.push(
        `${plan.stackableSlots} stackable item ${typeWord} ${verb} ${object}, ` +
          `${plan.unitsPerLoad} non-stackable units per load`,
      );
    } else {
      notes.push(
        `${plan.stackableSlots} stackable item ${typeWord}, no bank trips needed`,
      );
    }
  }
  if (hasInfinite && !cli.includeInfinite) notes.push('infinite-stock items omitted (--infinite)');
  if (notes.length > 0) process.stdout.write(`Notes: ${notes.join(' • ')}\n`);

  process.stdout.write(
    '\nThe basket shares world hops and bank loads across every item. ' +
      'Allocation takes the next marginal unit with the best profit per coin;\n' +
      'a budget that covers a full world buys every profitable unit in it. ' +
      'Sell time assumes concurrent GE offers and no travel to the shop.\n',
  );
}

function stackabilityLabel(stackable: boolean | null): string {
  if (stackable === true) return 'stack';
  if (stackable === false) return 'loose';
  return '?';
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
}

function formatGp(value: number): string {
  return value.toLocaleString('en-US');
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

main().catch((error: unknown) => {
  process.stderr.write(`report failed: ${String(error)}\n`);
  process.exitCode = 1;
});
