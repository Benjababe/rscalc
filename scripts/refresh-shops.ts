/**
 * Build `data/shops.json` — the shop catalogue.
 *
 *   pnpm shops            # uses the 24h disk cache when warm
 *   pnpm shops --fresh    # ignore the cache
 *
 * Sources:
 *   - shop stock tables: Special:Bucket?bucket=storeline
 *   - item ids and base values: prices.runescape.wiki/api/v2/osrs/mapping
 *   - shop categories: the wiki's own page categories
 *
 * Rule from AGENTS.md: a field is either sourced or `null`. We never invent a
 * stock figure, because a fabricated one produces confident, wrong profit.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { fetchMapping, type MappingItem } from '../src/api/prices.js';
import {
  displayShopName,
  fetchShopTypes,
  fetchStoreLines,
  isInfiniteStock,
  parseIntCell,
  parseStockCell,
  type RawStoreLine,
} from '../src/api/storeBucket.js';
import { ShopCatalogSchema, type ShopEntry } from '../src/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'shops.json');

async function main(): Promise<void> {
  const started = Date.now();
  log('fetching shop stock tables...');
  const { lines, fetchedAt, pages } = await fetchStoreLines();
  log(`  ${lines.length} stock rows from ${new Set(lines.map((l) => l.shopPage)).size} shops (${pages} pages)`);

  log('fetching item metadata (mapping)...');
  const { items } = await fetchMapping();
  log(`  ${items.length} tradeable items`);

  const byName = new Map<string, MappingItem>();
  for (const item of items) byName.set(item.name.toLowerCase(), item);

  const shopTitles = [...new Set(lines.map((line) => line.shopPage))];
  log(`fetching categories for ${shopTitles.length} shops (batched)...`);
  const shopTypes = await fetchShopTypes(shopTitles);
  log(`  ${shopTypes.size} shops annotated`);

  const entries: ShopEntry[] = [];
  let unresolved = 0;

  for (const line of lines) {
    const match = byName.get(normaliseItemName(line.itemName).toLowerCase());
    if (match === undefined) unresolved += 1;

    entries.push({
      shopPage: line.shopPage,
      shopName: displayShopName(line.shopPage),
      soldBy: line.soldBy,
      itemName: line.itemName,
      itemId: match?.id ?? null,
      itemValue: match?.value ?? null,
      members: line.members,
      location: line.location,
      shopTypes: shopTypes.get(line.shopPage) ?? [],
      sellMultiplier: line.sellMultiplier,
      buyMultiplier: line.buyMultiplier,
      delta: line.delta,
      baseStock: parseStockCell(line.stockRaw),
      infiniteStock: isInfiniteStock(line.stockRaw),
      restockTicks: parseIntCell(line.restockRaw),
      storeSellPrice: line.storeSellPrice,
      storeBuyPrice: line.storeBuyPrice,
      currency: line.currency,
    });
  }

  const catalog = ShopCatalogSchema.parse({
    generatedAt: new Date(fetchedAt).toISOString(),
    source: 'https://oldschool.runescape.wiki/w/Special:Bucket?bucket=storeline',
    shopCount: shopTitles.length,
    entries,
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  const resolved = entries.filter((e) => e.itemId !== null).length;
  log('');
  log(`wrote ${relative(OUT)}`);
  log(`  shops:            ${catalog.shopCount}`);
  log(`  stock rows:       ${entries.length}`);
  log(`  resolved to GE:   ${resolved}`);
  log(`  unresolved names: ${unresolved} (kept, itemId=null)`);
  log(`  infinite stock:   ${entries.filter((e) => e.infiniteStock).length}`);
  log(`  non-Coins:        ${entries.filter((e) => e.currency.toLowerCase() !== 'coins').length}`);
  log(`  elapsed:          ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/**
 * Shop tables sometimes decorate names ("Air rune (pack)" vs the GE's
 * "Air rune pack"). Strip a trailing parenthetical qualifier only, which is the
 * one shape observed; anything else stays unresolved rather than guessed.
 */
function normaliseItemName(raw: string): string {
  return raw.replace(/\s*\((?:untrimmed|trimmed)\)\s*$/i, '').trim();
}

function relative(absolute: string): string {
  return absolute.slice(ROOT.length + 1).replace(/\\/g, '/');
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`refresh-shops failed: ${String(error)}\n`);
  process.exitCode = 1;
});

export type { RawStoreLine };
