import { describe, expect, it } from "vitest";

import {
  calculateConsistency,
  calculateProfitTarget,
  calculateStaticLossBuffer,
  configuredAmount,
  goalProgressPercentage,
  summarizeTradingDays,
} from "@/domain/progress/metrics";

describe("Phase 06 progress calculations", () => {
  it("calculates amount and percentage profit targets from starting balance", () => {
    expect(configuredAmount("PERCENT", "10", "100000", 2)).toBe("10000.00");
    expect(configuredAmount("AMOUNT", "8250.125", "100000", 2)).toBe("8250.13");
    expect(calculateProfitTarget({
      startingBalance: "100000",
      currentBalance: "103993.80",
      mode: "PERCENT",
      value: "10",
      currencyPrecision: 2,
    })).toEqual({ current: "3993.80", target: "10000.00", remaining: "6006.20", percentage: "39.94" });
  });

  it("calculates static loss buffers without floating-point drift", () => {
    expect(calculateStaticLossBuffer({
      mode: "PERCENT",
      value: "5",
      percentageBasis: "100000",
      measurementBasis: "100000",
      currentMeasure: "97650.10",
      currencyPrecision: 2,
    })).toMatchObject({ available: true, limit: "5000.00", used: "2349.90", remaining: "2650.10" });
  });

  it("withholds a buffer when required equity is missing", () => {
    expect(calculateStaticLossBuffer({
      mode: "AMOUNT",
      value: "5000",
      percentageBasis: "100000",
      measurementBasis: null,
      currentMeasure: null,
      currencyPrecision: 2,
    })).toMatchObject({ available: false, reason: "A required balance or equity snapshot is missing." });
  });

  it("uses closed-at daily profit for the documented consistency formula", () => {
    const result = calculateConsistency([
      { id: "1", status: "CLOSED", openedAt: "2026-01-01T10:00:00Z", closedAt: "2026-01-02T10:00:00Z", netPnl: "300" },
      { id: "2", status: "CLOSED", openedAt: "2026-01-02T10:00:00Z", closedAt: "2026-01-02T12:00:00Z", netPnl: "-100" },
      { id: "3", status: "CLOSED", openedAt: "2026-01-03T10:00:00Z", closedAt: "2026-01-03T12:00:00Z", netPnl: "100" },
    ], "UTC");
    expect(result).toMatchObject({ available: true, percentage: "66.67", bestDayProfit: "200", totalPositiveProfit: "300" });
  });

  it("counts trading days by opened-at and outcomes by closed-at", () => {
    const result = summarizeTradingDays([
      { id: "1", status: "CLOSED", openedAt: "2026-01-01T23:30:00Z", closedAt: "2026-01-03T01:00:00Z", netPnl: "50" },
      { id: "2", status: "CLOSED", openedAt: "2026-01-02T00:30:00Z", closedAt: "2026-01-03T02:00:00Z", netPnl: "-50" },
      { id: "3", status: "OPEN", openedAt: "2026-01-04T12:00:00Z", closedAt: null, netPnl: null },
    ], "UTC", "0");
    expect(result).toEqual({ tradingDays: 3, profitableDays: 0, losingDays: 0, breakEvenDays: 1 });
  });

  it("caps goal completion while retaining decimal precision", () => {
    expect(goalProgressPercentage("25", "100")).toBe("25.00");
    expect(goalProgressPercentage("125", "100")).toBe("100.00");
  });
});
