import { parseDecimal } from "@/domain/money/decimal";

export class InvalidSupabaseNumericError extends Error {
  constructor(value: unknown) {
    super(`Invalid numeric value received from Supabase: ${String(value)}`);
    this.name = "InvalidSupabaseNumericError";
  }
}

export function normalizeSupabaseNumeric(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new InvalidSupabaseNumericError(value);
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new InvalidSupabaseNumericError(value);
  }

  try {
    return parseDecimal(String(value)).toString();
  } catch {
    throw new InvalidSupabaseNumericError(value);
  }
}
