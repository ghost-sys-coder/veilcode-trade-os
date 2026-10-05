import Decimal from "decimal.js";

const INTERNAL_PRECISION = 40;
const MIN_CURRENCY_PRECISION = 0;
const MAX_CURRENCY_PRECISION = 20;

Decimal.set({
  precision: INTERNAL_PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -INTERNAL_PRECISION,
  toExpPos: INTERNAL_PRECISION,
});

export type DecimalInput = string | Decimal;

export class InvalidDecimalError extends Error {
  constructor(value: string) {
    super(`Invalid decimal value: ${value}`);
    this.name = "InvalidDecimalError";
  }
}

function assertCurrencyPrecision(precision: number): void {
  if (
    !Number.isInteger(precision) ||
    precision < MIN_CURRENCY_PRECISION ||
    precision > MAX_CURRENCY_PRECISION
  ) {
    throw new RangeError(
      `Currency precision must be an integer from ${MIN_CURRENCY_PRECISION} to ${MAX_CURRENCY_PRECISION}.`,
    );
  }
}

export function parseDecimal(value: DecimalInput): Decimal {
  if (value instanceof Decimal) {
    return value;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new InvalidDecimalError(value);
  }

  try {
    const decimal = new Decimal(normalizedValue);

    if (!decimal.isFinite()) {
      throw new InvalidDecimalError(value);
    }

    return decimal;
  } catch (error) {
    if (error instanceof InvalidDecimalError) {
      throw error;
    }

    throw new InvalidDecimalError(value);
  }
}

export function addDecimal(
  left: DecimalInput,
  right: DecimalInput,
): Decimal {
  return parseDecimal(left).plus(parseDecimal(right));
}

export function subtractDecimal(
  left: DecimalInput,
  right: DecimalInput,
): Decimal {
  return parseDecimal(left).minus(parseDecimal(right));
}

export function sumDecimals(values: readonly DecimalInput[]): Decimal {
  let total = new Decimal(0);

  for (const value of values) {
    total = total.plus(parseDecimal(value));
  }

  return total;
}

export function normalizeMoney(
  value: DecimalInput,
  currencyPrecision: number,
): string {
  assertCurrencyPrecision(currencyPrecision);

  const normalized = parseDecimal(value).toFixed(currencyPrecision, Decimal.ROUND_HALF_UP);
  // Decimal preserves a negative-zero sign after rounding; money does not.
  return parseDecimal(normalized).isZero() ? new Decimal(0).toFixed(currencyPrecision) : normalized;
}

export function compareNormalizedMoneyToZero(
  value: DecimalInput,
  currencyPrecision: number,
): -1 | 0 | 1 {
  const normalizedValue = parseDecimal(
    normalizeMoney(value, currencyPrecision),
  );

  return normalizedValue.comparedTo(0) as -1 | 0 | 1;
}
