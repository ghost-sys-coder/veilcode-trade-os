import { ArrowRight, BarChart3, Landmark, Plus } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BalancePerformanceChart, DrawdownChart } from "@/features/analytics/performance-charts";
import { formatCurrentStreak, formatMoney, formatPercent, formatProfitFactor, formatR } from "@/features/analytics/format";
import { MetricTile } from "@/features/analytics/metric-tile";
import { createClient } from "@/lib/supabase/server";
import { getPerformanceAnalytics } from "@/services/analytics/get-performance-analytics";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: accountRows, error: accountsError } = await supabase
    .from("trading_accounts")
    .select("id,name,status")
    .order("created_at");
  const currentAccount = accountRows?.find((account) => account.status === "ACTIVE") ?? accountRows?.[0];
  const dataset = await getPerformanceAnalytics(supabase, currentAccount ? { account: currentAccount.id } : {});
  const currency = dataset.currencies[0];
  const metrics = dataset.unitlessMetrics;
  const netPnlTone = currency?.metrics.netProfit.startsWith("-")
    ? "loss" as const
    : currency?.metrics.netProfit === "0" || /^0\.0+$/.test(currency?.metrics.netProfit ?? "")
      ? "default" as const
      : "profit" as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command center"
        title={currentAccount ? currentAccount.name : "Trading performance"}
        description="A realized-performance view built from final trade closures, decimal-safe PnL, and the reproducible account ledger."
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/accounts"><Landmark />Accounts</Link>} />
            <Button nativeButton={false} render={<Link href="/trades/new"><Plus />Log trade</Link>} />
          </div>
        )}
      />

      {accountsError ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">Database setup is not available: {accountsError.message}</p> : null}

      {!currentAccount || !currency ? (
        <Card><CardContent className="flex min-h-72 flex-col items-center justify-center text-center"><BarChart3 className="size-9 text-muted-foreground" aria-hidden="true" /><p className="mt-4 text-lg font-semibold">Create an account to start measuring performance</p><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">The dashboard will calculate realized PnL, R expectancy, balance drawdown, and streaks from persisted trades.</p><Button className="mt-5" nativeButton={false} render={<Link href="/accounts">Create account<ArrowRight /></Link>} /></CardContent></Card>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Current account performance">
            <MetricTile label="Current balance" value={formatMoney(currency.currencyCode, currency.currentBalance, currency.currencyPrecision)} detail="Reproducible ledger balance" />
            <MetricTile label="Net PnL" value={formatMoney(currency.currencyCode, currency.metrics.netProfit, currency.currencyPrecision)} detail={`${currency.metrics.closedTrades} closed trades · adjustments excluded`} tone={netPnlTone} />
            <MetricTile label="Return" value={formatPercent(currency.returnPercentage)} detail="Net trading PnL ÷ balance basis" />
            <MetricTile label="Closed trades" value={currency.metrics.closedTrades} detail={`${currency.metrics.wins} wins · ${currency.metrics.losses} losses · ${currency.metrics.breakEvens} break-even`} />
            <MetricTile label="Win rate" value={formatPercent(metrics.winRate)} detail={`${metrics.wins} of ${metrics.winRateSample} decisive trades`} />
            <MetricTile label="Profit factor" value={formatProfitFactor(currency.metrics.profitFactor)} detail={`${formatMoney(currency.currencyCode, currency.metrics.grossProfit, currency.currencyPrecision)} gross profit`} />
            <MetricTile label="R expectancy" value={formatR(metrics.rExpectancy)} detail={`${metrics.rSample} of ${metrics.closedTrades} closed trades`} />
            <MetricTile label="Average R" value={formatR(metrics.averageR)} detail={`Cross-check ${formatR(metrics.rDistributionCrossCheck)}`} />
            <MetricTile label="Maximum drawdown" value={currency.curve.available ? formatMoney(currency.currencyCode, currency.curve.maximumAmount, currency.currencyPrecision) : "Unavailable"} detail={currency.curve.available ? formatPercent(currency.curve.maximumPercentage) : `${currency.curve.unclassifiedAdjustmentCount} adjustment classifications required`} tone={currency.curve.available ? "loss" : "default"} />
            <MetricTile label="Current streak" value={formatCurrentStreak(metrics.streaks)} detail={`Maximum ${metrics.streaks.maximumWinning}W · ${metrics.streaks.maximumLosing}L`} />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card><CardHeader className="border-b border-border/70"><CardTitle>Balance trajectory</CardTitle><CardDescription>Balance and cumulative trading PnL at final trade closure.</CardDescription></CardHeader><CardContent><BalancePerformanceChart points={currency.curve.points} currencyCode={currency.currencyCode} currencyPrecision={currency.currencyPrecision} /></CardContent></Card>
            <Card><CardHeader className="border-b border-border/70"><CardTitle>Realized balance drawdown</CardTitle><CardDescription>Cash-flow-neutral high-water-mark drawdown, separate from optional equity snapshots.</CardDescription></CardHeader><CardContent><DrawdownChart points={currency.curve.points} currencyCode={currency.currencyCode} currencyPrecision={currency.currencyPrecision} /></CardContent></Card>
          </section>

          <div className="flex justify-end"><Button variant="outline" nativeButton={false} render={<Link href={`/analytics/overview?account=${currentAccount.id}`}>Open full analytics<ArrowRight /></Link>} /></div>
        </>
      )}
    </div>
  );
}
