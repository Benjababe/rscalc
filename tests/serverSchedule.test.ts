/// <reference types="node" />
/**
 * The refresh schedule ticks on wall-clock marks, not "one interval after the
 * last run finished". This pins the pure helper the scheduler uses: a 4-hour
 * interval must land on 00:00, 04:00, 08:00, ... in the server's timezone, and it
 * must never return the current mark (which would fire twice) or a past time.
 *
 * Times are built with the local `Date` constructor, so the expectations hold in
 * any `TZ` the test runner happens to use.
 */

import { describe, expect, it } from "vitest";

import { nextAlignedRun } from "../src/server/refresh.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const FOUR_HOURS = 4 * HOUR;

/** A local wall-clock instant, month is 1-based for readability. */
function at(day: number, hour: number, minute = 0, second = 0, ms = 0): number {
  return new Date(2026, 0, day, hour, minute, second, ms).getTime();
}

function wall(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(
    date.getMilliseconds(),
  ).padStart(3, "0")}`;
}

describe("nextAlignedRun", () => {
  it("lands on the next 4-hour mark, not four hours from now", () => {
    expect(wall(nextAlignedRun(at(15, 0, 0, 0), FOUR_HOURS))).toBe("15 04:00:00.000");
    expect(wall(nextAlignedRun(at(15, 3, 59), FOUR_HOURS))).toBe("15 04:00:00.000");
    expect(wall(nextAlignedRun(at(15, 4, 0), FOUR_HOURS))).toBe("15 08:00:00.000");
    expect(wall(nextAlignedRun(at(15, 4, 0, 0, 1), FOUR_HOURS))).toBe("15 08:00:00.000");
    expect(wall(nextAlignedRun(at(15, 6, 7, 8, 9), FOUR_HOURS))).toBe("15 08:00:00.000");
    expect(wall(nextAlignedRun(at(15, 20, 0), FOUR_HOURS))).toBe("16 00:00:00.000");
    expect(wall(nextAlignedRun(at(15, 23, 59, 59, 999), FOUR_HOURS))).toBe("16 00:00:00.000");
  });

  it("is never the current instant or the past", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = at(15, hour);
      const next = nextAlignedRun(now, FOUR_HOURS);
      expect(next).toBeGreaterThan(now);
      expect(next - now).toBeLessThanOrEqual(FOUR_HOURS);
    }
  });

  it("aligns every interval to midnight, so 30m gives :00 and :30", () => {
    expect(wall(nextAlignedRun(at(15, 10, 7), 30 * MINUTE))).toBe("15 10:30:00.000");
    expect(wall(nextAlignedRun(at(15, 10, 30), 30 * MINUTE))).toBe("15 11:00:00.000");
    expect(wall(nextAlignedRun(at(15, 23, 45), 30 * MINUTE))).toBe("16 00:00:00.000");
    expect(wall(nextAlignedRun(at(15, 10, 7), HOUR))).toBe("15 11:00:00.000");
  });

  it("runs once a day on a 1d interval, at local midnight", () => {
    expect(wall(nextAlignedRun(at(15, 9), 24 * HOUR))).toBe("16 00:00:00.000");
    // Two days: midnight still the zero point, so the mark two days out.
    expect(wall(nextAlignedRun(at(15, 9), 2 * 24 * HOUR))).toBe("17 00:00:00.000");
  });

  it("keeps midnight as the zero point even when an interval does not divide a day", () => {
    // 21:00 is the 4th 5-hour slot, so the 5th runs past midnight.
    expect(wall(nextAlignedRun(at(15, 21), 5 * HOUR))).toBe("16 01:00:00.000");
    expect(wall(nextAlignedRun(at(15, 9), 5 * HOUR))).toBe("15 10:00:00.000");
  });

  it("refuses an interval that cannot schedule anything", () => {
    const now = at(15, 12);
    expect(() => nextAlignedRun(now, 0)).toThrow(/positive/);
    expect(() => nextAlignedRun(now, -1)).toThrow(/positive/);
    expect(() => nextAlignedRun(now, Number.NaN)).toThrow(/positive/);
  });
});
