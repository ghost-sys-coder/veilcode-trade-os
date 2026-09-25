import type { BehavioralCohortMetrics } from "@/domain/analytics/behavior";
import { formatMoney } from "@/features/analytics/format";

export function CurrencyValues({ metrics }: { metrics: BehavioralCohortMetrics }) {
  if (!metrics.currencies.length) return <span className="text-muted-foreground">Not enough data</span>;
  return <span className="space-y-1">{metrics.currencies.map((currency) => <span key={currency.currencyCode} className="block font-mono tabular-nums">{formatMoney(currency.currencyCode, currency.netPnl, currency.currencyPrecision)}</span>)}</span>;
}
