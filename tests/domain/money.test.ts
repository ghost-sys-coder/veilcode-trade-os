import { describe, expect, it } from "vitest";

import { deriveAccountBalance } from "@/domain/accounts/balance";
import {
  addDecimal,
  normalizeMoney,
  subtractDecimal,
} from "@/domain/money/decimal";
import {
  calculateNetPnl,
  classifyClosedTradeOutcome,
  outcomeMatchesNetPnl,
} from "@/domain/trades/financials";

describe("decimal arithmetic", () => {
  it("adds and subtracts decimal strings without binary floating-point drift", () => {
    expect(addDecimal("0.1", "0.2").toString()).toBe("0.3");
    expect(subtractDecimal("1.00", "0.1").toString()).toBe("0.9");
  });

  it("deducts all fees from gross PnL", () => {
    expect(
      calculateNetPnl({
        grossPnl: "500.00",
        commission: "7.25",
        swap: "2.50",
        otherFees: "0.25",
        currencyPrecision: 2,
      }),
    ).toBe("490.00");
  });
});

describe("currency normalization", () => {
  it("uses the account currency precision", () => {
    expect(normalizeMoney("123.5", 0)).toBe("124");
    expect(normalizeMoney("123.4567", 2)).toBe("123.46");
    expect(normalizeMoney("123.4567", 3)).toBe("123.457");
  });

  it("classifies small representable positive and negative PnL correctly", () => {
    expect(classifyClosedTradeOutcome("0.01", 2, false)).toBe("WIN");
    expect(classifyClosedTradeOutcome("-0.01", 2, false)).toBe("LOSS");
    expect(classifyClosedTradeOutcome("0.000", 3, true)).toBe(
      "BREAK_EVEN",
    );
  });

  it("classifies the complete trade after partial exits", () => {
    expect(classifyClosedTradeOutcome("25.00", 2, true)).toBe(
      "PARTIAL_WIN",
    );
    expect(classifyClosedTradeOutcome("-5.00", 2, true)).toBe(
      "PARTIAL_LOSS",
    );
    expect(classifyClosedTradeOutcome("0.00", 2, true)).toBe(
      "BREAK_EVEN",
    );
  });

  it("detects contradictions between outcome and normalized net PnL", () => {
    expect(outcomeMatchesNetPnl("WIN", "10.00", 2)).toBe(true);
    expect(outcomeMatchesNetPnl("PARTIAL_WIN", "-0.01", 2)).toBe(false);
    expect(outcomeMatchesNetPnl("BREAK_EVEN", "0.00", 2)).toBe(true);
  });
});

describe("account balance derivation", () => {
  it("adds closed PnL and adjustments to starting balance", () => {
    expect(
      deriveAccountBalance({
        startingBalance: "100000.00",
        closedTradeNetPnl: ["500.25", "-250.10"],
        accountAdjustments: ["1000.00", "-100.00"],
        currencyPrecision: 2,
      }),
    ).toBe("101150.15");
  });

  it("accumulates repeated decimal results without floating-point drift", () => {
    expect(
      deriveAccountBalance({
        startingBalance: "0.00",
        closedTradeNetPnl: Array.from({ length: 100 }, () => "0.10"),
        accountAdjustments: [],
        currencyPrecision: 2,
      }),
    ).toBe("10.00");
  });
});
