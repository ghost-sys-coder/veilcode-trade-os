import { afterEach, describe, expect, it, vi } from "vitest";
import { balanceCurveSchema, balanceCurveResultSchema, BalanceCurveCursorError } from "@/domain/reporting/balance-curve";
import { calendarDateStartUtc, canonicalUtcInstant } from "@/domain/journal/timezone";
import { buildPerformanceAnalytics } from "@/domain/reporting/performance";
import type { ReportingRows } from "@/domain/reporting/rows";
import { queryBalanceCurve } from "@/services/application/reporting";
import { ApplicationWorkflowError, type ApplicationContext } from "@/services/application/transaction";
const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/services/application/transaction", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/application/transaction")>(), applicationTransaction: transaction,
}));

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const stamp = "2026-10-08T12:00:00Z";
const context = { userId: id } as ApplicationContext;
function fixture(): ReportingRows {
  const nullable = Object.fromEntries(["account_balance_before", "planned_entry", "planned_stop_loss", "planned_take_profit", "planned_lot_size", "planned_risk_percentage", "planned_reward_amount", "planned_risk_reward", "actual_entry", "actual_stop_loss", "actual_exit", "actual_lot_size", "pips_result", "mfe_amount", "mfe_pips", "mfe_r", "mae_amount", "mae_pips", "mae_r"].map(key => [key, null]));
  return { timezone: "Africa/Kampala", accounts: [{ id, user_id: id, name: "USD Demo", account_type: "DEMO", currency_code: "USD", currency_precision: 2, starting_balance: "1000", started_at: "2026-10-01" }],
    instruments: [{ id, user_id: null, symbol: "EURUSD", display_name: "Euro Dollar" }], strategies: [], setups: [], tags: [], tradeTags: [], adjustments: [], reviews: [], execution: [], psychology: [], ruleReviews: [], ruleItems: [],
    trades: [{ ...nullable, id, user_id: id, account_id: id, instrument_id: id, strategy_id: null, setup_id: null, status: "CLOSED", outcome: "PARTIAL_WIN", direction: "BUY", session: "LONDON",
      opened_at: "2026-10-05T12:00:00Z", closed_at: stamp, planned_at: null, created_at: stamp, updated_at: stamp,
      net_pnl: "10.00", gross_pnl: "10.00", commission: "0", swap: "0", other_fees: "0", trading_credits: "0", actual_r: "0.1", planned_risk_amount: "100", holding_duration_seconds: 3600, thesis: null, entry_reason: null, confirmation_notes: null }],
  } as unknown as ReportingRows;
}
async function page(rows: ReportingRows, input: Record<string, unknown> = {}) {
  transaction.mockResolvedValue(rows);
  return queryBalanceCurve(context, { currencyCode: "USD", ...input });
}
afterEach(() => vi.resetAllMocks());

describe("bounded balance-curve contracts", () => {
  it.each([{ currencyCode: "usd" }, { currencyCode: "US" }, { pageSize: 0 }, { pageSize: 101 }, { pageSize: "10" }, { cursor: "" }, { cursor: "a=" }, { ownerId: id }, { filters: { strategy: id } }, { filters: { instrument: id } }, { filters: { from: "2026-02-30" } }, { filters: { from: "2026-10-09", to: "2026-10-01" } }, { timezone: "not/real" }])("rejects unsafe/ambiguous input %j", input => {
    expect(balanceCurveSchema.safeParse({ currencyCode: "USD", ...input }).success).toBe(false);
  });
  it("does not call a privileged workflow for invalid inputs", async () => {
    await expect(queryBalanceCurve(context, { currencyCode: "USD", ownerId: other })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("requires one owned currency instead of combining currencies", async () => {
    const rows = fixture(); rows.accounts.push({ ...rows.accounts[0], id: other, currency_code: "JPY", currency_precision: 0 });
    rows.trades.push({ ...rows.trades[0], id: other, account_id: other, net_pnl: "-1", outcome: "LOSS", actual_r: null });
    expect(await page(rows)).toMatchObject({ currencyCode: "USD", accountCount: 1, currentBalance: "1010.00", totalPoints: 2 });
    expect(await page(rows, { currencyCode: "JPY" })).toMatchObject({ currencyCode: "JPY", currencyPrecision: 0, currentBalance: "999" });
    await expect(page(rows, { currencyCode: "GBP" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("retains full-history balances/R across bounded pages with changing page size", async () => {
    const rows = fixture(); rows.trades = Array.from({ length: 130 }, (_, n) => ({ ...rows.trades[0], id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, net_pnl: "0.01", actual_r: n % 2 ? null : "0.0001" }));
    const points = []; let cursor: string | undefined; let snapshotId: string | undefined;
    do {
      const result = await page(rows, { pageSize: cursor ? 100 : 1, ...(cursor ? { cursor } : {}) });
      expect(result.points.length).toBeLessThanOrEqual(100); expect(result.currentBalance).toBe("1001.30");
      if (snapshotId) expect(result.snapshotId).toBe(snapshotId); snapshotId = result.snapshotId;
      points.push(...result.points); cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(points).toEqual(buildPerformanceAnalytics(rows).currencies[0].curve.points);
    expect(new Set(points.map(point => point.id)).size).toBe(131);
    expect(points.at(-1)).toMatchObject({ cumulativePnl: "1.30", cumulativeR: "0.00650000", cumulativeRSample: 65 });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it("is identical to shared browser curve including neutral withdrawal bridge", async () => {
    const rows = fixture(); rows.accounts[0].starting_balance = "110000";
    rows.trades[0] = { ...rows.trades[0], net_pnl: "-5000", outcome: "PARTIAL_LOSS", actual_r: "-50" };
    rows.adjustments.push({ id: other, user_id: id, account_id: id, type: "WITHDRAWAL", amount: "-10000", occurred_at: "2026-10-09T00:00:00Z", is_performance_neutral: true } as ReportingRows["adjustments"][number]);
    const result = await page(rows);
    expect(result.points).toEqual(buildPerformanceAnalytics(rows).currencies[0].curve.points);
    expect(result).toMatchObject({ currentBalance: "95000.00", drawdown: { currentAmount: "5000.00", maximumAmount: "5000.00" } });
    expect(result.points.at(-1)).toMatchObject({ cumulativePnl: "-5000.00", cumulativeR: "-50.00000000", cumulativeRSample: 1 });
  });
  it("excludes open/partial cash, not missing R as a fabricated zero sample", async () => {
    const rows = fixture(); rows.trades.push({ ...rows.trades[0], id: other, status: "OPEN", closed_at: null, net_pnl: null, outcome: null, actual_r: null });
    rows.trades[0].planned_risk_amount = null;
    const result = await page(rows);
    expect(result).toMatchObject({ totalPoints: 2, currentBalance: "1010.00" });
    expect(result.points.at(-1)).toMatchObject({ cumulativeR: null, cumulativeRSample: 0 });
  });
  it("keeps exact zero and small currency-specific normalized money", async () => {
    const rows = fixture(); rows.trades[0] = { ...rows.trades[0], net_pnl: "0.004", outcome: "BREAK_EVEN", actual_r: "0" };
    expect((await page(rows)).points.at(-1)).toMatchObject({ balance: "1000.00", cumulativePnl: "0.00", cumulativeRSample: 1 });
    rows.accounts[0].currency_precision = 3; rows.trades[0] = { ...rows.trades[0], net_pnl: "-0.001", outcome: "LOSS" };
    expect((await page(rows)).currentBalance).toBe("999.999");
  });
  it("normalizes each account's adjustment before same-currency accumulation", async () => {
    const rows = fixture(); rows.trades = [];
    rows.accounts.push({ ...rows.accounts[0], id: other, currency_precision: 3 });
    rows.adjustments = [
      { id, user_id: id, account_id: id, type: "DEPOSIT", amount: "0.004", occurred_at: stamp, is_performance_neutral: true },
      { id: other, user_id: id, account_id: other, type: "DEPOSIT", amount: "0.001", occurred_at: stamp, is_performance_neutral: true },
    ] as ReportingRows["adjustments"];
    expect(await page(rows)).toMatchObject({ currencyPrecision: 3, currentBalance: "2000.001" });
  });
  it("withholds only drawdown for ambiguous OTHER and all authoritative money for incomplete closures", async () => {
    const rows = fixture(); rows.adjustments.push({ id: other, user_id: id, account_id: id, type: "OTHER", amount: "1", occurred_at: stamp, is_performance_neutral: null } as ReportingRows["adjustments"][number]);
    const ambiguous = await page(rows);
    expect(ambiguous).toMatchObject({ balanceComplete: true, currentBalance: "1011.00", drawdown: { available: false, unclassifiedAdjustmentCount: 1, maximumAmount: null } });
    expect(ambiguous.points.every(point => point.drawdownAmount === null)).toBe(true);
    rows.trades.push({ ...rows.trades[0], id: other, closed_at: null, net_pnl: null, outcome: null });
    const incomplete = await page(rows);
    expect(incomplete).toMatchObject({ balanceComplete: false, currentBalance: null, openingBalance: null, incompleteClosedTrades: 1 });
    expect(incomplete.points.every(point => point.balance === null && point.cumulativePnl === null && point.drawdownAmount === null)).toBe(true);
  });
  it("treats explicitly performance-affecting OTHER as drawdown, never trading PnL", async () => {
    const rows = fixture(); rows.adjustments.push({ id: other, user_id: id, account_id: id, type: "OTHER", amount: "-25", occurred_at: "2026-10-09T00:00:00Z", is_performance_neutral: false } as ReportingRows["adjustments"][number]);
    const result = await page(rows);
    expect(result).toMatchObject({ currentBalance: "985.00", drawdown: { currentAmount: "25.00" } });
    expect(result.points.at(-1)?.cumulativePnl).toBe("10.00");
  });
  it("has a valid empty-trade starting point and no phantom future account funding", async () => {
    const rows = fixture(); rows.trades = [];
    rows.accounts.push({ ...rows.accounts[0], id: other, starting_balance: "100000", started_at: "2026-12-01" });
    const result = await page(rows, { filters: { to: "2026-10-08" } });
    expect(result).toMatchObject({ accountCount: 1, currentBalance: "1000.00", totalPoints: 1, nextCursor: null });
    await expect(page(rows, { filters: { account: other, to: "2026-10-08" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("uses the first timeline basis, not later capital, as a portfolio curve's opening balance", async () => {
    const rows = fixture(); rows.accounts.push({ ...rows.accounts[0], id: other, started_at: "2026-10-07" });
    const result = await page(rows);
    expect(result).toMatchObject({ openingBalance: "1000.00", currentBalance: "2010.00", accountCount: 2 });
    expect(result.points[1]).toMatchObject({ kind: "ADJUSTMENT", balance: "2000.00", drawdownAmount: "0.00" });
  });
});

describe("snapshot-aware continuation and fresh authorization", () => {
  it.each(["financial correction", "new trade", "baseline", "classification", "owner", "scope", "timezone"])("rejects changed %s rather than silently joining inconsistent pages", async change => {
    const rows = fixture(), first = await page(rows, { pageSize: 1 });
    const next: Record<string, unknown> = { pageSize: 1, cursor: first.nextCursor };
    if (change === "financial correction") rows.trades[0].net_pnl = "11";
    if (change === "new trade") rows.trades.push({ ...rows.trades[0], id: other });
    if (change === "baseline") rows.accounts[0].starting_balance = "1001";
    if (change === "classification") rows.adjustments.push({ id: other, user_id: id, account_id: id, type: "OTHER", amount: "-1", occurred_at: stamp, is_performance_neutral: false } as ReportingRows["adjustments"][number]);
    if (change === "owner") rows.accounts[0].user_id = other;
    if (change === "scope") next.filters = { account: id };
    if (change === "timezone") next.timezone = "UTC";
    await expect(page(rows, next)).rejects.toMatchObject({ code: "CURVE_CHANGED" });
    expect(transaction).toHaveBeenCalledTimes(2);
  });
  it("replays identical pages and remains stable across raw-row ordering and unrelated review changes", async () => {
    const rows = fixture(); rows.trades.push({ ...rows.trades[0], id: other });
    const first = await page(rows, { pageSize: 1 });
    const second = await page(rows, { pageSize: 1, cursor: first.nextCursor });
    rows.trades.reverse(); rows.trades[0].thesis = "Unrelated recorded text";
    expect(await page(rows, { pageSize: 1, cursor: first.nextCursor })).toEqual(second);
  });
  it("never returns a previous snapshot after revocation or an unavailable database", async () => {
    const first = await page(fixture(), { pageSize: 1 });
    transaction.mockRejectedValue(new ApplicationWorkflowError("ACCESS_DENIED"));
    await expect(queryBalanceCurve(context, { currencyCode: "USD", cursor: first.nextCursor })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    transaction.mockRejectedValue(new ApplicationWorkflowError("READ_UNAVAILABLE"));
    await expect(queryBalanceCurve(context, { currencyCode: "USD", cursor: first.nextCursor })).rejects.toMatchObject({ code: "READ_UNAVAILABLE" });
    expect(transaction).toHaveBeenCalledWith(context, "REPORTING_DATA", { accountId: undefined });
  });
  it("rejects malformed payloads, invented point IDs and unsupported cursor versions", async () => {
    const rows = fixture(), first = await page(rows, { pageSize: 1 });
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const cursor of ["e30", "bm90LWpzb24", encode({ version: 1, snapshotId: first.snapshotId, afterPointId: "nonexistent" }), encode({ version: 2, snapshotId: first.snapshotId, afterPointId: first.points[0].id })]) {
      await expect(page(rows, { cursor })).rejects.toBeInstanceOf(BalanceCurveCursorError);
      await expect(page(rows, { cursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    }
  });
  it("does not change a bounded snapshot for later out-of-period activity", async () => {
    const rows = fixture(), filters = { to: "2026-10-08" }, first = await page(rows, { filters, pageSize: 1 });
    rows.trades.push({ ...rows.trades[0], id: other, closed_at: "2026-10-10T00:00:00Z" });
    expect((await page(rows, { filters, cursor: first.nextCursor })).snapshotId).toBe(first.snapshotId);
  });
  it("validates bounded output schemas rather than accepting numeric money", async () => {
    const result = await page(fixture());
    expect(balanceCurveResultSchema.safeParse({ ...result, currentBalance: 1010 }).success).toBe(false);
    expect(balanceCurveResultSchema.safeParse({ ...result, points: Array(101).fill(result.points[0]) }).success).toBe(false);
  });
});

describe("civil dates and chronological curve evidence", () => {
  it.each([
    ["2026-10-09", "Africa/Kampala", "2026-10-08T21:00:00.000Z"],
    ["2026-03-08", "America/New_York", "2026-03-08T05:00:00.000Z"],
    ["2026-11-01", "America/New_York", "2026-11-01T04:00:00.000Z"],
    ["2026-10-09", "Pacific/Kiritimati", "2026-10-08T10:00:00.000Z"],
    ["2026-10-09", "Pacific/Honolulu", "2026-10-09T10:00:00.000Z"],
  ])("resolves %s midnight in %s", (date, timezone, expected) => expect(calendarDateStartUtc(date, timezone)).toBe(expected));
  it("refuses a skipped civil date", () => expect(() => calendarDateStartUtc("2011-12-30", "Pacific/Apia")).toThrow("does not exist"));
  it("preserves microseconds and orders UTC-equivalent offsets before tie-breaking", async () => {
    const rows = fixture(); rows.trades[0] = { ...rows.trades[0], closed_at: "2026-10-08T12:00:00.000001Z", net_pnl: "-5", outcome: "LOSS" };
    rows.trades.push({ ...rows.trades[0], id: other, closed_at: "2026-10-08T15:00:00.000000+03:00", net_pnl: "10", outcome: "WIN" });
    const result = await page(rows);
    expect(result.points.slice(1).map(point => point.id)).toEqual([`trade-${other}`, `trade-${id}`]);
    expect(result.drawdown.maximumAmount).toBe("5.00");
    expect(canonicalUtcInstant("2026-10-08T12:00:00.123456+00:00")).toBe("2026-10-08T12:00:00.123456000Z");
  });
  it("retains the pre-period high-water mark and puts the opening basis at local midnight", async () => {
    const rows = fixture(); rows.trades[0] = { ...rows.trades[0], net_pnl: "-5", outcome: "LOSS" };
    rows.trades.push({ ...rows.trades[0], id: other, closed_at: "2026-10-08T21:00:00Z", net_pnl: "2", outcome: "WIN" });
    const result = await page(rows, { filters: { from: "2026-10-09", to: "2026-10-09" }, pageSize: 1 });
    expect(result.points[0]).toMatchObject({ kind: "START", label: "Period opening basis", occurredAt: "2026-10-08T21:00:00.000000000Z", balance: "995.00", drawdownAmount: "5.00", cumulativeRSample: 1 });
    const second = await page(rows, { filters: { from: "2026-10-09", to: "2026-10-09" }, cursor: result.nextCursor });
    expect(second.points[0]).toMatchObject({ kind: "TRADE", balance: "997.00", drawdownAmount: "3.00", cumulativePnl: "-3.00", cumulativeRSample: 2 });
    expect(second.drawdown.maximumAmount).toBe("5.00");
  });
});
