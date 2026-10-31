/**
 * Build `data/process.json` — deterministic item transformations that profit
 * when bought on the GE and sold back to the GE after processing.
 *
 *   pnpm process
 *   pnpm process --mode=patient --limit=50
 *   pnpm process --members --skill=herblore
 *   pnpm process --min-profit=100
 *   pnpm process --actions-per-hour=3000   # cap every recipe at 3000/h
 *
 * The artifact is written on every run (both modes, no filters) so the UI can
 * filter client-side. The flags only shape the table printed to the terminal.
 *
 * Sources:
 *   - recipes  https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe
 *   - prices   https://prices.runescape.wiki/api/v2/osrs/
 * Run `pnpm market` first if you want the price requests to share its cache.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { fetch24h, fetchLatest, fetchMapping } from '../src/api/prices.js';
import { fetchRecipes } from '../src/api/wikiRecipes.js';
import { rankProcess } from '../src/engine/processRank.js';
import { formatLocalTime } from '../src/util/time.js';
import {
  ProcessPayloadSchema,
  ProcessRankingSchema,
  type MarketQuote,
  type MarketSnapshot,
  type ProcessRanking,
  type SellMode,
} from '../src/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'process.json');

interface Cli {
  mode: SellMode;
  limit: number;
  members: boolean;
  minProfit: number;
  skills: string[];
  actionsPerHour: number;
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
    minProfit: 1,
    skills: [],
    actionsPerHour: 0,
  };

  for (const arg of argv) {
    if (arg === '--members') cli.members = true;
    else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value !== 'pessimistic' && value !== 'patient') {
        throw new Error(`--mode must be pessimistic or patient, got "${value}"`);
      }
      cli.mode = value;
    } else if (arg.startsWith('--limit=')) {
      cli.limit = Math.max(
        0,
        Math.floor(Number(arg.slice('--limit='.length)) || 0),
      );
    } else if (arg.startsWith('--min-profit=')) {
      cli.minProfit = nonNegativeNumber(
        arg.slice('--min-profit='.length),
        '--min-profit',
      );
    } else if (arg.startsWith('--skill=')) {
      cli.skills = arg
        .slice('--skill='.length)
        .split(',')
        .map((skill) => skill.trim().toLowerCase())
        .filter((skill) => skill !== '');
    } else if (arg.startsWith('--actions-per-hour=')) {
      cli.actionsPerHour = nonNegativeNumber(
        arg.slice('--actions-per-hour='.length),
        '--actions-per-hour',
      );
    } else {
      throw new Error(`Unknown argument "${arg}". See the header of this file.`);
    }
  }

  return cli;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  log('reading the wiki recipe bucket...');
  const recipes = await fetchRecipes();
  log(
    `  ${recipes.recipes.length.toLocaleString()} recipes from ${recipes.pages} pages` +
      ` (${recipes.skipped} malformed recipe rows skipped)`,
  );

  log('fetching item metadata and GE prices...');
  const mapping = await fetchMapping();
  const latest = await fetchLatest();
  const volume = await fetch24h();

  const metaByName = new Map(
    mapping.items.map((item) => [item.name.toLowerCase(), item]),
  );
  const metaById = new Map(mapping.items.map((item) => [item.id, item]));

  const wantedIds = new Set<number>();
  const unresolved = new Set<string>();

  for (const recipe of recipes.recipes) {
    for (const item of [...recipe.materials, recipe.output]) {
      if (item.name.toLowerCase() === 'coins') continue;
      const meta = metaByName.get(item.name.toLowerCase());
      if (meta === undefined) unresolved.add(item.name);
      else wantedIds.add(meta.id);
    }
  }

  log(
    `  ${wantedIds.size.toLocaleString()} priced items | ` +
      `${unresolved.size.toLocaleString()} recipe item names have no GE mapping`,
  );
  if (unresolved.size > 0) {
    const examples = [...unresolved].sort().slice(0, 8);
    log(`    e.g. ${examples.join(', ')}`);
    log(
      '    Unmapped names are usually untradeable quest/minigame items; their recipes are skipped, never priced with a guess.',
    );
  }

  const quotes: Record<string, MarketQuote> = {};
  for (const id of wantedIds) {
    const meta = metaById.get(id);
    if (meta === undefined) continue;
    const live = latest.data[String(id)];
    const daily = volume.data[String(id)];

    quotes[String(id)] = {
      id,
      name: meta.name,
      members: meta.members,
      // `value` and `stackable` are part of the shared quote schema but are not
      // consulted by the processing engine. Keep them honest: 0/null, not a
      // plausible-looking guess.
      value: meta.value ?? 0,
      stackable: null,
      limit: meta.limit ?? null,
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

  const market: MarketSnapshot = {
    generatedAt: new Date().toISOString(),
    pricesAsOf: new Date(latest.fetchedAt).toISOString(),
    itemCount: Object.keys(quotes).length,
    quotes,
  };

  // The artifact always carries every deterministic, fully priced recipe in
  // both modes. Filters, gold and sorting belong to the browser.
  const pessimistic = ProcessRankingSchema.parse(
    rankProcess(recipes.recipes, market, { mode: 'pessimistic' }),
  );
  const patient = ProcessRankingSchema.parse(
    rankProcess(recipes.recipes, market, { mode: 'patient' }),
  );

  const payload = ProcessPayloadSchema.parse({
    generatedAt: new Date().toISOString(),
    pricesAsOf: market.pricesAsOf,
    pessimistic,
    patient,
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const display = ProcessRankingSchema.parse(
    rankProcess(recipes.recipes, market, {
      mode: cli.mode,
      membersOnly: cli.members,
      ...(cli.skills.length > 0 ? { skills: cli.skills } : {}),
      minProfit: cli.minProfit,
      maxActionsPerHour: cli.actionsPerHour,
      limit: cli.limit,
    }),
  );

  printReport(cli, display, payload.pessimistic, payload.patient, market, {
    recipeCount: recipes.recipes.length,
    pages: recipes.pages,
    skipped: recipes.skipped,
    pricedItems: wantedIds.size,
    unresolved: unresolved.size,
  });
}

interface ReportStats {
  recipeCount: number;
  pages: number;
  skipped: number;
  pricedItems: number;
  unresolved: number;
}

function printReport(
  cli: Cli,
  display: ProcessRanking,
  pessimistic: ProcessRanking,
  patient: ProcessRanking,
  market: MarketSnapshot,
  stats: ReportStats,
): void {
  const direction =
    cli.mode === 'pessimistic'
      ? 'instant buy at GE high / instant sell at GE low'
      : 'patient buy at GE low / patient sell at GE high';

  log('');
  log(`ITEM PROCESSING — ${cli.mode.toUpperCase()} mode (${direction})`);
  log(
    `${stats.recipeCount.toLocaleString()} recipes from ${stats.pages} bucket pages ` +
      `(${stats.skipped} malformed) | ${stats.pricedItems.toLocaleString()} priced items ` +
      `| ${stats.unresolved.toLocaleString()} unmapped`,
  );
  log(
    `prices as of ${formatLocalTime(market.pricesAsOf)} | ` +
      `profitable: pessimistic ${pessimistic.count.toLocaleString()}, ` +
      `patient ${patient.count.toLocaleString()} | ` +
      `actions/hour cap: ${
        cli.actionsPerHour > 0 ? formatGp(cli.actionsPerHour) : 'recipe rate'
      }`,
  );
  log('='.repeat(186));
  log(
    pad('#', 3) +
      pad('Output', 32) +
      pad('Method', 22) +
      pad('Skill', 16) +
      pad('Ticks', 6) +
      pad('Cost', 14) +
      pad('Net sell', 14) +
      pad('Profit', 14) +
      pad('Actions', 9) +
      pad('Acts/hour', 12) +
      pad('Spend', 15) +
      pad('Profit/4h', 15) +
      pad('gp/hour', 14),
  );
  log('-'.repeat(186));

  if (display.opportunities.length === 0) {
    log('No profitable recipes match these filters.');
  }

  display.opportunities.forEach((opportunity, index) => {
    const skill = opportunity.skills[0];
    log(
      pad(String(index + 1), 3) +
        pad(truncate(opportunity.output.itemName, 31), 32) +
        pad(truncate(opportunity.method ?? '-', 21), 22) +
        pad(
          skill === undefined
            ? '-'
            : truncate(
                `${skill.name}${skill.level === null ? '' : ` ${skill.level}`}`,
                15,
              ),
          16,
        ) +
        pad(opportunity.ticks === null ? '?' : String(opportunity.ticks), 6) +
        pad(formatGp(opportunity.spend), 14) +
        pad(formatGp(opportunity.netRevenue), 14) +
        pad(formatGp(opportunity.profit), 14) +
        pad(opportunity.actions4h.toLocaleString(), 9) +
        pad(
          opportunity.timeActions4h === null
            ? '—'
            : formatGp(Math.round(opportunity.timeActions4h / 4)),
          12,
        ) +
        pad(formatGp(opportunity.actions4h * opportunity.spend), 15) +
        pad(formatGp(opportunity.actions4h * opportunity.profit), 15) +
        pad(
          opportunity.gpPerHour === null
            ? '—'
            : formatGp(Math.round(opportunity.gpPerHour)),
          14,
        ),
    );
  });

  log('-'.repeat(186));
  log(
    'Cost = one action\'s item inputs plus any Coin fee. Net sell = output value after\n' +
      'GE tax. Profit = both legs per action. Actions = the 4h window after the GE\n' +
      'buy limit / 24h volume and the recipe tick time. Acts/hour = the rate used\n' +
      'after your --actions-per-hour cap; Actions = the effective 4h plan.\n' +
      'gp/hour is — when the wiki does not publish ticks. Cooking and chance/average\n' +
      'recipes are excluded. Banking and travel to the facility are not modelled:\n' +
      'processing-only.',
  );

  log('');
  log(`wrote ${relative(OUT)} (both modes, ${pessimistic.count} + ${patient.count} rows)`);
}

function relative(absolute: string): string {
  return absolute.slice(ROOT.length + 1).replace(/\\/g, '/');
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatGp(value: number): string {
  return Math.trunc(value).toLocaleString('en-US');
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`refresh-process failed: ${String(error)}\n`);
  process.exitCode = 1;
});
