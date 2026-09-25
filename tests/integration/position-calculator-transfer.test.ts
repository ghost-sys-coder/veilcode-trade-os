import { describe, expect, it } from "vitest";

import { CALCULATOR_TRANSFER_VERSION, parseCalculatorTransfer } from "@/domain/trading/calculator-transfer";
import { getInstrumentSpecification } from "@/domain/trading/instrument-specifications";
import { calculatePositionSize } from "@/domain/trading/position-sizing";

const baseDraft = {
  version: CALCULATOR_TRANSFER_VERSION,
  createdAt: 1_000,
  balance: "10000",
  currency: "USD" as const,
  riskMethod: "PERCENTAGE" as const,
  riskValue: "1",
  symbol: "EURUSD",
  direction: "BUY" as const,
  entryPrice: "1.10000",
  stopLossPrice: "1.09500",
  takeProfitPrice: "1.11000",
};

describe("calculator transfer reconciliation", () => {
  it("recalculates percentage risk from the selected account balance", () => {
    const draft = parseCalculatorTransfer(baseDraft, 2_000)!;
    const result = calculatePositionSize({ ...draft, balance: "100000", currencyPrecision: 2, instrument: getInstrumentSpecification(draft.symbol)! });
    expect(result.riskAmount).toBe("1000.00");
    expect(result.recommendedVolume).toBe("2.00");
  });

  it("preserves fixed risk when the selected account balance differs", () => {
    const draft = parseCalculatorTransfer({ ...baseDraft, riskMethod: "FIXED_AMOUNT", riskValue: "125" }, 2_000)!;
    const result = calculatePositionSize({ ...draft, balance: "100000", currencyPrecision: 2, instrument: getInstrumentSpecification(draft.symbol)! });
    expect(result.riskAmount).toBe("125.00");
    expect(result.recommendedVolume).toBe("0.25");
  });

  it("requires a fresh conversion when the selected account currency changes", () => {
    const draft = parseCalculatorTransfer(baseDraft, 2_000)!;
    expect(() => calculatePositionSize({ ...draft, balance: "10000", currency: "GBP", currencyPrecision: 2, instrument: getInstrumentSpecification(draft.symbol)!, manualQuoteToAccountRate: undefined })).toThrow("conversion rate");
  });
});
