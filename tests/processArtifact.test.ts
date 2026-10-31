import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ProcessPayloadSchema, type ProcessRanking } from '../src/types.js';

/**
 * The UI casts `data/process.json` to `ProcessPayload`. This test is the guard
 * that the committed artifact still matches the schema, and that the arithmetic
 * inside it is internally consistent. It deliberately asserts no market prices:
 * a data snapshot is allowed to change, but the invariants are not.
 */
const payload = ProcessPayloadSchema.parse(
  JSON.parse(
    readFileSync(new URL('../data/process.json', import.meta.url), 'utf8'),
  ),
);

function checkRanking(ranking: ProcessRanking): void {
  expect(ranking.count).toBe(ranking.opportunities.length);

  for (const opportunity of ranking.opportunities) {
    expect(opportunity.inputs.length).toBeGreaterThan(0);
    expect(opportunity.output.quantity).toBeGreaterThan(0);
    expect(opportunity.profit).toBeGreaterThan(0);
    expect(opportunity.spend).toBe(opportunity.itemCost + opportunity.feeGp);
    expect(opportunity.netRevenue).toBe(
      opportunity.grossRevenue - opportunity.tax,
    );
    expect(opportunity.profit).toBe(
      opportunity.netRevenue - opportunity.spend,
    );
    expect(opportunity.actions4h).toBe(
      Math.min(
        opportunity.marketActions4h,
        opportunity.timeActions4h ?? opportunity.marketActions4h,
      ),
    );
    expect(opportunity.gpPer4h).toBe(
      opportunity.actions4h * opportunity.profit,
    );
    expect(opportunity.gpPerHour).toBe(
      opportunity.timeActions4h === null
        ? null
        : opportunity.gpPer4h / 4,
    );
    expect(opportunity.source).toMatch(/^https:\/\/oldschool\.runescape\.wiki\//);
  }
}

describe('data/process.json', () => {
  it('has one ranking per mode and a shared price timestamp', () => {
    expect(payload.pessimistic.mode).toBe('pessimistic');
    expect(payload.patient.mode).toBe('patient');
    expect(payload.pessimistic.pricesAsOf).toBe(payload.pricesAsOf);
    expect(payload.patient.pricesAsOf).toBe(payload.pricesAsOf);
  });

  it('keeps both modes on the same skill policy', () => {
    expect(payload.pessimistic.filters.skills).toEqual(
      payload.patient.filters.skills,
    );
  });

  it('was built without a player actions/hour cap', () => {
    expect(payload.pessimistic.filters.maxActionsPerHour).toBe(0);
    expect(payload.patient.filters.maxActionsPerHour).toBe(0);
  });

  it('keeps the per-action arithmetic consistent in both modes', () => {
    checkRanking(payload.pessimistic);
    checkRanking(payload.patient);
  });

  it('never reports an hourly rate without a published tick time', () => {
    for (const ranking of [payload.pessimistic, payload.patient]) {
      for (const opportunity of ranking.opportunities) {
        if (opportunity.gpPerHour === null) {
          expect(opportunity.timeActions4h).toBeNull();
        } else {
          expect(opportunity.timeActions4h).not.toBeNull();
        }
      }
    }
  });
});
