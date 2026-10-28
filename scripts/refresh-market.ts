/**
 * Build `data/market.json` — GE price quotes for the items the shop catalogue
 * references.
 *
 *   pnpm market
 *
 * Only items that appear in `data/shops.json` are stored. Shipping all 4,674
 * items would triple the payload for no benefit: we can only price items the
 * catalogue can actually source.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { fetch24h, fetchLatest, fetchMapping } from '../src/api/prices.js';
import { fetchItemStackability } from '../src/api/wikiItems.js';
import { readJsonFile } from '../src/util/json.js';
import { MarketSnapshotSchema, ShopCatalogSchema, type MarketQuote } from '../src/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOPS = join(ROOT, 'data', 'shops.json');
const OUT = join(ROOT, 'data', 'market.json');

async function main(): Promise<void> {
  log('reading shop catalogue...');
  const catalog = await readJsonFile(SHOPS, ShopCatalogSchema);
  const wanted = new Set(
    catalog.entries
      .map((entry) => entry.itemId)
      .filter((id): id is number => id !== null),
  );
  log(`  ${wanted.size} distinct items to price`);

  log('fetching latest prices...');
  const latest = await fetchLatest();
  log('fetching 24h volume...');
  const volume = await fetch24h();
  log('fetching item metadata...');
  const mapping = await fetchMapping();

  const meta = new Map(mapping.items.map((item) => [item.id, item]));

  // Stackability is not in the prices API, so it comes from the item infobox on
  // the wiki. Only items the shop catalogue can actually source are needed.
  const wantedNames = [...wanted].flatMap((id) => {
    const item = meta.get(id);
    return item === undefined ? [] : [item.name];
  });
  log(`reading stackability for ${wantedNames.length} items from the wiki...`);
  const stackability = await fetchItemStackability(wantedNames);
  const nonStackable = [...stackability.stackable.values()].filter(
    (value) => value === false,
  ).length;
  log(
    `  ${stackability.stackable.size} pages in ${stackability.requests} requests; ` +
      `${nonStackable} non-stackable, ${stackability.unknown} unstated, ${stackability.missing} missing`,
  );

  const quotes: Record<string, MarketQuote> = {};
  let missingLatest = 0;

  for (const id of wanted) {
    const item = meta.get(id);
    if (item === undefined) continue;

    const live = latest.data[String(id)];
    const daily = volume.data[String(id)];

    // Keep the item even without a trade: the UI can show "no recent trades"
    // rather than silently dropping a legitimate shop.
    if (live === undefined) missingLatest += 1;

    quotes[String(id)] = {
      id,
      name: item.name,
      members: item.members,
      value: item.value ?? 0,
      stackable: stackability.stackable.get(item.name) ?? null,
      limit: item.limit ?? null,
      high: live?.high ?? null,
      low: live?.low ?? null,
      avgHighPrice24h: daily?.avgHighPrice ?? null,
      avgLowPrice24h: daily?.avgLowPrice ?? null,
      highVolume24h: daily?.highPriceVolume ?? 0,
      lowVolume24h: daily?.lowPriceVolume ?? 0,
      highTime: live?.highTime ?? null,
      lowTime: live?.lowTime ?? null,
    };
  }

  const snapshot = MarketSnapshotSchema.parse({
    generatedAt: new Date().toISOString(),
    pricesAsOf: new Date(latest.fetchedAt).toISOString(),
    itemCount: Object.keys(quotes).length,
    quotes,
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  const withBoth = Object.values(quotes).filter(
    (quote) => quote.high !== null && quote.low !== null,
  ).length;

  log('');
  log(`wrote ${relative(OUT)}`);
  log(`  priced items:        ${snapshot.itemCount}`);
  log(`  with high and low:   ${withBoth}`);
  log(`  no recent trade:     ${missingLatest}`);
  log(`  prices as of:        ${snapshot.pricesAsOf}`);
}

function relative(absolute: string): string {
  return absolute.slice(ROOT.length + 1).replace(/\\/g, '/');
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`refresh-market failed: ${String(error)}\n`);
  process.exitCode = 1;
});
