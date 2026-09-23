import { PageHeader } from "@/components/app/page-header";
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
import { createClient } from "@/lib/supabase/server";
import { getAccountLedger } from "@/services/accounts/get-account-ledger";
import { getTradeJournalDataset } from "@/services/journal/get-trade-journal";

interface MonthlyPageProps { searchParams: Promise<{ account?: string; month?: string; error?: string; message?: string }> }

export default async function MonthlyJournalPage({ searchParams }: MonthlyPageProps) {
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
  const violations = realized.reduce((sum, trade) => sum + trade.ruleViolations, 0);
  const { data: review } = accountId ? await supabase.from("monthly_reviews").select("*").eq("account_id", accountId).eq("month", bounds.start).maybeSingle() : { data: null };
  const returnPath = `/journal/monthly?account=${encodeURIComponent(accountId)}&month=${month}`;

  return <div className="space-y-6"><PageHeader eyebrow="Process review" title="Monthly review" description={`${month} core realized performance and trader reflection.`} actions={<ReviewNavigation active="monthly" />} />
    {query.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{query.error}</p> : null}{query.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{query.message}</p> : null}
    <Card><CardContent className="p-4"><form method="get" className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"><SelectField label="Account" name="account" defaultValue={accountId} items={dataset.accounts.map((item) => ({ value: item.id, label: item.name }))} /><div className="grid gap-2"><Label htmlFor="month">Month</Label><Input id="month" type="month" name="month" defaultValue={month} /></div><Button type="submit" variant="outline">Load month</Button></form></CardContent></Card>
    {ledger ? <><PeriodSummary items={[{label:"Trades",value:summary.trades},{label:"Wins",value:summary.wins},{label:"Losses",value:summary.losses},{label:"Break evens",value:summary.breakEvens},{label:"Win rate",value:summary.winRate?`${summary.winRate}%`:"—"},{label:"Net PnL",value:`${ledger.account.currency_code} ${summary.netPnl}`,tone:summary.netPnl.startsWith("-")?"loss":"profit"},{label:"Total R",value:`${parseDecimal(summary.totalR).toString()}R`},{label:"Violations",value:violations}]} />
      <Card><CardHeader><CardTitle>{review ? "Update monthly review" : "Write monthly review"}</CardTitle><CardDescription>Advanced analytics remain outside Phase 03; this captures the durable core reflection.</CardDescription></CardHeader><CardContent><form action={saveMonthlyReview} className="grid gap-4 lg:grid-cols-2"><input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="month" value={bounds.start} /><input type="hidden" name="returnPath" value={returnPath} />
        {[["whatWorked","What worked",review?.what_worked],["whatDidNot","What did not",review?.what_did_not],["lessons","Lessons",review?.lessons],["focusNextMonth","Focus next month",review?.focus_next_month],["notes","Notes",review?.notes]].map(([name,label,value]) => <div key={String(name)} className={`grid gap-2 ${name === "notes" ? "lg:col-span-2" : ""}`}><Label htmlFor={String(name)}>{label}</Label><Textarea id={String(name)} name={String(name)} defaultValue={String(value ?? "")} /></div>)}<div className="lg:col-span-2"><Button type="submit">Save monthly review</Button></div>
      </form></CardContent></Card></> : <Card className="p-8 text-center text-muted-foreground">Create an account before writing a monthly review.</Card>}
  </div>;
}
