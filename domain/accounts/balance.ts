import {
  normalizeMoney,
  parseDecimal,
  type DecimalInput,
} from "@/domain/money/decimal";

export interface AccountBalanceInput {
  startingBalance: DecimalInput;
  closedTradeNetPnl: readonly DecimalInput[];
  accountAdjustments: readonly DecimalInput[];
  currencyPrecision: number;
}

export function deriveAccountBalance({
  startingBalance,
  closedTradeNetPnl,
  accountAdjustments,
  currencyPrecision,
}: AccountBalanceInput): string {
  let finalBalance = parseDecimal(startingBalance);

  for (const amount of closedTradeNetPnl) {
    finalBalance = finalBalance.plus(parseDecimal(amount));
  }

  for (const amount of accountAdjustments) {
    finalBalance = finalBalance.plus(parseDecimal(amount));
  }

  return normalizeMoney(finalBalance, currencyPrecision);
}
