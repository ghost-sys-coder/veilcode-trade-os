import { dateKey } from "@/domain/journal/analytics";

/** First real instant of a civil date, including midnight DST transitions.
 * A skipped civil date is not silently moved into the following day. */
export function calendarDateStartUtc(date: string, timezone: string): string {
  const noon = Date.parse(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(noon)) throw new RangeError("Invalid calendar date.");
  let lower = noon - 36 * 60 * 60 * 1000;
  let upper = noon + 36 * 60 * 60 * 1000;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (dateKey(new Date(middle).toISOString(), timezone) < date) lower = middle + 1;
    else upper = middle;
  }
  const result = new Date(lower).toISOString();
  if (dateKey(result, timezone) !== date) throw new RangeError("This calendar date does not exist in the reporting timezone.");
  return result;
}

/** Comparable UTC instants without discarding PostgreSQL microseconds. */
export function canonicalUtcInstant(value: string): string {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "";
  if (fraction.length > 9) throw new RangeError("Timestamp precision exceeds nanoseconds.");
  return `${new Date(value).toISOString().split(".")[0]}.${fraction.padEnd(9, "0")}Z`;
}
