import { Activity, BookOpenText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { AnalyticsContent } from "@/features/analytics/analytics-content";
import { AnalyticsFilters } from "@/features/analytics/analytics-filters";
import { ANALYTICS_VIEWS, AnalyticsNavigation, type AnalyticsView } from "@/features/analytics/analytics-navigation";
import { parseAnalyticsFilters, serializeAnalyticsFilters, type RawSearchParams } from "@/features/analytics/query";
import { createClient } from "@/lib/supabase/server";
import { getPerformanceAnalytics } from "@/services/analytics/get-performance-analytics";

const viewCopy: Record<AnalyticsView, { title: string; description: string }> = {
  overview: { title: "Performance analytics", description: "Realized trading performance, cash-flow-neutral drawdown, and explicit sample sizes from persisted account data." },
  instruments: { title: "Instrument analytics", description: "Compare realized outcomes by traded instrument without mixing account currencies." },
  strategies: { title: "Strategy analytics", description: "Measure strategy results from underlying closed trades, including unassigned records." },
  setups: { title: "Setup analytics", description: "See which repeatable setups produce the strongest realized distributions and where sample sizes remain thin." },
  sessions: { title: "Session and direction analytics", description: "Compare persisted trading sessions and BUY versus SELL performance." },
  risk: { title: "Risk analytics", description: "Review planned risk, planned and actual R, and holding-duration buckets with explicit boundaries and missing-data groups." },
  time: { title: "Time analytics", description: "Attribute realized results to close date while keeping hour of entry as a separate execution-timing view." },
};

interface AnalyticsPageProps {
  params: Promise<{ view: string }>;
  searchParams: Promise<RawSearchParams>;
}

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const [{ view: rawView }, rawFilters, supabase] = await Promise.all([params, searchParams, createClient()]);
  if (!ANALYTICS_VIEWS.some((item) => item.id === rawView)) notFound();
  const view = rawView as AnalyticsView;
  const filters = parseAnalyticsFilters(rawFilters);
  const dataset = await getPerformanceAnalytics(supabase, filters);
  const query = serializeAnalyticsFilters(filters);
  const path = `/analytics/${view}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Realized performance"
        title={viewCopy[view].title}
        description={viewCopy[view].description}
        actions={<Button nativeButton={false} render={<Link href="/trades"><BookOpenText />Open journal</Link>} />}
      />
      <AnalyticsFilters dataset={dataset} path={path} />
      <AnalyticsNavigation view={view} query={query} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Activity className="size-3.5 text-primary" aria-hidden="true" /><span>{dataset.selectedAccountCount} account{dataset.selectedAccountCount === 1 ? "" : "s"}</span><span aria-hidden="true">·</span><span>{dataset.unitlessMetrics.closedTrades} closed trades</span><span aria-hidden="true">·</span><span>{dataset.timezone}</span></div>
      <AnalyticsContent dataset={dataset} view={view} />
    </div>
  );
}
