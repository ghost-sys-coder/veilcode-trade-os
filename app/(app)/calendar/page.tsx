import Decimal from "decimal.js";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateKey, groupRealizedTradesByDate, summarizePerformance } from "@/domain/journal/analytics";
import { monthBounds } from "@/domain/journal/periods";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import { ReviewNavigation } from "@/features/journal/review-navigation";
import { SelectField } from "@/features/trades/select-field";
import { createClient } from "@/lib/supabase/server";
import { getTradeJournalDataset } from "@/services/journal/get-trade-journal";

interface CalendarPageProps { searchParams: Promise<{ account?: string; month?: string; day?: string }> }

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const [query, supabase] = await Promise.all([searchParams, createClient()]);
  const { data: profile } = await supabase.from("profiles").select("timezone").maybeSingle();
  const timezone = profile?.timezone ?? "Africa/Kampala";
  const dataset = await getTradeJournalDataset(supabase, {}, timezone);
  const accountId = query.account ?? dataset.accounts[0]?.id ?? "";
  const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : dateKey(new Date().toISOString(), timezone).slice(0, 7);
  const bounds = monthBounds(month);
  const today = dateKey(new Date().toISOString(), timezone);
  const account = dataset.trades.find((trade) => trade.accountId === accountId);
  const accountResult = accountId ? await supabase.from("trading_accounts").select("currency_code,currency_precision").eq("id", accountId).maybeSingle() : { data: null };
  const currency = accountResult.data?.currency_code ?? account?.currencyCode ?? "";
  const precision = accountResult.data?.currency_precision ?? account?.currencyPrecision ?? 2;
  const monthTrades = dataset.trades.filter((trade) => trade.accountId === accountId && trade.closedAt && dateKey(trade.closedAt, timezone) >= bounds.start && dateKey(trade.closedAt, timezone) <= bounds.end);
  const grouped = groupRealizedTradesByDate(monthTrades, timezone);
  const selectedDay = query.day && query.day.startsWith(month) ? query.day : today.startsWith(month) ? today : bounds.start;
  const selectedTrades = monthTrades.filter((trade) => trade.closedAt && dateKey(trade.closedAt, timezone) === selectedDay);
  const selectedSummary = summarizePerformance(selectedTrades, precision);
  const { data: dailyLog } = accountId ? await supabase.from("daily_logs").select("*").eq("account_id", accountId).eq("trading_date", selectedDay).maybeSingle() : { data: null };
  const days = Number(bounds.end.slice(-2));
  const firstOffset = (new Date(`${bounds.start}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: firstOffset + days }, (_, index) => index < firstOffset ? null : `${month}-${String(index - firstOffset + 1).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);

  return <div className="space-y-6"><PageHeader eyebrow="Realized performance" title="Trading calendar" description="Daily results are attributed to the final closure date; open trades do not appear in realized totals." actions={<ReviewNavigation active="calendar" />} />
    <Card><CardContent className="p-4"><form method="get" className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_auto] md:items-end"><SelectField label="Account" name="account" defaultValue={accountId} items={dataset.accounts.map((item) => ({ value: item.id, label: item.name }))} /><div className="grid gap-2"><Label htmlFor="calendar-month">Month</Label><Input id="calendar-month" type="month" name="month" defaultValue={month} /></div><Button type="submit" variant="outline" className="w-full md:w-auto">Load calendar</Button></form></CardContent></Card>
    <Card><CardHeader><CardTitle>{new Date(`${bounds.start}T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}</CardTitle><CardDescription>Select a day to inspect its closed trades and journal entry.</CardDescription></CardHeader><CardContent><div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => <div key={day} className="bg-muted px-2 py-2 text-center text-xs font-semibold text-muted-foreground">{day}</div>)}{cells.map((day, index) => {
      if (!day) return <div key={`blank-${index}`} className="min-h-28 bg-card/45" />;
      const trades = grouped.get(day) ?? [];
      const pnl = normalizeMoney(trades.reduce((sum, trade) => sum.plus(parseDecimal(trade.netPnl ?? "0")), new Decimal(0)), precision);
      const wins = trades.filter((trade) => trade.outcome === "WIN" || trade.outcome === "PARTIAL_WIN").length;
      const losses = trades.filter((trade) => trade.outcome === "LOSS" || trade.outcome === "PARTIAL_LOSS").length;
      const tone = parseDecimal(pnl).isPositive() ? "text-profit" : parseDecimal(pnl).isNegative() ? "text-destructive" : "text-muted-foreground";
      return <Link key={day} href={`/calendar?account=${encodeURIComponent(accountId)}&month=${month}&day=${day}`} className={`min-h-28 bg-card p-2 transition-colors hover:bg-muted/70 ${selectedDay === day ? "ring-2 ring-inset ring-primary" : ""}`}><span className="text-xs font-semibold">{Number(day.slice(-2))}</span>{trades.length ? <><p className={`mt-4 font-mono text-sm font-semibold tabular-nums ${tone}`}>{pnl}</p><p className="mt-1 text-[0.68rem] text-muted-foreground">{trades.length} trade{trades.length === 1 ? "" : "s"} · {wins}W/{losses}L</p></> : <p className="mt-4 text-[0.68rem] text-muted-foreground">No closures</p>}</Link>;
    })}</div></CardContent></Card>
    <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]"><Card><CardHeader><CardTitle>{selectedDay} closed trades</CardTitle><CardDescription>{currency} {selectedSummary.netPnl} · {selectedSummary.wins} wins · {selectedSummary.losses} losses · {selectedSummary.breakEvens} break evens</CardDescription></CardHeader><CardContent className="px-0 pb-0"><Table><TableHeader><TableRow><TableHead>Instrument</TableHead><TableHead>Outcome</TableHead><TableHead className="text-right">Net PnL</TableHead><TableHead className="text-right">R</TableHead></TableRow></TableHeader><TableBody>{selectedTrades.map((trade) => <TableRow key={trade.id}><TableCell><Link className="font-semibold hover:text-primary" href={`/trades/${trade.id}`}>{trade.instrumentSymbol}</Link></TableCell><TableCell><Badge variant="secondary">{trade.outcome}</Badge></TableCell><TableCell className="text-right font-mono">{trade.netPnl}</TableCell><TableCell className="text-right font-mono">{trade.actualR ?? "—"}</TableCell></TableRow>)}{selectedTrades.length === 0 ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No trades closed on this date.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>
      <Card><CardHeader><CardTitle>Daily log</CardTitle><CardDescription>{dailyLog ? "Recorded reflection" : "No reflection recorded for this account/day."}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">{dailyLog ? <><p><span className="text-muted-foreground">Market:</span> {dailyLog.market_conditions ?? "—"}</p><p><span className="text-muted-foreground">Mental state:</span> {dailyLog.mental_state ?? "—"}</p><p><span className="text-muted-foreground">Rating:</span> {dailyLog.daily_rating ?? "—"}</p><p className="whitespace-pre-wrap"><span className="text-muted-foreground">Lessons:</span> {dailyLog.lessons ?? "—"}</p></> : null}<Button variant="outline" nativeButton={false} render={<Link href={`/journal/daily?account=${encodeURIComponent(accountId)}&date=${selectedDay}`}>{dailyLog ? "Edit daily log" : "Write daily log"}</Link>} /></CardContent></Card>
    </section>
  </div>;
}
