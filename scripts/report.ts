/**
 * Rank shop -> GE opportunities and print them.
 *
 *   pnpm report                       # top 25, pessimistic (instant sell at low)
 *   pnpm report --mode=patient        # list at high and wait
 *   pnpm report --limit=50 --members  # members only
 *   pnpm report --write               # also write data/opportunities.json
 *
 * Two sell modes, because shop -> GE is a *sell* operation:
 *   pessimistic = sell instantly at `low`  (guaranteed fill, worse price)
 *   patient     = list at `high`           (better price, may not fill)
 * See docs/shop-mechanics.md §8.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { rank, type RankOptions } from '../src/engine/rank.js';
import { readJsonFile } from '../src/util/json.js';
import {
  MarketSnapshotSchema,
  RankingSchema,
  ShopCatalogSchema,
  type Ranking,
  type SellMode,
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
    } else {
      throw new Error(`Unknown argument "${arg}". See docs or the header of this file.`);
    }
  }

  return cli;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  const catalog = await readJsonFile(SHOPS, ShopCatalogSchema);
  const market = await readJsonFile(MARKET, MarketSnapshotSchema);

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
    `prices as of ${formatTime(market.pricesAsOf)} | ${catalog.shopCount} shops | ${Object.keys(market.quotes).length} priced items\n`,
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
      `before the marginal unit stops being profitable. gp/4h capped by GE buy limit and 24h volume.\n`,
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

function formatGp(value: number): string {
  return value.toLocaleString('en-US');
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19);
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
