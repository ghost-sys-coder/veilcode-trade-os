import { AlertTriangle, ChartNoAxesCombined, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CumulativeRChart, BalancePerformanceChart, DrawdownChart } from "@/features/analytics/performance-charts";
import { PerformanceBreakdownTable } from "@/features/analytics/performance-breakdown-table";
import { MetricTile } from "@/features/analytics/metric-tile";
import { formatCurrentStreak, formatDecimal, formatHoldingDuration, formatMoney, formatPercent, formatProfitFactor, formatR } from "@/features/analytics/format";
import type { AnalyticsView } from "@/features/analytics/analytics-navigation";
import type { AnalyticsBreakdowns, AnalyticsDataset, CurrencyAnalytics } from "@/services/analytics/get-performance-analytics";

function CurrencyOverview({ currency }: { currency: CurrencyAnalytics }) {
  const { metrics, curve, currencyCode, currencyPrecision } = currency;
  const pnlTone = metrics.netProfit.startsWith("-") ? "loss" as const : metrics.netProfit === "0" || metrics.netProfit === "0.00" ? "default" as const : "profit" as const;
  return (
    <section className="space-y-4" aria-labelledby={`currency-${currencyCode}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id={`currency-${currencyCode}`} className="text-xl font-semibold tracking-[-0.025em]">{currencyCode} performance</h2><p className="mt-1 text-sm text-muted-foreground">{currency.accountCount} account{currency.accountCount === 1 ? "" : "s"} · monetary values are never combined with another currency.</p></div>
        <Badge variant="secondary">{metrics.closedTrades} closed</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Current balance" value={formatMoney(currencyCode, currency.currentBalance, currencyPrecision)} detail="Starting balances + closed-trade PnL + account adjustments" />
        <MetricTile label="Net trading PnL" value={formatMoney(currencyCode, metrics.netProfit, currencyPrecision)} detail={`${metrics.closedTrades} qualifying closed trades · adjustments excluded`} tone={pnlTone} />
        <MetricTile label="Trading return" value={formatPercent(currency.returnPercentage)} detail={`Net trading PnL ÷ ${formatMoney(currencyCode, currency.openingBalance, currencyPrecision)} balance basis`} tone={pnlTone} />
        <MetricTile label="Profit factor" value={formatProfitFactor(metrics.profitFactor)} detail={`${metrics.wins} winning and ${metrics.losses} losing trades`} />
        <MetricTile label="Currency expectancy" value={metrics.currencyExpectancy === null ? "Not enough data" : formatMoney(currencyCode, metrics.currencyExpectancy, currencyPrecision)} detail={`${metrics.closedTrades} closed trades, including break-even`} />
        <MetricTile label="Maximum drawdown" value={curve.available ? formatMoney(currencyCode, curve.maximumAmount, currencyPrecision) : "Unavailable"} detail={curve.available ? `${formatPercent(curve.maximumPercentage)} at the same high-water-mark observation` : `${curve.unclassifiedAdjustmentCount} OTHER adjustment${curve.unclassifiedAdjustmentCount === 1 ? " requires" : "s require"} classification`} tone={curve.available && !curve.maximumAmount.startsWith("0") ? "loss" : "default"} />
        <MetricTile label="Current drawdown" value={curve.available ? formatMoney(currencyCode, curve.currentAmount, currencyPrecision) : "Unavailable"} detail={curve.available ? formatPercent(curve.currentPercentage) : "Cash-flow-neutral drawdown is withheld until classification is complete"} />
        <MetricTile label="Recovery factor" value={curve.available && curve.recoveryFactor !== null ? formatDecimal(curve.recoveryFactor, 2) : "Not enough data"} detail="Trading net profit ÷ maximum realized balance drawdown" />
      </div>

      {!curve.available ? (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/8 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div><p className="font-medium">Drawdown unavailable</p><p className="mt-1 text-muted-foreground">{curve.unclassifiedAdjustmentCount} account adjustment{curve.unclassifiedAdjustmentCount === 1 ? " requires" : "s require"} performance classification. The balance and trading PnL remain visible, but no cash-flow-neutral drawdown is asserted.</p></div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader className="border-b border-border/70"><CardTitle>Balance and cumulative PnL</CardTitle><CardDescription>Realized trade results enter at final close; performance-neutral cash movements shift balance and its high-water-mark basis together.</CardDescription></CardHeader><CardContent><BalancePerformanceChart points={curve.points} currencyCode={currencyCode} currencyPrecision={currencyPrecision} /></CardContent></Card>
        <Card><CardHeader className="border-b border-border/70"><CardTitle>Cumulative actual R</CardTitle><CardDescription>Only closed trades with valid actual R contribute. Missing R is not converted to zero.</CardDescription></CardHeader><CardContent><CumulativeRChart points={curve.points} /></CardContent></Card>
      </div>
      <Card><CardHeader className="border-b border-border/70"><CardTitle>Realized balance drawdown</CardTitle><CardDescription>Amount and percentage use the same deterministic high-water-mark observation; this is not intraday equity drawdown.</CardDescription></CardHeader><CardContent><DrawdownChart points={curve.points} currencyCode={currencyCode} currencyPrecision={currencyPrecision} /></CardContent></Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Gross profit" value={formatMoney(currencyCode, metrics.grossProfit, currencyPrecision)} detail={`${metrics.wins} winning trades`} tone="profit" />
        <MetricTile label="Gross loss" value={formatMoney(currencyCode, metrics.grossLoss, currencyPrecision)} detail={`${metrics.losses} losing trades · shown as magnitude`} tone="loss" />
        <MetricTile label="Average winner" value={metrics.averageWinner === null ? "Not enough data" : formatMoney(currencyCode, metrics.averageWinner, currencyPrecision)} detail={`${metrics.wins} winning trades`} tone={metrics.averageWinner === null ? "default" : "profit"} />
        <MetricTile label="Average loser" value={metrics.averageLoser === null ? "Not enough data" : formatMoney(currencyCode, metrics.averageLoser, currencyPrecision)} detail={`${metrics.losses} losing trades · shown as magnitude`} tone={metrics.averageLoser === null ? "default" : "loss"} />
        <MetricTile label="Largest winner" value={metrics.largestWinner === null ? "Not enough data" : formatMoney(currencyCode, metrics.largestWinner, currencyPrecision)} detail="Largest positive final net PnL" tone={metrics.largestWinner === null ? "default" : "profit"} />
        <MetricTile label="Largest loser" value={metrics.largestLoser === null ? "Not enough data" : formatMoney(currencyCode, metrics.largestLoser, currencyPrecision)} detail="Largest negative final net PnL · shown as magnitude" tone={metrics.largestLoser === null ? "default" : "loss"} />
        <MetricTile label="Total fees" value={formatMoney(currencyCode, metrics.totalFees, currencyPrecision)} detail={`Commission ${formatMoney(currencyCode, metrics.commission, currencyPrecision)} · swap ${formatMoney(currencyCode, metrics.swap, currencyPrecision)} · other ${formatMoney(currencyCode, metrics.otherFees, currencyPrecision)}`} />
        <MetricTile label="Average holding time" value={formatHoldingDuration(metrics.averageHoldingDurationSeconds)} detail={`${metrics.closedTrades} closed trades; missing durations excluded`} />
      </div>
    </section>
  );
}

function UnitlessOverview({ dataset }: { dataset: AnalyticsDataset }) {
  const metrics = dataset.unitlessMetrics;
  return (
    <section className="space-y-4" aria-labelledby="unitless-performance">
      <div><h2 id="unitless-performance" className="text-xl font-semibold tracking-[-0.025em]">Decision-quality metrics</h2><p className="mt-1 text-sm text-muted-foreground">Computed from underlying trades across the selection. Rates are never averaged from account-level percentages.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        <MetricTile label="Win rate" value={formatPercent(metrics.winRate)} detail={`${metrics.wins} wins of ${metrics.winRateSample} decisive trades`} />
        <MetricTile label="Break-even rate" value={formatPercent(metrics.breakEvenRate)} detail={`${metrics.breakEvens} of ${metrics.closedTrades} closed trades`} />
        <MetricTile label="R expectancy" value={formatR(metrics.rExpectancy)} detail={`${metrics.rSample} of ${metrics.closedTrades} closed trades have valid R`} />
        <MetricTile label="Average R" value={formatR(metrics.averageR)} detail={`Distribution cross-check ${formatR(metrics.rDistributionCrossCheck)}`} />
        <MetricTile label="Current streak" value={formatCurrentStreak(metrics.streaks)} detail={`Max ${metrics.streaks.maximumWinning}W · ${metrics.streaks.maximumLosing}L · break-even resets both`} />
        <MetricTile label="Average winning R" value={formatR(metrics.averageWinningR)} detail={`${metrics.wins} winning outcomes in the full closed sample`} />
        <MetricTile label="Average losing R" value={formatR(metrics.averageLosingR)} detail={`${metrics.losses} losing outcomes in the full closed sample`} />
        <MetricTile label="Average planned risk" value={metrics.averagePlannedRiskPercentage === null ? "Not enough data" : `${formatDecimal(metrics.averagePlannedRiskPercentage, 2)}%`} detail="Only trades with recorded planned risk percentage" />
        <MetricTile label="Rule compliance" value={formatPercent(metrics.ruleComplianceRate)} detail={`${metrics.ruleComplianceSample} reviewed trades · ${metrics.totalRuleViolations} violations`} />
        <MetricTile label="Closed sample" value={metrics.closedTrades} detail={`${metrics.totalTrades} total trades in the selected population`} />
      </div>
    </section>
  );
}

function BreakdownCurrencySection({
  currencyCode,
  currencyPrecision,
  breakdowns,
  view,
}: {
  currencyCode: string;
  currencyPrecision: number;
  breakdowns: AnalyticsBreakdowns;
  view: Exclude<AnalyticsView, "overview">;
}) {
  const shared = { currencyCode, currencyPrecision };
  return (
    <section className="space-y-4" aria-labelledby={`breakdown-${currencyCode}-${view}`}>
      <div><h2 id={`breakdown-${currencyCode}-${view}`} className="text-xl font-semibold tracking-[-0.025em]">{currencyCode} analysis</h2><p className="mt-1 text-sm text-muted-foreground">Monetary columns are isolated to {currencyCode}; rates use underlying trades.</p></div>
      {view === "instruments" ? <PerformanceBreakdownTable {...shared} title="Performance by instrument" description="Realized outcomes attributed to final close date." rows={breakdowns.instruments} /> : null}
      {view === "strategies" ? <PerformanceBreakdownTable {...shared} title="Performance by strategy" description="Unassigned trades remain visible as their own group." rows={breakdowns.strategies} /> : null}
      {view === "setups" ? <PerformanceBreakdownTable {...shared} title="Performance by setup" description="Setup-level results retain sample sizes and missing assignments." rows={breakdowns.setups} /> : null}
      {view === "sessions" ? <><PerformanceBreakdownTable {...shared} title="Performance by session" description="Asian, London, New York, overlap, and Other use the persisted session classification." rows={breakdowns.sessions} /><PerformanceBreakdownTable {...shared} title="Performance by direction" description="BUY and SELL are recalculated from their underlying closed trades." rows={breakdowns.directions} /></> : null}
      {view === "risk" ? <><PerformanceBreakdownTable {...shared} title="Performance by planned risk" description="Buckets: ≤0.25%, >0.25–0.50%, >0.50–1.00%, and >1.00%; missing risk stays explicit." rows={breakdowns.riskBuckets} /><PerformanceBreakdownTable {...shared} title="Performance by planned R:R" description="Buckets: under 1R, 1R–under 2R, 2R–under 3R, and 3R or more; missing plans remain explicit." rows={breakdowns.plannedRiskRewardBuckets} /><PerformanceBreakdownTable {...shared} title="Performance by actual R" description="Negative, break-even, and positive R buckets use persisted actual R only; missing values are never treated as zero." rows={breakdowns.actualRBuckets} /><PerformanceBreakdownTable {...shared} title="Performance by holding duration" description="Duration groups are based on persisted holding seconds; missing values are not inferred." rows={breakdowns.holdingDurations} /></> : null}
      {view === "time" ? <><PerformanceBreakdownTable {...shared} title="Performance by realized weekday" description="Weekday uses closed_at in the selected display timezone." rows={breakdowns.weekdays} /><PerformanceBreakdownTable {...shared} title="Performance by realized month" description="Monthly performance uses final close date, never open date." rows={breakdowns.months} /><PerformanceBreakdownTable {...shared} title="Performance by hour of entry" description="This explicit entry-timing view uses opened_at; missing entry times remain visible." rows={breakdowns.entryHours} /></> : null}
    </section>
  );
}

export function AnalyticsContent({ dataset, view }: { dataset: AnalyticsDataset; view: AnalyticsView }) {
  if (dataset.selectedAccountCount === 0) {
    return <Card><CardContent className="flex min-h-56 flex-col items-center justify-center text-center"><ChartNoAxesCombined className="size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-medium">No accounts match this selection</p><p className="mt-1 text-sm text-muted-foreground">Reset the filters or create a trading account first.</p></CardContent></Card>;
  }

  if (view === "overview") {
    return (
      <div className="space-y-8">
        {dataset.selectedCurrencyCount > 1 ? <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-4 text-sm"><Scale className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><p><span className="font-medium">Mixed-currency selection.</span> Monetary metrics are separated into {dataset.selectedCurrencyCount} currency sections. Unitless rates below still aggregate the underlying trades.</p></div> : null}
        <UnitlessOverview dataset={dataset} />
        {dataset.currencies.map((currency) => <CurrencyOverview key={currency.currencyCode} currency={currency} />)}
      </div>
    );
  }

  return <div className="space-y-8">{dataset.breakdownsByCurrency.map((item) => <BreakdownCurrencySection key={item.currencyCode} {...item} view={view} />)}</div>;
}
