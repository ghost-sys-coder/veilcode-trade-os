import { z } from "zod";

import { SUPPORTED_ACCOUNT_CURRENCIES } from "@/domain/trading/instrument-specifications";

export const CALCULATOR_TRANSFER_KEY = "trade-os:position-calculator-draft";
export const CALCULATOR_TRANSFER_VERSION = 1;
export const CALCULATOR_TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;

export const calculatorTransferSchema = z.object({
  version: z.literal(CALCULATOR_TRANSFER_VERSION),
  createdAt: z.number().int().positive(),
  balance: z.string(),
  currency: z.enum(SUPPORTED_ACCOUNT_CURRENCIES),
  riskMethod: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  riskValue: z.string(),
  symbol: z.string().min(1),
  direction: z.enum(["BUY", "SELL"]),
  entryPrice: z.string(),
  stopLossPrice: z.string(),
  takeProfitPrice: z.string().optional(),
  leverage: z.string().optional(),
  manualQuoteToAccountRate: z.string().optional(),
});

export type CalculatorTransfer = z.infer<typeof calculatorTransferSchema>;

export function parseCalculatorTransfer(value: unknown, now = Date.now()): CalculatorTransfer | null {
  const parsed = calculatorTransferSchema.safeParse(value);
  if (!parsed.success || now - parsed.data.createdAt > CALCULATOR_TRANSFER_TTL_MS) return null;
  return parsed.data;
}
