import { describe, expect, it } from 'vitest';
import {
  actions4hForRate,
  actionsPerHour,
  capActionsPerHour,
  secondsPerAction,
} from '../src/domain/processTime.js';

describe('processing time helpers', () => {
  it('converts ticks at 0.6 seconds each', () => {
    expect(secondsPerAction(1)).toBeCloseTo(0.6);
    expect(secondsPerAction(5)).toBeCloseTo(3);
  });

  it('treats a zero-tick action as eight actions per tick', () => {
    expect(secondsPerAction(0)).toBeCloseTo(0.075);
  });

  it('returns null when ticks are unknown', () => {
    expect(secondsPerAction(null)).toBeNull();
    expect(secondsPerAction(Number.NaN)).toBeNull();
    expect(secondsPerAction(-1)).toBeNull();
  });

  it('converts seconds to an hourly rate', () => {
    expect(actionsPerHour(1.8)).toBeCloseTo(2000);
    expect(actionsPerHour(0.075)).toBeCloseTo(48_000);
    expect(actionsPerHour(null)).toBeNull();
  });

  it('caps a rate but never speeds a slow recipe up', () => {
    expect(capActionsPerHour(48_000, 3_000)).toBe(3_000);
    expect(capActionsPerHour(1_200, 3_000)).toBe(1_200);
    expect(capActionsPerHour(2_000, 0)).toBe(2_000);
    expect(capActionsPerHour(2_000, Number.NaN)).toBe(2_000);
    expect(capActionsPerHour(null, 3_000)).toBeNull();
  });

  it('floors the 4h action count', () => {
    expect(actions4hForRate(3_000)).toBe(12_000);
    expect(actions4hForRate(857.5)).toBe(3_430);
    expect(actions4hForRate(null)).toBeNull();
  });
});
