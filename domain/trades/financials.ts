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
  currencyPrecision,
}: NetPnlInput): string {
  const netPnl = parseDecimal(grossPnl)
    .minus(parseDecimal(commission))
    .minus(parseDecimal(swap))
    .minus(parseDecimal(otherFees));

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
