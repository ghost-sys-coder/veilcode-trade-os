import { z } from "zod";
import { ACCOUNT_TYPES } from "@/types/domain";
import { decimalString, timezoneSchema } from "@/domain/reporting/rows";
import type { AnalyticsDataset } from "@/domain/reporting/performance";

const count = z.number().int().nonnegative();
const nullableDecimal = decimalString.nullable();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const balanceCurveFiltersSchema = z.object({
  account: z.string().uuid().optional(), accountType: z.enum(ACCOUNT_TYPES).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: "custom", path: ["to"], message: "End date must not precede start date." });
  }
});
export const balanceCurveSchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/), filters: balanceCurveFiltersSchema.default({}),
  timezone: timezoneSchema.optional(), pageSize: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
const cursorSchema = z.object({ version: z.literal(1), snapshotId: hash, afterPointId: z.string().min(1).max(256) }).strict();
const pointSchema = z.object({
  id: z.string(), occurredAt: z.iso.datetime(), kind: z.enum(["START", "TRADE", "ADJUSTMENT"]), label: z.string(),
  balance: nullableDecimal, cumulativePnl: nullableDecimal, cumulativeR: nullableDecimal, cumulativeRSample: count,
  drawdownAmount: nullableDecimal, drawdownPercentage: nullableDecimal,
}).strict();
const drawdownSchema = z.object({
  available: z.boolean(), unclassifiedAdjustmentCount: count, currentAmount: nullableDecimal,
  currentPercentage: nullableDecimal, maximumAmount: nullableDecimal, maximumPercentage: nullableDecimal, recoveryFactor: nullableDecimal,
}).strict();
const seriesSchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/), currencyPrecision: z.number().int().min(0).max(20),
  timezone: timezoneSchema, filters: balanceCurveFiltersSchema, accountCount: count,
  balanceComplete: z.boolean(), incompleteClosedTrades: count, unavailableReason: z.string().nullable(),
  openingBalance: nullableDecimal, currentBalance: nullableDecimal, drawdown: drawdownSchema,
  points: z.array(pointSchema),
}).strict();
export const balanceCurveResultSchema = seriesSchema.extend({
  points: z.array(pointSchema).max(100), totalPoints: count, snapshotId: hash, nextCursor: balanceCurveSchema.shape.cursor.unwrap().nullable(),
}).strict();

export class BalanceCurveCursorError extends Error {
  constructor(readonly code: "INVALID_CURSOR" | "CURVE_CHANGED") {
    super(code === "CURVE_CHANGED"
      ? "The balance curve or reporting scope changed. Restart without a cursor; do not combine these pages."
      : "Invalid balance-curve cursor. Use nextCursor unchanged, or restart without a cursor.");
    this.name = "BalanceCurveCursorError";
  }
}

/** Same authoritative builder as browser analytics; no second monetary algorithm. */
export function balanceCurveSeries(dataset: AnalyticsDataset, currencyCode: string) {
  const currency = dataset.currencies.find(value => value.currencyCode === currencyCode);
  if (!currency) return null;
  const { points, ...drawdown } = currency.curve;
  return seriesSchema.parse({
    currencyCode, currencyPrecision: currency.currencyPrecision, timezone: dataset.timezone, filters: dataset.filters,
    accountCount: currency.accountCount, balanceComplete: currency.balanceComplete,
    incompleteClosedTrades: currency.incompleteClosedTrades, unavailableReason: currency.unavailableReason,
    openingBalance: currency.balanceComplete ? points.at(0)?.balance ?? null : null,
    currentBalance: currency.balanceComplete ? currency.currentBalance : null, drawdown,
    points: points.map(point => ({ ...point, balance: currency.balanceComplete ? point.balance : null,
      cumulativePnl: currency.balanceComplete ? point.cumulativePnl : null })),
  });
}

/** Cursor is a continuation hint, never authorization or a stored server session.
 * The caller must obtain a fresh authorized snapshot before invoking this. */
export function pageBalanceCurve(series: NonNullable<ReturnType<typeof balanceCurveSeries>>,
  request: z.infer<typeof balanceCurveSchema>, snapshotId: string) {
  let start = 0;
  if (request.cursor) {
    let cursor: z.infer<typeof cursorSchema>;
    try {
      const bytes = Buffer.from(request.cursor, "base64url");
      if (bytes.toString("base64url") !== request.cursor) throw new Error("Non-canonical encoding");
      cursor = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    } catch { throw new BalanceCurveCursorError("INVALID_CURSOR"); }
    if (cursor.snapshotId !== snapshotId) throw new BalanceCurveCursorError("CURVE_CHANGED");
    const index = series.points.findIndex(point => point.id === cursor.afterPointId);
    if (index < 0) throw new BalanceCurveCursorError("INVALID_CURSOR");
    start = index + 1;
  }
  const points = series.points.slice(start, start + request.pageSize);
  const nextCursor = start + points.length < series.points.length
    ? Buffer.from(JSON.stringify({ version: 1, snapshotId, afterPointId: points.at(-1)!.id })).toString("base64url") : null;
  return balanceCurveResultSchema.parse({ ...series, points, totalPoints: series.points.length, snapshotId, nextCursor });
}
