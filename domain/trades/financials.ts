import {
  compareNormalizedMoneyToZero,
  normalizeMoney,
  parseDecimal,
  type DecimalInput,
} from "@/domain/money/decimal";

export interface NetPnlInput {
  grossPnl: DecimalInput;
  commission: DecimalInput;
  swap: DecimalInput;
  otherFees: DecimalInput;
  tradingCredits?: DecimalInput;
  currencyPrecision: number;
}

export type ClosedTradeOutcome =
  | "WIN"
  | "LOSS"
  | "BREAK_EVEN"
  | "PARTIAL_WIN"
  | "PARTIAL_LOSS";

export function calculateNetPnl({
  grossPnl,
  commission,
  swap,
  otherFees,
  tradingCredits = "0",
  currencyPrecision,
}: NetPnlInput): string {
  for (const value of [commission, swap, otherFees, tradingCredits]) {
    if (parseDecimal(value).isNegative()) throw new RangeError("Trading costs and credits must be non-negative.");
  }
  const netPnl = parseDecimal(grossPnl)
    .minus(parseDecimal(commission))
    .minus(parseDecimal(swap))
    .minus(parseDecimal(otherFees))
    .plus(parseDecimal(tradingCredits));

  return normalizeMoney(netPnl, currencyPrecision);
}

export function classifyClosedTradeOutcome(
  finalNetPnl: DecimalInput,
  currencyPrecision: number,
  usedPartialExits: boolean,
): ClosedTradeOutcome {
  const comparison = compareNormalizedMoneyToZero(
    finalNetPnl,
    currencyPrecision,
  );

  if (comparison === 0) {
    return "BREAK_EVEN";
  }

  if (comparison > 0) {
    return usedPartialExits ? "PARTIAL_WIN" : "WIN";
  }

  return usedPartialExits ? "PARTIAL_LOSS" : "LOSS";
}

export function outcomeMatchesNetPnl(
  outcome: ClosedTradeOutcome,
  finalNetPnl: DecimalInput,
  currencyPrecision: number,
): boolean {
  const comparison = compareNormalizedMoneyToZero(
    finalNetPnl,
    currencyPrecision,
  );

  switch (outcome) {
    case "WIN":
    case "PARTIAL_WIN":
      return comparison > 0;
    case "LOSS":
    case "PARTIAL_LOSS":
      return comparison < 0;
    case "BREAK_EVEN":
      return comparison === 0;
  }
}

export function calculatePlannedRiskPercentage(
  riskAmount: DecimalInput,
  balanceBefore: DecimalInput,
): string | null {
  const balance = parseDecimal(balanceBefore);

  if (balance.lte(0)) {
    return null;
  }

  return parseDecimal(riskAmount).dividedBy(balance).times(100).toFixed(6);
}

export function calculateRiskMultiple(
  amount: DecimalInput,
  plannedRiskAmount: DecimalInput,
): string | null {
  const risk = parseDecimal(plannedRiskAmount);

  if (risk.lte(0)) {
    return null;
  }

  return parseDecimal(amount).dividedBy(risk).toFixed(8);
}

export function calculateHoldingDurationSeconds(
  openedAt: string | null | undefined,
  closedAt: string | null | undefined,
): number | null {
  if (!openedAt || !closedAt) {
    return null;
  }

  const opened = new Date(openedAt).getTime();
  const closed = new Date(closedAt).getTime();

  if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened) {
    return null;
  }

  return Math.floor((closed - opened) / 1000);
}

export function calculateStopDistance(
  entryPrice: DecimalInput,
  stopPrice: DecimalInput,
  pipSize?: DecimalInput | null,
): { value: string; unit: "pips" | "price" } {
  const priceDistance = parseDecimal(entryPrice).minus(parseDecimal(stopPrice)).abs();

  if (pipSize) {
    const pip = parseDecimal(pipSize);

    if (pip.gt(0)) {
      return { value: priceDistance.dividedBy(pip).toFixed(2), unit: "pips" };
    }
  }

  return { value: priceDistance.toString(), unit: "price" };
}
