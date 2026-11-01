/**
 * Build `data/skilling.json` — the per-skill activity list behind `#/skilling`.
 *
 *   pnpm skilling
 *   pnpm skilling --skill=crafting
 *   pnpm skilling --actions-per-hour=1200
 *
 * One scanned skill at a time. `SKILLING_SKILLS` in `src/engine/skilling.ts` is
 * the queue; `docs/skilling-plan.md` is the method and the order.
 *
 * Unlike `refresh-process.ts` this keeps the loss-making rows: training a skill
 * costs gp, and the page is explicit about it. Rows with no published tick count
 * keep `gpPerHour = null` — the page shows `—` rather than inventing a rate.
 *
 * Sources:
 *   - recipes  https://oldschool.runescape.wiki/w/Special:Bucket?bucket=recipe
 *   - prices   https://prices.runescape.wiki/api/v2/osrs/
 * Run `pnpm process` first and both commands share the cached price responses.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { fetch24h, fetchLatest, fetchMapping } from '../src/api/prices.js';
import { fetchGatheringNodes } from '../src/api/wikiGathering.js';
import type { GatheringNode } from '../src/api/wikiGathering.js';
import { fetchRecipes } from '../src/api/wikiRecipes.js';
import { toBurnIndex } from '../src/domain/cooking.js';
import {
  COOKING_BURN_SOURCE,
  COOKING_NO_BURN_LEVELS,
} from './cookingBurnLevels.js';
import { GATHERING_NODE_SOURCES } from './gatheringNodes.js';
import { SKILL_UPGRADES, upgradeKeys } from './skillUpgrades.js';
import { SKILLING_SKILLS, rankSkillActivities } from '../src/engine/skilling.js';
import type { SkillingSkill } from '../src/engine/skilling.js';
import { formatLocalTime } from '../src/util/time.js';
import {
  SkillingPayloadSchema,
  type MarketQuote,
  type MarketSnapshot,
  type SkillActivity,
  type SkillActivityCatalog,
  type SellMode,
} from '../src/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'skilling.json');

interface Cli {
  skills: SkillingSkill[];
  actionsPerHour: number;
  limit: number;
  /** Player's Cooking level; 0 means "not given", so no rows are gated out. */
  cookingLevel: number;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
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
    skills: [...SKILLING_SKILLS],
    actionsPerHour: 0,
    limit: 12,
    cookingLevel: 0,
  };

  for (const arg of argv) {
    if (arg.startsWith('--skill=')) {
      const wanted = arg
        .slice('--skill='.length)
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value !== '');
      const known = SKILLING_SKILLS.filter((skill) =>
        wanted.includes(skill.toLowerCase()),
      );
      if (known.length === 0) {
        throw new Error(
          `--skill must name a scanned skill (${SKILLING_SKILLS.join(', ')}), got "${arg}"`,
        );
      }
      cli.skills = known;
    } else if (arg.startsWith('--actions-per-hour=')) {
      cli.actionsPerHour = nonNegativeNumber(
        arg.slice('--actions-per-hour='.length),
        '--actions-per-hour',
      );
    } else if (arg.startsWith('--cooking-level=')) {
      cli.cookingLevel = Math.floor(
        nonNegativeNumber(
          arg.slice('--cooking-level='.length),
          '--cooking-level',
        ),
      );
    } else if (arg.startsWith('--limit=')) {
      cli.limit = Math.max(
        1,
        Math.floor(
          nonNegativeNumber(arg.slice('--limit='.length), '--limit'),
        ),
      );
    } else {
      throw new Error(`unknown flag "${arg}"`);
    }
  }

  return cli;
}

/** Every item any scanned recipe touches, so the price fetch stays minimal. */
function wantedItemIds(
  recipes: readonly { materials: { name: string }[]; output: { name: string } }[],
  metaByName: Map<string, { id: number }>,
): Set<number> {
  const ids = new Set<number>();
  for (const recipe of recipes) {
    for (const item of [...recipe.materials, recipe.output]) {
      if (item.name.toLowerCase() === 'coins') continue;
      const meta = metaByName.get(item.name.toLowerCase());
      if (meta !== undefined) ids.add(meta.id);
    }
  }
  return ids;
}

/** One activity as a terminal line: gp/action, gp/hour, then its inputs. */
function formatActivity(row: SkillActivity): string {
  const perHour =
    row.gpPerHour === null
      ? '—'
      : `${Math.round(row.gpPerHour).toLocaleString()}/h`;
  const inputs =
    row.inputs.map((item) => `${item.itemName} x${item.quantity}`).join(' + ') ||
    'nothing';
  const fee = row.feeGp > 0 ? ` + ${row.feeGp} gp fee` : '';
  // A train row has no priced output: name what is being built and say so.
  const output =
    row.output === null
      ? `${row.outputName} (built, not sold)`
      : `${row.output.itemName} x${row.output.quantity}`;
  return (
    `${String(row.profit).padStart(9)} gp  ${perHour.padStart(12)}  ` +
    `${output.padEnd(32)} from ${inputs}${fee}`
  );
}

function printTable(
  catalog: SkillActivityCatalog,
  mode: SellMode,
  limit: number,
): void {
  const ranking = mode === 'pessimistic' ? catalog.pessimistic : catalog.patient;
  const { coverage } = catalog;
  log(
    `\n${catalog.skill} — ${coverage.activities} activities priced ` +
      `(${coverage.profitable} profitable, ${coverage.lossMaking} loss-making, ` +
      `${coverage.trainOnly} cost-only, ${coverage.upgrades} upgrades, ` +
      `${coverage.unpriced} of ${coverage.recipes + coverage.nodes} candidates ` +
      `unpriced${coverage.gathered > 0 ? `, ${coverage.gathered} gathered` : ''})`,
  );

  for (const row of ranking.opportunities.slice(0, limit)) log(`  ${formatActivity(row)}`);

  // Worst is by profit, not by the ranking's tail: the ranking is ordered by
  // gp/hour, so its last row is a slow earner, not the biggest loss.
  const worst = ranking.opportunities
    .filter((row) => row.profit < 0)
    .sort((a, b) => a.profit - b.profit)
    .slice(0, 5);
  if (worst.length > 0) {
    log('  biggest losses per action:');
    for (const row of worst) log(`  ${formatActivity(row)}`);
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  log('fetching recipe bucket...');
  const recipes = await fetchRecipes();
  log(
    `  ${recipes.recipes.length.toLocaleString()} recipes from ${recipes.pages} pages` +
      ` (${recipes.skipped} malformed rows skipped)`,
  );

  log('fetching item metadata and GE prices...');
  const mapping = await fetchMapping();
  const latest = await fetchLatest();
  const volume = await fetch24h();

  const metaByName = new Map(
    mapping.items.map((item) => [item.name.toLowerCase(), item]),
  );
  const metaById = new Map(mapping.items.map((item) => [item.id, item]));

  const scanned = recipes.recipes.filter((recipe) =>
    cli.skills.some((skill) =>
      recipe.skills.some(
        (entry) => entry.name.toLowerCase() === skill.toLowerCase(),
      ),
    ),
  );
  const wanted = wantedItemIds(scanned, metaByName);

  const quotes: Record<string, MarketQuote> = {};
  for (const id of wanted) {
    const meta = metaById.get(id);
    if (meta === undefined) continue;
    const live = latest.data[String(id)];
    const daily = volume.data[String(id)];

    quotes[String(id)] = {
      id,
      name: meta.name,
      members: meta.members,
      // Not consulted by the skilling engine; 0/null rather than a guess.
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
  log(`  ${market.itemCount.toLocaleString()} priced items | ${market.pricesAsOf}`);

  // Gathering rates are per item page, so one batch covers every scanned skill
  // that has a curated node list.
  const nodePages = cli.skills.flatMap(
    (skill) => GATHERING_NODE_SOURCES[skill] ?? [],
  );
  let gatheringNodes: GatheringNode[] = [];
  if (nodePages.length > 0) {
    log('fetching gathering node data...');
    const gathered = await fetchGatheringNodes(
      nodePages.map((page) => page.item),
    );
    gatheringNodes = gathered.nodes;
    log(
      `  ${gathered.nodes.length}/${gathered.requested} nodes have a published ` +
        `respawn time (${gathered.missing} page(s) missing, ` +
        `${gathered.unreadable} with no Mining/Woodcutting info block)`,
    );
  }

  const upgradeKeySet = upgradeKeys(SKILL_UPGRADES);
  log(
    `  ${upgradeKeySet.size} curated upgrade recipes move out of the transform ` +
      'ranking (scripts/skillUpgrades.ts)',
  );
  const burnLevels = toBurnIndex(COOKING_NO_BURN_LEVELS);
  log(
    `  ${burnLevels.size} Cooking foods have a published no-burn level ` +
      `(${COOKING_BURN_SOURCE})`,
  );

  // The artifact always carries every scanned skill: filters are for the
  // terminal. Writing only the flags' subset would silently truncate the file the
  // UI reads — `--skill=cooking` once produced a one-skill artifact.
  const skills: SkillActivityCatalog[] = [...SKILLING_SKILLS].map((skill) => {
    // The artifact keeps every priced row, including Cooking foods the player
    // cannot yet cook without burning: each carries its `noBurnLevel`, so the
    // page can gate on the level the player enters. `--cooking-level` therefore
    // shapes the terminal table only.
    const pessimistic = rankSkillActivities(recipes.recipes, market, {
      skill,
      mode: 'pessimistic',
      maxActionsPerHour: cli.actionsPerHour,
      burnLevels: burnLevels,
      upgradeKeys: upgradeKeySet,
      gatheringNodes: gatheringNodes.filter((node) => node.skill === skill),
      cookingLevel: cli.cookingLevel > 0 ? cli.cookingLevel : undefined,
    });
    const patient = rankSkillActivities(recipes.recipes, market, {
      skill,
      mode: 'patient',
      maxActionsPerHour: cli.actionsPerHour,
      burnLevels: burnLevels,
      upgradeKeys: upgradeKeySet,
      gatheringNodes: gatheringNodes.filter((node) => node.skill === skill),
      cookingLevel: cli.cookingLevel > 0 ? cli.cookingLevel : undefined,
    });
    // Both modes price the same action set; take the pessimistic coverage so the
    // two pages cannot disagree about how much of the skill is covered.
    return {
      skill,
      coverage: pessimistic.coverage,
      pessimistic: pessimistic.ranking,
      patient: patient.ranking,
    };
  });

  const payload = SkillingPayloadSchema.parse({
    generatedAt: new Date().toISOString(),
    pricesAsOf: market.pricesAsOf,
    skills,
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  log(
    `\nwrote data/skilling.json — ${skills.length} skill(s), ` +
      `${skills.reduce((sum, entry) => sum + entry.coverage.activities, 0)} activities`,
  );
  // Drift check: a curated upgrade key that matched nothing is stale (the bucket
  // moved the recipe, or the item was renamed). Say so instead of silently
  // classifying nothing.
  const matched = new Set<string>();
  for (const catalog of skills) {
    for (const row of catalog.pessimistic.opportunities) {
      if (row.kind === 'upgrade') {
        matched.add(`${catalog.skill}|${row.outputName}`.toLowerCase());
      }
    }
  }
  const stale = [...upgradeKeySet].filter((key) => !matched.has(key));
  if (stale.length > 0) {
    log(
      `
${stale.length} curated upgrade key(s) matched no recipe: ` +
        `${stale.join(', ')} — check scripts/skillUpgrades.ts against the bucket.`,
    );
  }

  const shown = new Set<string>(cli.skills);
  for (const catalog of skills) {
    if (shown.has(catalog.skill)) printTable(catalog, 'pessimistic', cli.limit);
  }

  const unpriced = skills.reduce((sum, entry) => sum + entry.coverage.unpriced, 0);
  if (unpriced > 0) {
    log(
      `\n${unpriced} recipe rows could not be priced: a leg has no GE price or no ` +
        '4h liquidity, a quantity is not a whole number, or the wiki flags the ' +
        'quantity as a chance/average. They are counted, never estimated.',
    );
  }
  if (cli.actionsPerHour > 0) {
    log(`Actions/hour capped at ${cli.actionsPerHour} — this can only slow a recipe.`);
  }
  log(`prices as of ${formatLocalTime(payload.pricesAsOf)}`);
}

await main();
