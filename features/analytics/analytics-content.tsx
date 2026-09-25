import { ChartNoAxesCombined, Scale } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { BehavioralAnalytics } from "@/domain/analytics/behavior";
import { BehaviorAnalyticsContent } from "@/features/analytics/behavior-analytics-content";
import { BreakdownCurrencySection } from "@/features/analytics/breakdown-currency-section";
import { CurrencyOverview } from "@/features/analytics/currency-overview";
import type { AnalyticsView } from "@/features/analytics/analytics-navigation";
import { UnitlessOverview } from "@/features/analytics/unitless-overview";
import type { AnalyticsDataset } from "@/services/analytics/get-performance-analytics";

export function AnalyticsContent({ dataset, view, behavior }: { dataset: AnalyticsDataset; view: AnalyticsView; behavior?: BehavioralAnalytics }) {
  if (dataset.selectedAccountCount === 0) return <Card><CardContent className="flex min-h-56 flex-col items-center justify-center text-center"><ChartNoAxesCombined className="size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-medium">No accounts match this selection</p><p className="mt-1 text-sm text-muted-foreground">Reset the filters or create a trading account first.</p></CardContent></Card>;
  if (view === "overview") return <div className="space-y-8">{dataset.selectedCurrencyCount > 1 ? <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-4 text-sm"><Scale className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><p><span className="font-medium">Mixed-currency selection.</span> Monetary metrics are separated into {dataset.selectedCurrencyCount} currency sections. Unitless rates below still aggregate the underlying trades.</p></div> : null}<UnitlessOverview dataset={dataset} />{dataset.currencies.map((currency) => <CurrencyOverview key={currency.currencyCode} currency={currency} />)}</div>;
  if (view === "execution" || view === "rules" || view === "psychology" || view === "mistakes") return behavior ? <BehaviorAnalyticsContent analytics={behavior} view={view} /> : null;
  return <div className="space-y-8">{dataset.breakdownsByCurrency.map((item) => <BreakdownCurrencySection key={item.currencyCode} {...item} view={view} />)}</div>;
}
