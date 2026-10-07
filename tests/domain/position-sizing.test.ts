import { describe, expect, it } from "vitest";

import { parseCalculatorTransfer, CALCULATOR_TRANSFER_VERSION } from "@/domain/trading/calculator-transfer";
import { getInstrumentSpecification } from "@/domain/trading/instrument-specifications";
import { calculatePositionSize } from "@/domain/trading/position-sizing";

const eurusd = getInstrumentSpecification("EURUSD")!;

describe("position sizing", () => {
  it.each([
    ["AUDUSD", "AUD", "USD", "0.0001", 5],
    ["AUDJPY", "AUD", "JPY", "0.01", 3],
    ["EURAUD", "EUR", "AUD", "0.0001", 5],
  ])("includes the canonical %s reference preset without inferring broker aliases", (symbol, baseCurrency, quoteCurrency, pipSize, pricePrecision) => {
    expect(getInstrumentSpecification(symbol)).toMatchObject({ baseCurrency, quoteCurrency, pipSize, pricePrecision });
    expect(getInstrumentSpecification(`${symbol}m`)).toBeUndefined();
  });
  it("sizes quote-currency accounts and floors to the volume step", () => {
    const result = calculatePositionSize({ balance: "10000", currency: "USD", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "1", instrument: eurusd, direction: "BUY", entryPrice: "1.10000", stopLossPrice: "1.09500", takeProfitPrice: "1.11000", leverage: "100" });
    expect(result.recommendedVolume).toBe("0.20");
    expect(result.actualRiskAmount).toBe("100.00");
    expect(result.rewardAmount).toBe("200.00");
    expect(result.riskReward).toBe("2.00");
    expect(result.conversionSource).toBe("IDENTITY");
  });

  it("uses entry reciprocal for a base-currency account", () => {
    const result = calculatePositionSize({ balance: "10000", currency: "EUR", currencyPrecision: 2, riskMethod: "FIXED_AMOUNT", riskValue: "100", instrument: eurusd, direction: "BUY", entryPrice: "1.10000", stopLossPrice: "1.09500" });
    expect(result.conversionSource).toBe("ENTRY_RECIPROCAL");
    expect(result.quoteToAccountRate).toBe("0.909090909090909091");
    expect(result.recommendedVolume).toBe("0.22");
    expect(result.actualRiskAmount).toBe("100.00");
  });

  it("requires an explicit cross-currency conversion", () => {
    expect(() => calculatePositionSize({ balance: "10000", currency: "GBP", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "1", instrument: eurusd, direction: "BUY", entryPrice: "1.1", stopLossPrice: "1.095" })).toThrow("conversion rate");
  });

  it("uses a manual cross-currency rate", () => {
    const result = calculatePositionSize({ balance: "10000", currency: "GBP", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "1", instrument: eurusd, direction: "BUY", entryPrice: "1.1", stopLossPrice: "1.095", manualQuoteToAccountRate: "0.8" });
    expect(result.conversionSource).toBe("MANUAL");
    expect(result.recommendedVolume).toBe("0.25");
    expect(result.actualRiskAmount).toBe("100.00");
  });

  it("never raises a sub-minimum result", () => {
    const result = calculatePositionSize({ balance: "10", currency: "USD", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "1", instrument: eurusd, direction: "BUY", entryPrice: "1.1", stopLossPrice: "1.09" });
    expect(result.volumeStatus).toBe("BELOW_MINIMUM");
    expect(result.recommendedVolume).toBeNull();
  });

  it("flags results over the instrument maximum", () => {
    const result = calculatePositionSize({ balance: "10000000", currency: "USD", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "10", instrument: eurusd, direction: "BUY", entryPrice: "1.10000", stopLossPrice: "1.09999" });
    expect(result.volumeStatus).toBe("ABOVE_MAXIMUM");
    expect(result.recommendedVolume).toBeNull();
  });

  it("preserves exact JPY monetary normalization", () => {
    const usdjpy = getInstrumentSpecification("USDJPY")!;
    const result = calculatePositionSize({ balance: "1000000", currency: "JPY", currencyPrecision: 0, riskMethod: "PERCENTAGE", riskValue: "1", instrument: usdjpy, direction: "SELL", entryPrice: "150.000", stopLossPrice: "150.500" });
    expect(result.riskAmount).toBe("10000");
    expect(result.recommendedVolume).toBe("0.20");
  });

  it.each([
    ["GBPUSD", "GBP", "USD", "1.25000", "1.24500", "0.20"],
    ["EURGBP", "EUR", "GBP", "0.85000", "0.84500", "0.20"],
    ["GBPJPY", "GBP", "JPY", "190.000", "189.500", "0.20"],
    ["XAUUSD", "XAU", "USD", "2500.00", "2495.00", "0.20"],
  ])("calculates deterministic %s fixtures", (symbol, _base, quote, entryPrice, stopLossPrice, expectedVolume) => {
    const instrument = getInstrumentSpecification(symbol)!;
    const currency = quote as "USD" | "GBP" | "JPY";
    const precision = currency === "JPY" ? 0 : 2;
    const balance = currency === "JPY" ? "1000000" : "10000";
    const result = calculatePositionSize({ balance, currency, currencyPrecision: precision, riskMethod: "PERCENTAGE", riskValue: "1", instrument, direction: "BUY", entryPrice, stopLossPrice });
    expect(result.recommendedVolume).toBe(expectedVolume);
  });

  it("keeps leverage out of position size while changing margin", () => {
    const base = { balance: "10000", currency: "USD" as const, currencyPrecision: 2, riskMethod: "PERCENTAGE" as const, riskValue: "1", instrument: eurusd, direction: "BUY" as const, entryPrice: "1.1", stopLossPrice: "1.095" };
    const lowLeverage = calculatePositionSize({ ...base, leverage: "10" });
    const highLeverage = calculatePositionSize({ ...base, leverage: "100" });
    expect(lowLeverage.recommendedVolume).toBe(highLeverage.recommendedVolume);
    expect(lowLeverage.estimatedMargin).toBe("2200.00");
    expect(highLeverage.estimatedMargin).toBe("220.00");
  });

  it("floors the specification example without exceeding risk", () => {
    const result = calculatePositionSize({ balance: "10000", currency: "USD", currencyPrecision: 2, riskMethod: "FIXED_AMOUNT", riskValue: "313.705", instrument: eurusd, direction: "BUY", entryPrice: "1.10000", stopLossPrice: "1.09500" });
    expect(result.rawVolume).toBe("0.62741");
    expect(result.recommendedVolume).toBe("0.62");
    expect(result.actualRiskAmount).toBe("310.00");
  });

  it("audits USDJPY base-currency conversion and margin", () => {
    const usdjpy = getInstrumentSpecification("USDJPY")!;
    const result = calculatePositionSize({ balance: "10000", currency: "USD", currencyPrecision: 2, riskMethod: "FIXED_AMOUNT", riskValue: "100", instrument: usdjpy, direction: "BUY", entryPrice: "150.000", stopLossPrice: "149.500", leverage: "100" });
    expect(result.quoteToAccountRate).toBe("0.00666666666666666667");
    expect(result.stopDistancePips).toBe("50.00");
    expect(result.recommendedVolume).toBe("0.30");
    expect(result.actualRiskAmount).toBe("100.00");
    expect(result.estimatedMargin).toBe("300.00");
  });

  it("audits cross-currency reward and margin", () => {
    const eurgbp = getInstrumentSpecification("EURGBP")!;
    const result = calculatePositionSize({ balance: "10000", currency: "USD", currencyPrecision: 2, riskMethod: "FIXED_AMOUNT", riskValue: "100", instrument: eurgbp, direction: "BUY", entryPrice: "0.85000", stopLossPrice: "0.84500", takeProfitPrice: "0.86000", leverage: "30", manualQuoteToAccountRate: "1.25" });
    expect(result.recommendedVolume).toBe("0.16");
    expect(result.actualRiskAmount).toBe("100.00");
    expect(result.rewardAmount).toBe("200.00");
    expect(result.riskReward).toBe("2.00");
    expect(result.estimatedMargin).toBe("566.67");
  });

  it("audits XAUUSD reward and margin using the gold contract size", () => {
    const gold = getInstrumentSpecification("XAUUSD")!;
    const result = calculatePositionSize({ balance: "10000", currency: "USD", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "1", instrument: gold, direction: "BUY", entryPrice: "2500.00", stopLossPrice: "2495.00", takeProfitPrice: "2520.00", leverage: "100" });
    expect(result.stopDistancePips).toBe("500.00");
    expect(result.recommendedVolume).toBe("0.20");
    expect(result.actualRiskAmount).toBe("100.00");
    expect(result.rewardAmount).toBe("400.00");
    expect(result.riskReward).toBe("4.00");
    expect(result.estimatedMargin).toBe("500.00");
  });

  it("produces symmetric risk for equivalent BUY and SELL stops", () => {
    const buy = calculatePositionSize({ balance: "10000", currency: "USD", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "1", instrument: eurusd, direction: "BUY", entryPrice: "1.10000", stopLossPrice: "1.09500" });
    const sell = calculatePositionSize({ balance: "10000", currency: "USD", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "1", instrument: eurusd, direction: "SELL", entryPrice: "1.10000", stopLossPrice: "1.10500" });
    expect(sell.recommendedVolume).toBe(buy.recommendedVolume);
    expect(sell.actualRiskAmount).toBe(buy.actualRiskAmount);
  });

  it("rejects directionally invalid stops and risk above 100 percent", () => {
    expect(() => calculatePositionSize({ balance: "100", currency: "USD", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "101", instrument: eurusd, direction: "BUY", entryPrice: "1.1", stopLossPrice: "1.09" })).toThrow("100%");
    expect(() => calculatePositionSize({ balance: "100", currency: "USD", currencyPrecision: 2, riskMethod: "PERCENTAGE", riskValue: "1", instrument: eurusd, direction: "BUY", entryPrice: "1.1", stopLossPrice: "1.11" })).toThrow("below entry");
  });

  it("expires transferred drafts after 24 hours", () => {
    const createdAt = 1_000;
    const payload = { version: CALCULATOR_TRANSFER_VERSION, createdAt, balance: "10000", currency: "USD", riskMethod: "PERCENTAGE", riskValue: "1", symbol: "EURUSD", direction: "BUY", entryPrice: "1.1", stopLossPrice: "1.09" } as const;
    expect(parseCalculatorTransfer(payload, createdAt + 1_000)).not.toBeNull();
    expect(parseCalculatorTransfer(payload, createdAt + 24 * 60 * 60 * 1000 + 1)).toBeNull();
  });
});
