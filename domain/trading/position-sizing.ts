import Decimal from "decimal.js";

import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import type { InstrumentSpecification, SupportedAccountCurrency } from "@/domain/trading/instrument-specifications";

export type RiskMethod = "PERCENTAGE" | "FIXED_AMOUNT";
export type TradeDirection = "BUY" | "SELL";

export interface PositionSizingInput {
  balance: string;
  currency: SupportedAccountCurrency;
  currencyPrecision: number;
  riskMethod: RiskMethod;
  riskValue: string;
  instrument: InstrumentSpecification;
  direction: TradeDirection;
  entryPrice: string;
  stopLossPrice: string;
  takeProfitPrice?: string;
  leverage?: string;
  manualQuoteToAccountRate?: string;
}

export interface PositionSizingResult {
  riskAmount: string;
  riskPercentage: string;
  quoteToAccountRate: string;
  conversionSource: "IDENTITY" | "ENTRY_RECIPROCAL" | "MANUAL";
  stopDistance: string;
  stopDistancePips: string;
  lossPerLot: string;
  rawVolume: string;
  recommendedVolume: string | null;
  volumeStatus: "VALID" | "BELOW_MINIMUM" | "ABOVE_MAXIMUM";
  actualRiskAmount: string | null;
  actualRiskPercentage: string | null;
  rewardAmount: string | null;
  riskReward: string | null;
  estimatedMargin: string | null;
  warnings: string[];
}

function positive(value: string, label: string): Decimal {
  const decimal = parseDecimal(value);
  if (!decimal.gt(0)) throw new Error(`${label} must be greater than zero.`);
  return decimal;
}

export function resolveQuoteToAccountRate(input: Pick<PositionSizingInput, "currency" | "entryPrice" | "instrument" | "manualQuoteToAccountRate">): { rate: Decimal; source: PositionSizingResult["conversionSource"] } {
  if (input.currency === input.instrument.quoteCurrency) return { rate: new Decimal(1), source: "IDENTITY" };
  if (input.currency === input.instrument.baseCurrency) return { rate: new Decimal(1).div(positive(input.entryPrice, "Entry price")), source: "ENTRY_RECIPROCAL" };
  if (!input.manualQuoteToAccountRate) throw new Error(`Enter the ${input.instrument.quoteCurrency} to ${input.currency} conversion rate.`);
  return { rate: positive(input.manualQuoteToAccountRate, "Conversion rate"), source: "MANUAL" };
}

function floorToStep(value: Decimal, step: Decimal): Decimal {
  return value.div(step).floor().times(step);
}

export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const balance = positive(input.balance, "Account balance");
  const riskValue = positive(input.riskValue, "Risk");
  const entry = positive(input.entryPrice, "Entry price");
  const stop = positive(input.stopLossPrice, "Stop loss");
  const distance = entry.minus(stop).abs();
  if (distance.isZero()) throw new Error("Entry and stop loss must be different.");
  if (input.direction === "BUY" && !stop.lt(entry)) throw new Error("A BUY stop loss must be below entry.");
  if (input.direction === "SELL" && !stop.gt(entry)) throw new Error("A SELL stop loss must be above entry.");

  const riskAmount = input.riskMethod === "PERCENTAGE" ? balance.times(riskValue).div(100) : riskValue;
  const riskPercentage = riskAmount.div(balance).times(100);
  if (riskPercentage.gt(100)) throw new Error("Risk cannot exceed 100% of account balance.");

  const { rate, source } = resolveQuoteToAccountRate(input);
  const contractSize = positive(input.instrument.contractSize, "Contract size");
  const pipSize = positive(input.instrument.pipSize, "Pip size");
  const convertQuoteAmount = (amount: Decimal) => source === "ENTRY_RECIPROCAL"
    ? amount.div(entry)
    : amount.times(rate);
  const lossPerLot = convertQuoteAmount(distance.times(contractSize));
  const rawVolume = riskAmount.div(lossPerLot);
  const step = positive(input.instrument.volumeStep, "Volume step");
  const minimum = positive(input.instrument.volumeMin, "Minimum volume");
  const maximum = positive(input.instrument.volumeMax, "Maximum volume");
  const flooredVolume = floorToStep(rawVolume, step);
  const volumeStatus = flooredVolume.lt(minimum) ? "BELOW_MINIMUM" : flooredVolume.gt(maximum) ? "ABOVE_MAXIMUM" : "VALID";
  const recommendedVolume = volumeStatus === "VALID" ? flooredVolume : null;
  const actualRisk = recommendedVolume?.times(lossPerLot) ?? null;
  const takeProfit = input.takeProfitPrice ? positive(input.takeProfitPrice, "Take profit") : null;
  if (takeProfit && input.direction === "BUY" && !takeProfit.gt(entry)) throw new Error("A BUY take profit must be above entry.");
  if (takeProfit && input.direction === "SELL" && !takeProfit.lt(entry)) throw new Error("A SELL take profit must be below entry.");
  const reward = recommendedVolume && takeProfit ? convertQuoteAmount(takeProfit.minus(entry).abs().times(contractSize)).times(recommendedVolume) : null;
  const leverage = input.leverage ? positive(input.leverage, "Leverage") : null;
  const margin = recommendedVolume && leverage ? convertQuoteAmount(recommendedVolume.times(contractSize).times(entry)).div(leverage) : null;
  const warnings: string[] = [];
  if (riskPercentage.gt(5)) warnings.push("Risk is above 5% of account balance.");
  if (volumeStatus === "BELOW_MINIMUM") warnings.push(`Raw size is below the ${input.instrument.volumeMin} lot minimum. It was not raised automatically.`);
  if (volumeStatus === "ABOVE_MAXIMUM") warnings.push(`Raw size exceeds the ${input.instrument.volumeMax} lot maximum. Reduce risk or widen the stop.`);

  return {
    riskAmount: normalizeMoney(riskAmount, input.currencyPrecision),
    riskPercentage: riskPercentage.toFixed(4),
    quoteToAccountRate: rate.toSignificantDigits(18).toString(),
    conversionSource: source,
    stopDistance: distance.toFixed(input.instrument.pricePrecision),
    stopDistancePips: distance.div(pipSize).toFixed(2),
    lossPerLot: normalizeMoney(lossPerLot, input.currencyPrecision),
    rawVolume: rawVolume.toSignificantDigits(18).toString(),
    recommendedVolume: recommendedVolume?.toFixed(step.decimalPlaces()) ?? null,
    volumeStatus,
    actualRiskAmount: actualRisk ? normalizeMoney(actualRisk, input.currencyPrecision) : null,
    actualRiskPercentage: actualRisk ? actualRisk.div(balance).times(100).toFixed(4) : null,
    rewardAmount: reward ? normalizeMoney(reward, input.currencyPrecision) : null,
    riskReward: reward && actualRisk ? reward.div(actualRisk).toFixed(2) : null,
    estimatedMargin: margin ? normalizeMoney(margin, input.currencyPrecision) : null,
    warnings,
  };
}
