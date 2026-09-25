import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateKey, summarizePerformance } from "@/domain/journal/analytics";
import { parseDecimal } from "@/domain/money/decimal";
import { PeriodSummary } from "@/features/journal/period-summary";
import { ReviewNavigation } from "@/features/journal/review-navigation";
import { saveDailyLog } from "@/features/journal/actions";
import { SelectField } from "@/features/trades/select-field";
import { createClient } from "@/lib/supabase/server";
import { getTradeJournalDataset } from "@/services/journal/get-trade-journal";

interface DailyPageProps { searchParams: Promise<{ account?: string; date?: string; error?: string; message?: string }> }

export default async function DailyJournalPage({ searchParams }: DailyPageProps) {
  const [query, supabase] = await Promise.all([searchParams, createClient()]);
  const { data: profile } = await supabase.from("profiles").select("timezone").maybeSingle();
  const timezone = profile?.timezone ?? "Africa/Kampala";
  const dataset = await getTradeJournalDataset(supabase, {}, timezone);
  const accountId = query.account ?? dataset.accounts[0]?.id ?? "";
  const day = query.date ?? dateKey(new Date().toISOString(), timezone);
  const account = dataset.trades.find((trade) => trade.accountId === accountId) ?? null;
  const accountRef = accountId ? (await supabase.from("trading_accounts").select("currency_code,currency_precision").eq("id", accountId).maybeSingle()).data : null;
  const realized = dataset.trades.filter((trade) => trade.accountId === accountId && trade.closedAt && dateKey(trade.closedAt, timezone) === day);
  const summary = summarizePerformance(realized, accountRef?.currency_precision ?? account?.currencyPrecision ?? 2);
  const { data: log } = accountId ? await supabase.from("daily_logs").select("*").eq("account_id", accountId).eq("trading_date", day).maybeSingle() : { data: null };
  const violations = realized.reduce((sum, trade) => sum + trade.ruleViolations, 0);
  const executionRatings = realized.map((trade) => trade.executionRating).filter((value): value is number => value !== null);
  const averageExecutionRating = executionRatings.length ? (executionRatings.reduce((sum, value) => sum + value, 0) / executionRatings.length).toFixed(2) : null;
  const revengeTrades = realized.filter((trade) => trade.revengeTrade === true).length;
  const fomoTrades = realized.filter((trade) => trade.fomoInfluenced === true).length;
  const returnPath = `/journal/daily?account=${encodeURIComponent(accountId)}&date=${day}`;

  return <div className="space-y-6"><PageHeader eyebrow="Process journal" title="Daily journal" description="Reflection sits beside realized results attributed to final trade closure." actions={<ReviewNavigation active="daily" />} />
    {query.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{query.error}</p> : null}{query.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{query.message}</p> : null}
    <Card><CardContent className="p-4"><form method="get" className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_auto] md:items-end"><SelectField label="Account" name="account" defaultValue={accountId} items={dataset.accounts.map((item) => ({ value: item.id, label: item.name }))} /><div className="grid gap-2"><Label htmlFor="daily-date">Trading date</Label><Input id="daily-date" type="date" name="date" defaultValue={day} /></div><Button type="submit" variant="outline" className="w-full md:w-auto">Load day</Button></form></CardContent></Card>
    {accountId ? <><PeriodSummary items={[["Trades", summary.trades], ["Wins", summary.wins], ["Losses", summary.losses], ["Break evens", summary.breakEvens], ["Net PnL", `${accountRef?.currency_code ?? account?.currencyCode ?? ""} ${summary.netPnl}`, summary.netPnl.startsWith("-") ? "loss" : "profit"], ["Daily R", `${parseDecimal(summary.totalR).toString()}R`], ["Planned risk", summary.totalPlannedRisk], ["Rule violations", violations], ["Avg execution rating", averageExecutionRating ?? "Not reviewed"], ["Revenge flags", revengeTrades], ["FOMO flags", fomoTrades], ["Day rating", log?.daily_rating ?? "Not rated"]].map(([label, value, tone]) => ({ label: String(label), value: value as string | number, tone: tone as "profit" | "loss" | undefined }))} />
      <Card><CardHeader><CardTitle>{log ? "Update reflection" : "Write reflection"}</CardTitle><CardDescription>One log per account and trading date. Saving again updates the same entry.</CardDescription></CardHeader><CardContent><form action={saveDailyLog} className="grid gap-4 lg:grid-cols-2"><input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="tradingDate" value={day} /><input type="hidden" name="returnPath" value={returnPath} />
        <div className="grid gap-2"><Label htmlFor="marketConditions">Market conditions</Label><Input id="marketConditions" name="marketConditions" defaultValue={log?.market_conditions ?? ""} /></div><div className="grid gap-2"><Label htmlFor="mentalState">Mental state</Label><Input id="mentalState" name="mentalState" defaultValue={log?.mental_state ?? ""} /></div>
        {[["followedDailyPlan","Followed daily plan",log?.followed_daily_plan],["hitDailyLossThreshold","Hit daily loss threshold",log?.hit_daily_loss_threshold],["stoppedWhenRequired","Stopped when required",log?.stopped_when_required]].map(([name,label,value]) => <SelectField key={String(name)} name={String(name)} label={String(label)} defaultValue={value === true ? "YES" : value === false ? "NO" : undefined} items={[{value:"YES",label:"Yes"},{value:"NO",label:"No"}]} />)}
        <div className="grid gap-2"><Label htmlFor="dailyRating">Daily rating (1–5)</Label><Input id="dailyRating" name="dailyRating" type="number" min={1} max={5} defaultValue={log?.daily_rating ?? ""} /></div>
        <div className="grid gap-2 lg:col-span-2"><Label htmlFor="lessons">Lessons</Label><Textarea id="lessons" name="lessons" defaultValue={log?.lessons ?? ""} /></div><div className="grid gap-2 lg:col-span-2"><Label htmlFor="dailyNotes">Notes</Label><Textarea id="dailyNotes" name="notes" defaultValue={log?.notes ?? ""} /></div><div className="lg:col-span-2"><Button type="submit">Save daily journal</Button></div>
      </form></CardContent></Card></> : <Card className="p-8 text-center text-muted-foreground">Create an account before writing a daily journal.</Card>}
  </div>;
}
