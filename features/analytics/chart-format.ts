export function chartDate(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "2-digit" }).format(new Date(value));
}

export function exactChartValue(value: number | string, precision: number): string {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(precision) : String(value);
}
