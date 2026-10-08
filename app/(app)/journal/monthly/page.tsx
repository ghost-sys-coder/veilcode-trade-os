import { PageHeader } from "@/components/app/page-header";
import { OperationFields } from "@/components/app/operation-fields";
import { ReflectionForm } from "@/features/journal/reflection-form";
import { getJournal } from "@/services/application/journals";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateKey, summarizePerformance } from "@/domain/journal/analytics";
import { monthBounds } from "@/domain/journal/periods";
import { parseDecimal } from "@/domain/money/decimal";
import { saveMonthlyReview } from "@/features/journal/actions";
import { PeriodSummary } from "@/features/journal/period-summary";
import { ReviewNavigation } from "@/features/journal/review-navigation";
import { SelectField } from "@/features/trades/select-field";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccountLedger } from "@/services/accounts/get-account-ledger";
import { getTradeJournalDataset } from "@/services/journal/get-trade-journal";

interface MonthlyPageProps { searchParams: Promise<{ account?: string; month?: string; error?: string; message?: string }> }

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7);
}

function reviewedCompliance(trades: Array<{ ruleCompliance: string }>): string | null {
  const reviewed = trades.filter((trade) => trade.ruleCompliance !== "NOT_REVIEWED");
  if (!reviewed.length) return null;
  return (reviewed.filter((trade) => trade.ruleCompliance === "FULLY_COMPLIANT").length / reviewed.length * 100).toFixed(2);
}

function averageExecution(trades: Array<{ executionRating: number | null }>): string | null {
  const values = trades.map((trade) => trade.executionRating).filter((value): value is number => value !== null);
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : null;
}

function tradingDrawdown(trades: Array<{ netPnl: string | null }>): string {
  let current = parseDecimal("0"); let high = current; let maximum = current;
  for (const trade of trades) {
    current = current.plus(trade.netPnl ?? "0");
    if (current.gt(high)) high = current;
    const drawdown = high.minus(current);
    if (drawdown.gt(maximum)) maximum = drawdown;
  }
  return maximum.toFixed(2);
}

export default async function MonthlyJournalPage({ searchParams }: MonthlyPageProps) {
  await requireUserId();
  const [query, supabase] = await Promise.all([searchParams, createClient()]);
  const { data: profile } = await supabase.from("profiles").select("timezone").maybeSingle();
  const timezone = profile?.timezone ?? "Africa/Kampala";
  const dataset = await getTradeJournalDataset(supabase, {}, timezone);
  const accountId = query.account ?? dataset.accounts[0]?.id ?? "";
  const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : dateKey(new Date().toISOString(), timezone).slice(0, 7);
  const bounds = monthBounds(month);
  const ledger = accountId ? await getAccountLedger(supabase, accountId) : null;
  const realized = dataset.trades.filter((trade) => trade.accountId === accountId && trade.closedAt && dateKey(trade.closedAt, timezone) >= bounds.start && dateKey(trade.closedAt, timezone) <= bounds.end);
  const summary = summarizePerformance(realized, ledger?.account.currency_precision ?? 2);
  const previousBounds = monthBounds(previousMonth(month));
  const previousRealized = dataset.trades.filter((trade) => trade.accountId === accountId && trade.closedAt && dateKey(trade.closedAt, timezone) >= previousBounds.start && dateKey(trade.closedAt, timezone) <= previousBounds.end);
  const previousSummary = summarizePerformance(previousRealized, ledger?.account.currency_precision ?? 2);
  const currentOpening = ledger?.timeline.filter((event) => dateKey(event.occurredAt, timezone) < bounds.start).at(-1)?.balance ?? ledger?.account.starting_balance ?? "0";
  const previousOpening = ledger?.timeline.filter((event) => dateKey(event.occurredAt, timezone) < previousBounds.start).at(-1)?.balance ?? ledger?.account.starting_balance ?? "0";
  const currentReturn = parseDecimal(currentOpening).isZero() ? null : parseDecimal(summary.netPnl).div(currentOpening).times(100).toFixed(2);
  const previousReturn = parseDecimal(previousOpening).isZero() ? null : parseDecimal(previousSummary.netPnl).div(previousOpening).times(100).toFixed(2);
  const violations = realized.reduce((sum, trade) => sum + trade.ruleViolations, 0);
  const review = accountId ? (await getJournal(await getVerifiedBrowserContext(supabase),{kind:"MONTHLY",accountId,period:bounds.start})).record : null;
  const returnPath = `/journal/monthly?account=${encodeURIComponent(accountId)}&month=${month}`;

  return <div className="space-y-6"><PageHeader eyebrow="Process review" title="Monthly review" description={`${month} core realized performance and trader reflection.`} actions={<ReviewNavigation active="monthly" />} />
    {query.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{query.error}</p> : null}{query.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{query.message}</p> : null}
    <Card><CardContent className="p-4"><form method="get" className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"><SelectField label="Account" name="account" defaultValue={accountId} items={dataset.accounts.map((item) => ({ value: item.id, label: item.name }))} /><div className="grid gap-2"><Label htmlFor="month">Month</Label><Input id="month" type="month" name="month" defaultValue={month} /></div><Button type="submit" variant="outline">Load month</Button></form></CardContent></Card>
    {ledger ? <><PeriodSummary items={[{label:"Trades",value:summary.trades},{label:"Wins",value:summary.wins},{label:"Losses",value:summary.losses},{label:"Break evens",value:summary.breakEvens},{label:"Win rate",value:summary.winRate?`${summary.winRate}%`:"—"},{label:"Net PnL",value:`${ledger.account.currency_code} ${summary.netPnl}`,tone:summary.netPnl.startsWith("-")?"loss":"profit"},{label:"Total R",value:`${parseDecimal(summary.totalR).toString()}R`},{label:"Violations",value:violations}]} />
      <Card><CardHeader><CardTitle>Month-over-month evidence</CardTitle><CardDescription>Realized results use final closure dates. Drawdown below is trade-only within each month, so cash movements cannot distort it.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border/70 text-left text-xs uppercase tracking-wider text-muted-foreground"><th className="py-3">Metric</th><th className="py-3">{month}</th><th className="py-3">{previousMonth(month)}</th></tr></thead><tbody>{[
        ["Net PnL", `${ledger.account.currency_code} ${summary.netPnl}`, `${ledger.account.currency_code} ${previousSummary.netPnl}`],
        ["Return", currentReturn ? `${currentReturn}%` : "—", previousReturn ? `${previousReturn}%` : "—"],
        ["R expectancy / average R", summary.averageR ? `${summary.averageR}R` : "—", previousSummary.averageR ? `${previousSummary.averageR}R` : "—"],
        ["Trade-only max drawdown", `${ledger.account.currency_code} ${tradingDrawdown(realized)}`, `${ledger.account.currency_code} ${tradingDrawdown(previousRealized)}`],
        ["Rule compliance", reviewedCompliance(realized) ? `${reviewedCompliance(realized)}%` : "Not reviewed", reviewedCompliance(previousRealized) ? `${reviewedCompliance(previousRealized)}%` : "Not reviewed"],
        ["Execution rating", averageExecution(realized) ?? "Not reviewed", averageExecution(previousRealized) ?? "Not reviewed"],
        ["Trades", String(summary.trades), String(previousSummary.trades)],
      ].map(([label, current, previous]) => <tr key={label} className="border-b border-border/50 last:border-0"><td className="py-3 font-medium">{label}</td><td className="py-3 font-mono">{current}</td><td className="py-3 font-mono text-muted-foreground">{previous}</td></tr>)}</tbody></table></CardContent></Card>
      <Card><CardHeader><CardTitle>{review ? "Update monthly review" : "Write monthly review"}</CardTitle><CardDescription>Capture the durable reflection behind the realized month-over-month evidence.</CardDescription></CardHeader><CardContent><ReflectionForm action={saveMonthlyReview} className="grid gap-4 lg:grid-cols-2"><OperationFields expectedVersion={review?.record_version ?? "0"} /><input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="month" value={bounds.start} /><input type="hidden" name="returnPath" value={returnPath} />
        {[["whatWorked","What worked",review?.what_worked],["whatDidNot","What did not",review?.what_did_not],["lessons","Lessons",review?.lessons],["focusNextMonth","Focus next month",review?.focus_next_month],["notes","Notes",review?.notes]].map(([name,label,value]) => <div key={String(name)} className={`grid gap-2 ${name === "notes" ? "lg:col-span-2" : ""}`}><Label htmlFor={String(name)}>{label}</Label><Textarea id={String(name)} name={String(name)} defaultValue={String(value ?? "")} /></div>)}<div className="lg:col-span-2"><Button type="submit">Save monthly review</Button></div>
      </ReflectionForm></CardContent></Card></> : <Card className="p-8 text-center text-muted-foreground">Create an account before writing a monthly review.</Card>}
  </div>;
}
