import Decimal from "decimal.js";
import { parseDecimal } from "@/domain/money/decimal";

/** Presentation only; not broker step validation or an execution tolerance. */
export const VOLUME_DISPLAY_FRACTION_DIGITS = 8;

export function formatPositionVolume(raw: string): {
  text: string;
  raw: string;
  approximate: boolean;
} {
  const value = parseDecimal(raw);
  if (value.isNegative() && !value.isZero()) {
    throw new RangeError("Position volume cannot be negative.");
  }
  const rounded = value.toDecimalPlaces(VOLUME_DISPLAY_FRACTION_DIGITS, Decimal.ROUND_HALF_UP);
  // Never conceal a nonzero remainder as zero or imply complete closure.
  const displayed = rounded.isZero() && !value.isZero() ? value : rounded;
  const approximate = !displayed.eq(value);
  return { text: `${approximate ? "≈" : ""}${displayed.isZero() ? "0" : displayed.toFixed()}`, raw, approximate };
}
