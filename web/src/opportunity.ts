/**
 * Join helpers between a ranked opportunity and the pure domain planners.
 *
 * The pure implementations live in `src/domain/earnings.ts` alongside the
 * gp-earning leaderboard, which needs exactly the same joins. This module keeps
 * the short names the shop pages and the basket panels already import.
 */

export {
  shopRowFromOpportunity as toShopRow,
  shopRowFromSink as toSinkShopRow,
} from "../../src/domain/earnings";
