import { describe, expect, it } from "vitest";

import {
  buildBalanceTimeline,
  dateKey,
  escapeCsv,
  groupRealizedTradesByDate,
  journalDate,
  normalizeAdjustmentAmount,
  plannedActualComparison,
  summarizePerformance,
} from "@/domain/journal/analytics";
import { addDays, monthBounds, weekStart } from "@/domain/journal/periods";
import { matchesJournalFilters } from "@/services/journal/get-trade-journal";

describe("journal analytics", () => {
  it("uses the confirmed journal-date fallback", () => {
    expect(journalDate({ openedAt: "2026-09-03", plannedAt: "2026-09-02", createdAt: "2026-09-01" })).toBe("2026-09-03");
    expect(journalDate({ openedAt: null, plannedAt: "2026-09-02", createdAt: "2026-09-01" })).toBe("2026-09-02");
    expect(journalDate({ openedAt: null, plannedAt: null, createdAt: "2026-09-01" })).toBe("2026-09-01");
  });

  it("attributes realized metrics only to closed trades", () => {
    const summary = summarizePerformance([
      { id: "1", closedAt: "2026-09-23T10:00:00Z", outcome: "WIN", netPnl: "100.10", actualR: "1.5", plannedRiskAmount: "50" },
      { id: "2", closedAt: "2026-09-23T11:00:00Z", outcome: "BREAK_EVEN", netPnl: "0", actualR: "0", plannedRiskAmount: "50" },
      { id: "3", closedAt: "2026-09-23T12:00:00Z", outcome: "PARTIAL_LOSS", netPnl: "-20.05", actualR: "-0.5", plannedRiskAmount: "50" },
      { id: "4", closedAt: null, outcome: null, netPnl: null, actualR: null, plannedRiskAmount: "50" },
    ], 2);
    expect(summary).toMatchObject({ trades: 3, wins: 1, losses: 1, breakEvens: 1, winRate: "50.00", netPnl: "80.05", totalPlannedRisk: "150.00" });
    expect(summary.averageR).toBe("0.33333333");
  });

  it("builds a deterministic balance timeline without drift", () => {
    const timeline = buildBalanceTimeline({
      startingBalance: "1000",
      startedAt: "2026-09-01T00:00:00Z",
      currencyPrecision: 2,
      adjustments: [{ id: "a", occurredAt: "2026-09-02T10:00:00Z", amount: "100", label: "Deposit" }],
      trades: [
        { id: "b", closedAt: "2026-09-02T10:00:00Z", netPnl: "0.1", label: "Trade B" },
        { id: "c", closedAt: "2026-09-02T10:00:00Z", netPnl: "0.2", label: "Trade C" },
      ],
    });
    expect(timeline.map((event) => event.id)).toEqual(["starting-balance", "a", "b", "c"]);
    expect(timeline.at(-1)?.balance).toBe("1100.30");
  });

  it("groups realized trades in the profile timezone", () => {
    const trade = { id: "1", closedAt: "2026-09-23T22:30:00Z", outcome: "WIN" as const, netPnl: "1", actualR: "1", plannedRiskAmount: "1" };
    expect(dateKey(trade.closedAt, "Africa/Kampala")).toBe("2026-09-24");
    expect(groupRealizedTradesByDate([trade], "Africa/Kampala").has("2026-09-24")).toBe(true);
  });

  it("escapes canonical CSV values", () => {
    expect(escapeCsv('alpha,"beta"')).toBe('"alpha,""beta"""');
  });

  it("normalizes account adjustments without mixing them into trade PnL", () => {
    expect(normalizeAdjustmentAmount("DEPOSIT", "-250.50")).toBe("250.5");
    expect(normalizeAdjustmentAmount("WITHDRAWAL", "250.50")).toBe("-250.5");
    expect(normalizeAdjustmentAmount("BALANCE_CORRECTION", "-1.25")).toBe("-1.25");
  });

  it("builds Monday weeks and exact calendar month bounds", () => {
    expect(weekStart("2026-09-23")).toBe("2026-09-21");
    expect(addDays("2026-09-21", 6)).toBe("2026-09-27");
    expect(monthBounds("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });

  it("keeps unlike planned and actual units explicit", () => {
    const rows = plannedActualComparison({ plannedEntry: "1", actualEntry: "1.1", plannedStop: "0.9", actualStop: "0.95", plannedTarget: "1.2", actualExit: "1.15", plannedVolume: "1", actualVolume: "0.5", plannedRisk: "100", netPnl: "75", plannedRr: "2", actualR: "0.75" }, "USD");
    expect(rows.find((row) => row.label === "Risk / final result")?.unit).toBe("USD (budget vs outcome)");
    expect(rows.find((row) => row.label === "Reward-to-risk / realized R")?.actual).toBe("0.75");
  });

  it("applies combined journal filters and searchable text", () => {
    const trade = { accountId: "account-1", journalDate: "2026-09-23T21:30:00Z", instrumentId: "instrument-1", direction: "BUY" as const, strategyId: "strategy-1", setupId: "setup-1", session: "LONDON" as const, status: "CLOSED" as const, outcome: "WIN" as const, grade: "A", ruleCompliance: "FULLY_COMPLIANT" as const, tags: [{ id: "tag-1", name: "Breakout", color: null }] };
    expect(matchesJournalFilters(trade, { account: "account-1", from: "2026-09-24", tag: "tag-1", search: "patient breakout" }, "Africa/Kampala", ["Patient execution", "Breakout"])).toBe(true);
    expect(matchesJournalFilters(trade, { ruleCompliance: "NOT_REVIEWED" }, "Africa/Kampala")).toBe(false);
  });
});
