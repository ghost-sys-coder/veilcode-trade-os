import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BehavioralAnalytics, BehavioralCohortMetrics, BehavioralComparison, BehavioralGroup } from "@/domain/analytics/behavior";
import { formatMoney, formatPercent, formatProfitFactor, formatR } from "@/features/analytics/format";
import { MetricTile } from "@/features/analytics/metric-tile";
import type { AnalyticsView } from "@/features/analytics/analytics-navigation";

function CurrencyValues({ metrics }: { metrics: BehavioralCohortMetrics }) {
  if (!metrics.currencies.length) return <span className="text-muted-foreground">Not enough data</span>;
  return <span className="space-y-1">{metrics.currencies.map((currency) => <span key={currency.currencyCode} className="block font-mono tabular-nums">{formatMoney(currency.currencyCode, currency.netPnl, currency.currencyPrecision)}</span>)}</span>;
}

function CurrencyProfitFactors({ metrics }: { metrics: BehavioralCohortMetrics }) {
  if (!metrics.currencies.length) return <span className="text-muted-foreground">Not enough data</span>;
  return <span className="space-y-1">{metrics.currencies.map((currency) => <span key={currency.currencyCode} className="block"><span className="font-medium">{currency.currencyCode}</span> {formatProfitFactor(currency.profitFactor)}</span>)}</span>;
}

function CohortTable({ title, description, rows, showProfitFactor = false }: { title: string; description: string; rows: BehavioralGroup[]; showProfitFactor?: boolean }) {
  const hasData = rows.some((row) => row.metrics.trades > 0);
  return (
    <Card>
      <CardHeader className="border-b border-border/70"><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent className="px-0 pb-0">
        <Table>
          <TableHeader><TableRow><TableHead>Group</TableHead><TableHead className="text-right">Sample</TableHead><TableHead className="text-right">W / L / BE</TableHead><TableHead className="text-right">Win rate</TableHead><TableHead className="text-right">Average R</TableHead><TableHead className="text-right">R expectancy</TableHead><TableHead className="text-right">Net PnL</TableHead>{showProfitFactor ? <TableHead className="text-right">Profit factor</TableHead> : null}</TableRow></TableHeader>
          <TableBody>
            {hasData ? rows.map((row) => <TableRow key={row.key}>
              <TableCell><span className="font-medium">{row.label}</span>{row.description ? <span className="mt-1 block max-w-xl text-xs text-muted-foreground">{row.description}</span> : null}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{row.metrics.trades}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{row.metrics.wins} / {row.metrics.losses} / {row.metrics.breakEvens}</TableCell>
              <TableCell className="text-right"><span className="font-mono tabular-nums">{formatPercent(row.metrics.winRate)}</span><span className="block text-[0.68rem] text-muted-foreground">{row.metrics.winRateSample} decisive</span></TableCell>
              <TableCell className="text-right"><span className="font-mono tabular-nums">{formatR(row.metrics.averageR)}</span><span className="block text-[0.68rem] text-muted-foreground">{row.metrics.rSample} of {row.metrics.trades}</span></TableCell>
              <TableCell className="text-right"><span className="font-mono tabular-nums">{formatR(row.metrics.rExpectancy)}</span><span className="block text-[0.68rem] text-muted-foreground">{row.metrics.rSample} qualifying</span></TableCell>
              <TableCell className="text-right"><CurrencyValues metrics={row.metrics} /></TableCell>
              {showProfitFactor ? <TableCell className="text-right"><CurrencyProfitFactors metrics={row.metrics} /></TableCell> : null}
            </TableRow>) : null}
            {!hasData ? <TableRow><TableCell colSpan={showProfitFactor ? 8 : 7} className="h-32 text-center text-muted-foreground">No completed reviews match this selection.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function comparisonsToGroups(comparisons: BehavioralComparison[]): BehavioralGroup[] {
  return comparisons.flatMap((item) => [
    { ...item.withBehavior, description: item.description },
    item.withoutBehavior,
  ]);
}

function ExecutionView({ analytics }: { analytics: BehavioralAnalytics }) {
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricTile label="Execution reviews" value={analytics.executionReviewedTrades} detail={`${analytics.closedTrades} closed trades in selection`} />
      <MetricTile label="Coverage" value={formatPercent(analytics.closedTrades ? String(analytics.executionReviewedTrades / analytics.closedTrades * 100) : null)} detail="Placeholder rows are excluded" />
      <MetricTile label="Ratings recorded" value={analytics.executionRatings.reduce((total, row) => total + row.metrics.trades, 0)} detail="Within completed execution reviews" />
      <MetricTile label="Stop actions recorded" value={analytics.stopActions.reduce((total, row) => total + row.metrics.trades, 0)} detail="Trade management, not plan correction" />
    </div>
    <CohortTable title="Plan adherence and execution behavior" description="Each pair compares completed execution reviews. Differences are descriptive associations, not causal estimates." rows={comparisonsToGroups(analytics.executionComparisons)} />
    <CohortTable title="Execution rating" description="Discipline rating is grouped independently from financial outcome; R samples remain explicit." rows={analytics.executionRatings} />
    <CohortTable title="Stop management" description="Observed results by the recorded stop-management action." rows={analytics.stopActions} />
    <CohortTable title="Trade quality grades" description="All five canonical grades remain visible in detailed reporting." rows={analytics.grades} />
    <CohortTable title="Trade quality summary" description="A/B = strong process, C = acceptable or mixed, D/F = poor process. Canonical grades are not replaced." rows={analytics.gradeGroups} />
    <CohortTable title="Outcome versus process quality" description="Use this matrix to distinguish good process with a bad result from poor process with a lucky result." rows={analytics.qualityMatrix} />
  </div>;
}

function RulesView({ analytics }: { analytics: BehavioralAnalytics }) {
  const rule = analytics.rules;
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <MetricTile label="Reviewed trades" value={rule.reviewedTrades} detail="Completed immutable snapshots only" />
      <MetricTile label="Fully compliant" value={rule.fullyCompliantTrades} detail="No applicable rule was broken" />
      <MetricTile label="Violations present" value={rule.violationTrades} detail="At least one applicable rule broken" />
      <MetricTile label="Compliance rate" value={formatPercent(rule.complianceRate)} detail={`${rule.reviewedTrades} completed reviews`} />
      <MetricTile label="Individual violations" value={rule.totalViolations} detail="Broken rule results across reviews" />
    </div>
    <CohortTable title="Rule-following versus rule-breaking" description="Prominent observed comparison. Profit factor and net PnL remain separated by account currency." rows={rule.comparison} showProfitFactor />
    <Card>
      <CardHeader className="border-b border-border/70"><CardTitle>Individual rule statistics</CardTitle><CardDescription>Rule names and definitions come from the immutable review snapshot, so later rule edits do not rewrite history.</CardDescription></CardHeader>
      <CardContent className="px-0 pb-0"><Table><TableHeader><TableRow><TableHead>Rule</TableHead><TableHead className="text-right">Evaluated</TableHead><TableHead className="text-right">Followed</TableHead><TableHead className="text-right">Broken</TableHead><TableHead className="text-right">Break rate</TableHead><TableHead className="text-right">Avg R followed</TableHead><TableHead className="text-right">Avg R broken</TableHead><TableHead className="text-right">PnL followed</TableHead><TableHead className="text-right">PnL broken</TableHead></TableRow></TableHeader><TableBody>
        {rule.rules.map((item) => <TableRow key={item.key}><TableCell><span className="font-medium">{item.label}</span><span className="mt-1 block max-w-xl text-xs text-muted-foreground">{item.description}</span></TableCell><TableCell className="text-right font-mono">{item.evaluated}</TableCell><TableCell className="text-right font-mono">{item.followed}</TableCell><TableCell className="text-right font-mono">{item.broken}</TableCell><TableCell className="text-right font-mono">{formatPercent(item.breakRate)}</TableCell><TableCell className="text-right"><span className="font-mono">{formatR(item.followedMetrics.averageR)}</span><span className="block text-[0.68rem] text-muted-foreground">{item.followedMetrics.rSample} R samples</span></TableCell><TableCell className="text-right"><span className="font-mono">{formatR(item.brokenMetrics.averageR)}</span><span className="block text-[0.68rem] text-muted-foreground">{item.brokenMetrics.rSample} R samples</span></TableCell><TableCell className="text-right"><CurrencyValues metrics={item.followedMetrics} /></TableCell><TableCell className="text-right"><CurrencyValues metrics={item.brokenMetrics} /></TableCell></TableRow>)}
        {!rule.rules.length ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No completed rule reviews match this selection.</TableCell></TableRow> : null}
      </TableBody></Table></CardContent>
    </Card>
  </div>;
}

function PsychologyView({ analytics }: { analytics: BehavioralAnalytics }) {
  return <div className="space-y-6">
    <div className="rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground"><span className="font-medium text-foreground">Behavioral self-observation only.</span> These views describe associations in trading records and do not provide medical or psychological assessment.</div>
    <div className="grid gap-4 sm:grid-cols-3"><MetricTile label="Psychology reviews" value={analytics.psychologyReviewedTrades} detail={`${analytics.closedTrades} closed trades in selection`} /><MetricTile label="Emotion samples" value={analytics.emotions.reduce((total, row) => total + row.metrics.trades, 0)} detail="Completed reviews with emotion before trade" /><MetricTile label="Confidence samples" value={analytics.confidence.reduce((total, row) => total + row.metrics.trades, 0)} detail="Completed reviews with confidence recorded" /></div>
    <CohortTable title="Behavioral influence comparisons" description="Yes and no are explicit answers from completed reviews; unanswered drafts are excluded." rows={comparisonsToGroups(analytics.psychologyComparisons)} />
    <CohortTable title="Emotion before trade" description="Performance grouped by the trader's recorded pre-trade state. No predictive claim is made." rows={analytics.emotions} />
    <CohortTable title="Confidence before entry" description="Subjective confidence score 1–5 with qualifying sample size. Confidence is not treated as outcome prediction." rows={analytics.confidence} />
  </div>;
}

function MistakesView({ analytics }: { analytics: BehavioralAnalytics }) {
  const hasReviewedMistakes = analytics.mistakes.some((item) => item.eligibleReviewedTrades > 0);
  return <div className="space-y-6">
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Observed mistake associations</CardTitle><CardDescription>Each mistake uses its eligible completed-review population. Differences describe association only—no counterfactual “cost” or causal claim is calculated.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><Table><TableHeader><TableRow><TableHead>Mistake</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">Reviewed share</TableHead><TableHead className="text-right">With mistake avg R</TableHead><TableHead className="text-right">Without mistake avg R</TableHead><TableHead className="text-right">With mistake PnL</TableHead><TableHead className="text-right">Without mistake PnL</TableHead></TableRow></TableHeader><TableBody>
      {hasReviewedMistakes ? analytics.mistakes.map((item) => <TableRow key={item.key}><TableCell><span className="font-medium">{item.label}</span><span className="mt-1 block max-w-lg text-xs text-muted-foreground">{item.description}</span></TableCell><TableCell className="text-right font-mono">{item.count}</TableCell><TableCell className="text-right"><span className="font-mono">{formatPercent(item.reviewedShare)}</span><span className="block text-[0.68rem] text-muted-foreground">of {item.eligibleReviewedTrades}</span></TableCell><TableCell className="text-right"><span className="font-mono">{formatR(item.withBehavior.metrics.averageR)}</span><span className="block text-[0.68rem] text-muted-foreground">{item.withBehavior.metrics.rSample} R samples</span></TableCell><TableCell className="text-right"><span className="font-mono">{formatR(item.withoutBehavior.metrics.averageR)}</span><span className="block text-[0.68rem] text-muted-foreground">{item.withoutBehavior.metrics.rSample} R samples</span></TableCell><TableCell className="text-right"><CurrencyValues metrics={item.withBehavior.metrics} /></TableCell><TableCell className="text-right"><CurrencyValues metrics={item.withoutBehavior.metrics} /></TableCell></TableRow>) : null}
      {!hasReviewedMistakes ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No completed behavioral reviews match this selection.</TableCell></TableRow> : null}
    </TableBody></Table></CardContent></Card>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Recent lessons learned</CardTitle><CardDescription>Persisted post-trade lessons only; no generated summary.</CardDescription></CardHeader><CardContent className="space-y-3">{analytics.recentLessons.map((lesson) => <Link key={lesson.tradeId} href={`/trades/${lesson.tradeId}`} className="block rounded-lg border border-border/70 p-4 transition-colors hover:bg-muted/40"><span className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(lesson.closedAt))}</span><p className="mt-1 text-sm leading-6">{lesson.lesson}</p></Link>)}{!analytics.recentLessons.length ? <p className="py-10 text-center text-sm text-muted-foreground">No reviewed lessons match this selection.</p> : null}</CardContent></Card>
  </div>;
}

export function BehaviorAnalyticsContent({ analytics, view }: { analytics: BehavioralAnalytics; view: AnalyticsView }) {
  if (view === "execution") return <ExecutionView analytics={analytics} />;
  if (view === "rules") return <RulesView analytics={analytics} />;
  if (view === "psychology") return <PsychologyView analytics={analytics} />;
  return <MistakesView analytics={analytics} />;
}
