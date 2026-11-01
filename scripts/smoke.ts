/**
 * Connectivity smoke test for the prices API.
 *
 *   pnpm smoke
 *
 * Verifies the User-Agent is accepted and the payload shape matches our zod
 * schemas. Run this first when anything looks wrong.
 */

import { fetch24h, fetchLatest, fetchMapping } from '../src/api/prices.js';

async function main(): Promise<void> {
  const mapping = await fetchMapping();
  process.stdout.write(`mapping:  ${mapping.items.length} items\n`);

  const withLimit = mapping.items.filter((item) => item.limit !== null && item.limit !== undefined).length;
  const withValue = mapping.items.filter(
    (item) => item.value !== null && item.value > 0,
  ).length;
  process.stdout.write(`          ${withLimit} with a GE buy limit, ${withValue} with a value\n`);

  const latest = await fetchLatest();
  const latestCount = Object.keys(latest.data).length;
  process.stdout.write(`latest:   ${latestCount} quotes, sampled ${new Date(latest.fetchedAt).toISOString()}\n`);

  const sample = mapping.items.slice(0, 3);
  for (const item of sample) {
    const quote = latest.data[String(item.id)];
    process.stdout.write(
      `          ${item.name}: high=${quote?.high ?? '-'} low=${quote?.low ?? '-'} value=${item.value ?? '-'} limit=${item.limit ?? '-'}\n`,
    );
  }

  const daily = await fetch24h();
  process.stdout.write(`24h:      ${Object.keys(daily.data).length} volume entries\n`);
  process.stdout.write('\nOK\n');
}

main().catch((error: unknown) => {
  // Narrow at the boundary instead of stringifying an unknown: an Error keeps its
  // message, anything else is stringified deliberately.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`smoke test failed: ${message}\n`);
  process.exitCode = 1;
});
