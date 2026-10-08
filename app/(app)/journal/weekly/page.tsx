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
import { addDays, weekStart } from "@/domain/journal/periods";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import { saveWeeklyReview } from "@/features/journal/actions";
import { PeriodSummary } from "@/features/journal/period-summary";
import { ReviewNavigation } from "@/features/journal/review-navigation";
import { SelectField } from "@/features/trades/select-field";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccountLedger } from "@/services/accounts/get-account-ledger";
import { getTradeJournalDataset } from "@/services/journal/get-trade-journal";

interface WeeklyPageProps { searchParams: Promise<{ account?: string; week?: string; error?: string; message?: string }> }

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function setupByAverageR(trades: Array<{ setupName: string | null; actualR: string | null }>) {
  const groups = new Map<string, { total: ReturnType<typeof parseDecimal>; count: number }>();
  for (const trade of trades) {
    if (!trade.setupName || trade.actualR === null) continue;
    const current = groups.get(trade.setupName) ?? { total: parseDecimal("0"), count: 0 };
    groups.set(trade.setupName, { total: current.total.plus(trade.actualR), count: current.count + 1 });
  }
  const ranked = [...groups.entries()]
    .map(([name, value]) => ({ name, average: value.total.div(value.count) }))
    .toSorted((left, right) => left.average.comparedTo(right.average));
  return { best: ranked.at(-1) ?? null, worst: ranked[0] ?? null };
}

export default async function WeeklyJournalPage({ searchParams }: WeeklyPageProps) {
  await requireUserId();
  const [query, supabase] = await Promise.all([searchParams, createClient()]);
  const { data: profile } = await supabase.from("profiles").select("timezone").maybeSingle();
  const timezone = profile?.timezone ?? "Africa/Kampala";
  const dataset = await getTradeJournalDataset(supabase, {}, timezone);
  const accountId = query.account ?? dataset.accounts[0]?.id ?? "";
  const start = weekStart(query.week ?? dateKey(new Date().toISOString(), timezone));
  const end = addDays(start, 6);
  const ledger = accountId ? await getAccountLedger(supabase, accountId) : null;
  const realized = dataset.trades.filter((trade) => trade.accountId === accountId && trade.closedAt && dateKey(trade.closedAt, timezone) >= start && dateKey(trade.closedAt, timezone) <= end);
  const summary = summarizePerformance(realized, ledger?.account.currency_precision ?? 2);
  const before = ledger?.timeline.filter((event) => dateKey(event.occurredAt, timezone) < start).at(-1)?.balance ?? ledger?.account.starting_balance ?? "0";
  const after = ledger?.timeline.filter((event) => dateKey(event.occurredAt, timezone) <= end).at(-1)?.balance ?? before;
  const returnPercent = parseDecimal(before).isZero() ? null : parseDecimal(summary.netPnl).div(before).times(100).toFixed(2);
  const ordered = [...realized].sort((a, b) => parseDecimal(a.netPnl ?? "0").comparedTo(parseDecimal(b.netPnl ?? "0")) || a.id.localeCompare(b.id));
  const best = ordered.at(-1); const worst = ordered[0];
  const violations = realized.reduce((sum, trade) => sum + trade.ruleViolations, 0);
  const executionRatings = realized.map((trade) => trade.executionRating).filter((value): value is number => value !== null);
  const averageExecutionRating = executionRatings.length ? (executionRatings.reduce((sum, value) => sum + value, 0) / executionRatings.length).toFixed(2) : null;
  const mostCommonMistake = mostCommon(realized.flatMap((trade) => trade.mistakes));
  const mostBrokenRule = mostCommon(realized.flatMap((trade) => trade.ruleViolationNames));
  const mostTradedInstrument = mostCommon(realized.map((trade) => trade.instrumentSymbol));
  const setupPerformance = setupByAverageR(realized);
  const riskValues = realized.map((trade) => trade.plannedRiskPercentage).filter((value): value is string => value !== null);
  const averageRisk = riskValues.length ? riskValues.reduce((sum, value) => sum.plus(value), parseDecimal("0")).div(riskValues.length).toFixed(2) : null;
  const review = accountId ? (await getJournal(await getVerifiedBrowserContext(supabase),{kind:"WEEKLY",accountId,period:start})).record : null;
  const returnPath = `/journal/weekly?account=${encodeURIComponent(accountId)}&week=${start}`;

  return <div className="space-y-6"><PageHeader eyebrow="Process review" title="Weekly review" description={`${start} through ${end}. Realized performance follows final closure dates.`} actions={<ReviewNavigation active="weekly" />} />
    {query.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{query.error}</p> : null}{query.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{query.message}</p> : null}
    <Card><CardContent className="p-4"><form method="get" className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"><SelectField label="Account" name="account" defaultValue={accountId} items={dataset.accounts.map((item) => ({ value: item.id, label: item.name }))} /><div className="grid gap-2"><Label htmlFor="week">Week containing</Label><Input id="week" type="date" name="week" defaultValue={start} /></div><Button type="submit" variant="outline">Load week</Button></form></CardContent></Card>
    {ledger ? <><PeriodSummary items={[{label:"Starting balance",value:`${ledger.account.currency_code} ${normalizeMoney(before, ledger.account.currency_precision)}`},{label:"Ending balance",value:`${ledger.account.currency_code} ${normalizeMoney(after, ledger.account.currency_precision)}`},{label:"Net PnL",value:`${ledger.account.currency_code} ${summary.netPnl}`,tone:summary.netPnl.startsWith("-")?"loss":"profit"},{label:"Return",value:returnPercent === null?"—":`${returnPercent}%`},{label:"Trades",value:summary.trades},{label:"Win rate",value:summary.winRate?`${summary.winRate}%`:"—"},{label:"Average R",value:summary.averageR?`${summary.averageR}R`:"—"},{label:"Average risk",value:averageRisk?`${averageRisk}%`:"Not recorded"},{label:"Most traded instrument",value:mostTradedInstrument ?? "No trades"},{label:"Best setup",value:setupPerformance.best ? `${setupPerformance.best.name} · ${setupPerformance.best.average.toFixed(2)}R` : "No R sample"},{label:"Worst setup",value:setupPerformance.worst ? `${setupPerformance.worst.name} · ${setupPerformance.worst.average.toFixed(2)}R` : "No R sample"},{label:"Violations",value:violations},{label:"Avg execution rating",value:averageExecutionRating ?? "Not reviewed"},{label:"Most common mistake",value:mostCommonMistake ?? "None reviewed"},{label:"Most broken rule",value:mostBrokenRule ?? "None reviewed"}]} />
      <Card><CardContent className="grid gap-4 p-5 md:grid-cols-2"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Best trade</p><p className="mt-1 font-semibold">{best ? `${best.instrumentSymbol} · ${best.netPnl} ${best.currencyCode}` : "No realized trade"}</p></div><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Worst trade</p><p className="mt-1 font-semibold">{worst ? `${worst.instrumentSymbol} · ${worst.netPnl} ${worst.currencyCode}` : "No realized trade"}</p></div><p className="text-sm text-muted-foreground md:col-span-2">Wins {summary.wins} · Losses {summary.losses} · Break evens {summary.breakEvens} · Total R {parseDecimal(summary.totalR).toString()}R</p></CardContent></Card>
      <Card><CardHeader><CardTitle>{review ? "Update weekly review" : "Write weekly review"}</CardTitle><CardDescription>One review per account and Monday-based week.</CardDescription></CardHeader><CardContent><ReflectionForm action={saveWeeklyReview} className="grid gap-4 lg:grid-cols-2"><OperationFields expectedVersion={review?.record_version ?? "0"} /><input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="weekStart" value={start} /><input type="hidden" name="returnPath" value={returnPath} />
        {[["whatWorked","What worked",review?.what_worked],["whatDidNot","What did not",review?.what_did_not],["changeNextWeek","Change next week",review?.change_next_week],["behaviorToStop","Behavior to stop",review?.behavior_to_stop],["behaviorToContinue","Behavior to continue",review?.behavior_to_continue],["notes","Notes",review?.notes]].map(([name,label,value]) => <div key={String(name)} className="grid gap-2"><Label htmlFor={String(name)}>{label}</Label><Textarea id={String(name)} name={String(name)} defaultValue={String(value ?? "")} /></div>)}<div className="lg:col-span-2"><Button type="submit">Save weekly review</Button></div>
      </ReflectionForm></CardContent></Card></> : <Card className="p-8 text-center text-muted-foreground">Create an account before writing a weekly review.</Card>}
  </div>;
}
