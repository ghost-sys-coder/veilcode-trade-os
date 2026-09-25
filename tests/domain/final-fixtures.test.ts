import { describe, expect, it } from "vitest";

import { calculatePerformanceMetrics, type AnalyticsTrade } from "@/domain/analytics/performance";
import { calculateRiskMultiple } from "@/domain/trades/financials";

function fixtureTrade(id: string, netPnl: string, outcome: "WIN" | "LOSS"): AnalyticsTrade {
  return {
    id,
    accountId: "fixture-account",
    accountName: "Analytics fixture",
    accountType: "DEMO",
    currencyCode: "USD",
    currencyPrecision: 2,
    status: "CLOSED",
    openedAt: `2026-09-0${id}T08:00:00Z`,
    closedAt: `2026-09-0${id}T09:00:00Z`,
    outcome,
    netPnl,
    grossPnl: netPnl,
    commission: "0",
    swap: "0",
    otherFees: "0",
    actualR: null,
    plannedRiskPercentage: null,
    plannedRiskReward: null,
    actualLotSize: null,
    holdingDurationSeconds: 3600,
    instrumentId: "fixture-instrument",
    instrument: "EURUSD",
    strategyId: null,
    strategy: "No strategy",
    setupId: null,
    setup: "No setup",
    session: "LONDON",
    direction: "BUY",
    ruleCompliance: "NOT_REVIEWED",
    ruleViolations: 0,
  };
}

describe("Phase 07 release fixtures", () => {
  it("reconciles the authoritative seven-trade analytics example", () => {
    const metrics = calculatePerformanceMetrics([
      fixtureTrade("1", "1500", "WIN"),
      fixtureTrade("2", "845.92", "WIN"),
      fixtureTrade("3", "557.47", "WIN"),
      fixtureTrade("4", "1200", "WIN"),
      fixtureTrade("5", "650", "WIN"),
      fixtureTrade("6", "-400", "LOSS"),
      fixtureTrade("7", "-359.59", "LOSS"),
    ], 2);

    expect(metrics).toMatchObject({
      grossProfit: "4753.39",
      grossLoss: "759.59",
      netProfit: "3993.80",
      wins: 5,
      losses: 2,
      closedTrades: 7,
      winRate: "71.43",
      profitFactor: { state: "FINITE", value: "6.2578" },
      averageWinner: "950.68",
      averageLoser: "379.80",
      currencyExpectancy: "570.54",
    });
  });

  it("calculates actual R from normalized PnL and planned risk without inventing missing risk", () => {
    expect(calculateRiskMultiple("3993.80", "1000")).toBe("3.99380000");
    expect(calculateRiskMultiple("-400", "400")).toBe("-1.00000000");
    expect(calculateRiskMultiple("100", "0")).toBeNull();
  });
});
