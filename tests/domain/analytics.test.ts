import { describe, expect, it } from "vitest";

import {
  actualRBucketDimension,
  buildAccountCurve,
  calculateAccountReturn,
  calculatePerformanceMetrics,
  entryHourDimension,
  groupPerformance,
  holdingDurationDimension,
  plannedRiskRewardBucketDimension,
  realizedMonthDimension,
  realizedWeekdayDimension,
  riskBucketDimension,
  type AnalyticsAccount,
  type AnalyticsTrade,
} from "@/domain/analytics/performance";

const account: AnalyticsAccount = {
  id: "account-1",
  name: "Primary",
  accountType: "PERSONAL_LIVE",
  currencyCode: "USD",
  currencyPrecision: 2,
  startingBalance: "1000",
  startedAt: "2026-09-01T00:00:00Z",
};

function trade(overrides: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  return {
    id: "trade-1",
    accountId: account.id,
    accountName: account.name,
    accountType: account.accountType,
    currencyCode: account.currencyCode,
    currencyPrecision: account.currencyPrecision,
    status: "CLOSED",
    openedAt: "2026-09-02T08:00:00Z",
    closedAt: "2026-09-02T10:00:00Z",
    outcome: "WIN",
    netPnl: "100",
    grossPnl: "106",
    commission: "3",
    swap: "2",
    otherFees: "1",
    actualR: "1",
    plannedRiskPercentage: "0.5",
    plannedRiskReward: "2",
    actualLotSize: "1",
    holdingDurationSeconds: 7_200,
    instrumentId: "eurusd",
    instrument: "EURUSD",
    strategyId: "strategy-1",
    strategy: "Breakout",
    setupId: "setup-1",
    setup: "Retest",
    session: "LONDON",
    direction: "BUY",
    ruleCompliance: "FULLY_COMPLIANT",
    ruleViolations: 0,
    ...overrides,
  };
}

describe("Phase 04 performance metrics", () => {
  it("returns explicit empty-sample states", () => {
    const metrics = calculatePerformanceMetrics([], 2);
    expect(metrics).toMatchObject({
      totalTrades: 0,
      closedTrades: 0,
      winRate: null,
      breakEvenRate: null,
      netProfit: "0.00",
      currencyExpectancy: null,
      rExpectancy: null,
      rSample: 0,
      profitFactor: { state: "UNDEFINED", value: null },
    });
  });

  it("excludes open trades from every realized metric", () => {
    const metrics = calculatePerformanceMetrics([
      trade(),
      trade({ id: "open", status: "OPEN", closedAt: null, outcome: null, netPnl: null, actualR: null }),
    ], 2);
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.closedTrades).toBe(1);
    expect(metrics.netProfit).toBe("100.00");
    expect(metrics.rSample).toBe(1);
  });

  it("uses decisive trades for win rate and all closed trades for break-even rate", () => {
    const metrics = calculatePerformanceMetrics([
      trade({ id: "win", outcome: "PARTIAL_WIN", netPnl: "20" }),
      trade({ id: "loss", outcome: "PARTIAL_LOSS", netPnl: "-10", actualR: "-0.5" }),
      trade({ id: "be", outcome: "BREAK_EVEN", netPnl: "0", actualR: "0" }),
    ], 2);
    expect(metrics.winRate).toBe("50.00");
    expect(metrics.winRateSample).toBe(2);
    expect(metrics.breakEvenRate).toBe("33.33");
  });

  it("calculates profit, loss, fees, expectancy, and extremes with decimals", () => {
    const metrics = calculatePerformanceMetrics([
      trade({ id: "a", netPnl: "100.10", commission: "0.10", swap: "0.20", otherFees: "0.30" }),
      trade({ id: "b", outcome: "LOSS", netPnl: "-40.05", actualR: "-0.4", commission: "0.20", swap: "0", otherFees: "0.10" }),
      trade({ id: "c", outcome: "WIN", netPnl: "20.00", actualR: "0.2", commission: "0", swap: "0", otherFees: "0" }),
    ], 2);
    expect(metrics).toMatchObject({
      grossProfit: "120.10",
      grossLoss: "40.05",
      netProfit: "80.05",
      totalFees: "0.90",
      averageWinner: "60.05",
      averageLoser: "40.05",
      largestWinner: "100.10",
      largestLoser: "40.05",
      currencyExpectancy: "26.68",
      profitFactor: { state: "FINITE", value: "2.9988" },
    });
  });

  it("models all-win, all-loss, one-trade, and break-even-only samples safely", () => {
    expect(calculatePerformanceMetrics([trade()], 2).profitFactor.state).toBe("NO_LOSING_TRADES");
    expect(calculatePerformanceMetrics([trade({ outcome: "LOSS", netPnl: "-5", actualR: "-1" })], 2).profitFactor).toEqual({ state: "FINITE", value: "0.0000" });
    const breakEven = calculatePerformanceMetrics([trade({ outcome: "BREAK_EVEN", netPnl: "0", actualR: "0" })], 2);
    expect(breakEven.winRate).toBeNull();
    expect(breakEven.breakEvenRate).toBe("100.00");
    expect(breakEven.profitFactor.state).toBe("UNDEFINED");
  });

  it("uses only valid actual R values and reconciles the distribution cross-check", () => {
    const metrics = calculatePerformanceMetrics([
      trade({ id: "a", actualR: "2" }),
      trade({ id: "b", outcome: "LOSS", netPnl: "-50", actualR: "-1" }),
      trade({ id: "c", outcome: "BREAK_EVEN", netPnl: "0", actualR: "0" }),
      trade({ id: "d", outcome: "WIN", netPnl: "10", actualR: null }),
    ], 2);
    expect(metrics.rExpectancy).toBe("0.33333333");
    expect(metrics.averageR).toBe("0.33333333");
    expect(metrics.rDistributionCrossCheck).toBe("0.33333333");
    expect(metrics.rSample).toBe(3);
  });

  it("calculates streaks with break-even resetting both sequences", () => {
    const metrics = calculatePerformanceMetrics([
      trade({ id: "1", closedAt: "2026-09-01T10:00:00Z" }),
      trade({ id: "2", closedAt: "2026-09-02T10:00:00Z", outcome: "PARTIAL_WIN", netPnl: "10" }),
      trade({ id: "3", closedAt: "2026-09-03T10:00:00Z", outcome: "BREAK_EVEN", netPnl: "0", actualR: "0" }),
      trade({ id: "4", closedAt: "2026-09-04T10:00:00Z", outcome: "LOSS", netPnl: "-10", actualR: "-1" }),
      trade({ id: "5", closedAt: "2026-09-05T10:00:00Z", outcome: "PARTIAL_LOSS", netPnl: "-5", actualR: "-0.5" }),
    ], 2);
    expect(metrics.streaks).toEqual({ currentWinning: 0, currentLosing: 2, maximumWinning: 2, maximumLosing: 2 });
  });

  it("reports risk, holding, and reviewed-only rule compliance samples", () => {
    const metrics = calculatePerformanceMetrics([
      trade({ id: "a", plannedRiskPercentage: "0.25", holdingDurationSeconds: 60, ruleCompliance: "FULLY_COMPLIANT" }),
      trade({ id: "b", plannedRiskPercentage: "0.75", holdingDurationSeconds: 180, ruleCompliance: "VIOLATIONS_PRESENT", ruleViolations: 2 }),
      trade({ id: "c", plannedRiskPercentage: null, holdingDurationSeconds: null, ruleCompliance: "NOT_REVIEWED" }),
    ], 2);
    expect(metrics.averagePlannedRiskPercentage).toBe("0.500000");
    expect(metrics.averageHoldingDurationSeconds).toBe(120);
    expect(metrics.ruleComplianceRate).toBe("50.00");
    expect(metrics.ruleComplianceSample).toBe(2);
    expect(metrics.totalRuleViolations).toBe(2);
  });

  it("calculates account return without treating adjustments as profit", () => {
    expect(calculateAccountReturn("250", "10000")).toBe("2.50");
    expect(calculateAccountReturn("250", "0")).toBeNull();
  });

  it("groups from underlying trades instead of averaging account-level rates", () => {
    const rows = [
      trade({ id: "a", instrument: "EURUSD", instrumentId: "eurusd" }),
      trade({ id: "b", instrument: "EURUSD", instrumentId: "eurusd", outcome: "LOSS", netPnl: "-10", actualR: "-1" }),
      trade({ id: "c", instrument: "GBPUSD", instrumentId: "gbpusd" }),
    ];
    const grouped = groupPerformance(rows, (row) => ({ key: row.instrumentId, label: row.instrument }), 2);
    expect(grouped.find((group) => group.key === "eurusd")?.metrics.winRate).toBe("50.00");
    expect(grouped.find((group) => group.key === "gbpusd")?.metrics.winRate).toBe("100.00");
  });
});

describe("cash-flow-neutral balance drawdown", () => {
  it("keeps drawdown unchanged across a performance-neutral withdrawal", () => {
    const curve = buildAccountCurve({
      account: { ...account, startingBalance: "110000" },
      trades: [trade({ id: "loss", closedAt: "2026-09-02T10:00:00Z", outcome: "LOSS", netPnl: "-5000", actualR: "-1" })],
      adjustments: [{ id: "withdrawal", accountId: account.id, occurredAt: "2026-09-03T10:00:00Z", amount: "-10000", type: "WITHDRAWAL", isPerformanceNeutral: true }],
    });
    expect(curve.available).toBe(true);
    if (!curve.available) return;
    expect(curve.points.at(-2)?.drawdownAmount).toBe("5000.00");
    expect(curve.points.at(-1)?.drawdownAmount).toBe("5000.00");
    expect(curve.currentAmount).toBe("5000.00");
  });

  it("tracks rising balance, drawdown, recovery, new highs, and multiple drawdowns", () => {
    const curve = buildAccountCurve({
      account,
      trades: [
        trade({ id: "1", closedAt: "2026-09-02T10:00:00Z", netPnl: "100" }),
        trade({ id: "2", closedAt: "2026-09-03T10:00:00Z", outcome: "LOSS", netPnl: "-40", actualR: "-0.4" }),
        trade({ id: "3", closedAt: "2026-09-04T10:00:00Z", netPnl: "80", actualR: "0.8" }),
        trade({ id: "4", closedAt: "2026-09-05T10:00:00Z", outcome: "LOSS", netPnl: "-20", actualR: "-0.2" }),
      ],
      adjustments: [],
    });
    expect(curve.available).toBe(true);
    if (!curve.available) return;
    expect(curve.maximumAmount).toBe("40.00");
    expect(curve.currentAmount).toBe("20.00");
    expect(curve.points.at(-1)?.balance).toBe("1120.00");
    expect(curve.points.at(-1)?.cumulativeR).toBe("1.20000000");
    expect(curve.recoveryFactor).toBe("3.0000");
  });

  it("treats explicitly performance-affecting OTHER adjustments as account movement", () => {
    const curve = buildAccountCurve({
      account,
      trades: [],
      adjustments: [{ id: "other", accountId: account.id, occurredAt: "2026-09-02T10:00:00Z", amount: "-25", type: "OTHER", isPerformanceNeutral: false }],
    });
    expect(curve.available).toBe(true);
    if (!curve.available) return;
    expect(curve.currentAmount).toBe("25.00");
  });

  it("withholds authoritative drawdown when OTHER classification is missing", () => {
    const curve = buildAccountCurve({
      account,
      trades: [trade()],
      adjustments: [{ id: "other", accountId: account.id, occurredAt: "2026-09-03T10:00:00Z", amount: "10", type: "OTHER", isPerformanceNeutral: null }],
    });
    expect(curve).toMatchObject({
      available: false,
      unclassifiedAdjustmentCount: 1,
      currentAmount: null,
      maximumAmount: null,
      recoveryFactor: null,
    });
    expect(curve.points.at(-1)?.drawdownAmount).toBeNull();
  });
});

describe("analytics dimensions", () => {
  it("uses closed_at for realized weekday and month in the display timezone", () => {
    const row = trade({ closedAt: "2026-09-06T22:30:00Z" });
    expect(realizedWeekdayDimension(row, "Africa/Kampala").label).toBe("Mon");
    expect(realizedMonthDimension(row, "Africa/Kampala").label).toBe("2026-09");
  });

  it("uses opened_at only for the explicit hour-of-entry dimension", () => {
    expect(entryHourDimension(trade({ openedAt: "2026-09-02T08:00:00Z" }), "Africa/Kampala").label).toBe("11:00");
  });

  it("uses explicit risk and duration bucket boundaries", () => {
    expect(riskBucketDimension(trade({ plannedRiskPercentage: "0.25" })).label).toBe("≤ 0.25%");
    expect(riskBucketDimension(trade({ plannedRiskPercentage: "0.50" })).label).toBe("> 0.25% to 0.50%");
    expect(riskBucketDimension(trade({ plannedRiskPercentage: "1.00" })).label).toBe("> 0.50% to 1.00%");
    expect(riskBucketDimension(trade({ plannedRiskPercentage: "1.01" })).label).toBe("> 1.00%");
    expect(holdingDurationDimension(trade({ holdingDurationSeconds: 900 })).label).toBe("15 min to 1 hour");
  });

  it("uses explicit planned and actual R bucket boundaries", () => {
    expect(plannedRiskRewardBucketDimension(trade({ plannedRiskReward: "0.99" })).label).toBe("Under 1R");
    expect(plannedRiskRewardBucketDimension(trade({ plannedRiskReward: "1" })).label).toBe("1R to under 2R");
    expect(plannedRiskRewardBucketDimension(trade({ plannedRiskReward: "2" })).label).toBe("2R to under 3R");
    expect(plannedRiskRewardBucketDimension(trade({ plannedRiskReward: "3" })).label).toBe("3R or more");
    expect(actualRBucketDimension(trade({ actualR: "-1" })).label).toBe("−1R or less");
    expect(actualRBucketDimension(trade({ actualR: "-0.01" })).label).toBe("> −1R to under 0R");
    expect(actualRBucketDimension(trade({ actualR: "0" })).label).toBe("0R");
    expect(actualRBucketDimension(trade({ actualR: "1" })).label).toBe("1R to under 2R");
    expect(actualRBucketDimension(trade({ actualR: null })).label).toBe("Actual R not recorded");
  });
});
