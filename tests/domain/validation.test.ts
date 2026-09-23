import { describe, expect, it } from "vitest";

import {
  dailyLogSchema,
  executionReviewSchema,
  monthlyReviewSchema,
  psychologyReviewSchema,
  setupSchema,
  strategySchema,
  tradeReviewSchema,
  tradeSchema,
  tradeTargetSchema,
  tradingAccountSchema,
  tradingRuleSchema,
  weeklyReviewSchema,
} from "@/domain/validation/schemas";

const accountId = "11111111-1111-4111-8111-111111111111";
const tradeId = "22222222-2222-4222-8222-222222222222";
const instrumentId = "33333333-3333-4333-8333-333333333333";

describe("foundation validation schemas", () => {
  it("accepts currency precision independently from starting-balance scale", () => {
    const result = tradingAccountSchema.parse({
      id: "",
      name: "JPY Practice",
      accountType: "DEMO",
      brokerName: "",
      platform: "MT5",
      currencyCode: "jpy",
      currencyPrecision: "0",
      startingBalance: "100000.125",
      leverage: "100",
      startedAt: "2026-09-23",
      status: "ACTIVE",
      notes: "",
    });

    expect(result.currencyCode).toBe("JPY");
    expect(result.currencyPrecision).toBe(0);
  });

  it("rejects non-positive starting balances", () => {
    expect(() =>
      tradingAccountSchema.parse({
        name: "Invalid",
        accountType: "DEMO",
        platform: "OTHER",
        currencyCode: "USD",
        currencyPrecision: 2,
        startingBalance: "0.00",
        startedAt: "2026-09-23",
        status: "ACTIVE",
      }),
    ).toThrow();
  });

  it("validates foundational strategy, setup, and rule inputs", () => {
    expect(strategySchema.safeParse({ id: "", name: "Market Structure", description: "", active: true }).success).toBe(true);
    expect(setupSchema.safeParse({ id: "", strategyId: accountId, name: "Break and retest", description: "", active: true }).success).toBe(true);
    expect(tradingRuleSchema.safeParse({ id: "", accountId: "", name: "Maximum risk", description: "Risk no more than one percent.", ruleType: "MAX_RISK_PERCENT", numericLimit: "1", active: true }).success).toBe(true);
  });

  it("requires closed trades to have an outcome and net PnL", () => {
    const result = tradeSchema.safeParse({
      accountId,
      instrumentId,
      status: "CLOSED",
      sourceType: "MANUAL",
      direction: "BUY",
      orderType: "MARKET",
      session: "LONDON",
      commission: "0",
      swap: "0",
      otherFees: "0",
    });

    expect(result.success).toBe(false);
  });

  it("validates closed outcomes after currency normalization and partial exits", () => {
    const closedTrade = {
      accountId,
      instrumentId,
      status: "CLOSED",
      sourceType: "MANUAL",
      direction: "BUY",
      orderType: "MARKET",
      session: "LONDON",
      commission: "0",
      swap: "0",
      otherFees: "0",
      currencyPrecision: 2,
      usedPartialExits: true,
    } as const;

    expect(
      tradeSchema.safeParse({
        ...closedTrade,
        outcome: "PARTIAL_WIN",
        netPnl: "12.345",
      }).success,
    ).toBe(true);
    expect(
      tradeSchema.safeParse({
        ...closedTrade,
        outcome: "WIN",
        netPnl: "12.345",
      }).success,
    ).toBe(false);
    expect(
      tradeSchema.safeParse({
        ...closedTrade,
        outcome: "BREAK_EVEN",
        netPnl: "0.004",
      }).success,
    ).toBe(true);
  });

  it("validates trade targets and qualitative review models", () => {
    expect(tradeTargetSchema.safeParse({ tradeId, label: "TP1", plannedPrice: "1.10500", plannedClosePercentage: "50", actualFillPrice: "", actualClosePercentage: "", pnlContribution: "" }).success).toBe(true);
    expect(executionReviewSchema.safeParse({ tradeId, closedEarly: false, enteredEarly: false, enteredLate: false, chasedPrice: false, addedToPosition: false, revengeTrade: false, overRisked: false }).success).toBe(true);
    expect(psychologyReviewSchema.safeParse({ tradeId, fearInfluenced: false, greedInfluenced: false, fomoInfluenced: false }).success).toBe(true);
    expect(tradeReviewSchema.safeParse({ tradeId, whatWentWell: "", whatWentWrong: "", improvement: "", lessonLearned: "" }).success).toBe(true);
  });

  it("validates daily, weekly, and monthly reflection inputs", () => {
    expect(dailyLogSchema.safeParse({ accountId, tradingDate: "2026-09-23", startingBalance: "", endingBalance: "", marketConditions: "", mentalState: "", lessons: "", notes: "" }).success).toBe(true);
    expect(weeklyReviewSchema.safeParse({ accountId, weekStart: "2026-09-21", whatWorked: "", whatDidNot: "", changeNextWeek: "", behaviorToStop: "", behaviorToContinue: "", notes: "" }).success).toBe(true);
    expect(monthlyReviewSchema.safeParse({ accountId, month: "2026-09-01", whatWorked: "", whatDidNot: "", lessons: "", focusNextMonth: "", notes: "" }).success).toBe(true);
  });
});
