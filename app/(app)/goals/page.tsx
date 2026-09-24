import { Flag, Plus, TrendingUp } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createGoal, recordCustomGoalProgress } from "@/features/progress/actions";
import { SelectField } from "@/features/trades/select-field";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProgressDataset } from "@/services/progress/get-progress";
import { GOAL_TYPES } from "@/types/domain";

interface GoalsPageProps { searchParams: Promise<{ account?: string; error?: string; message?: string }> }
const options = GOAL_TYPES.map((item) => ({ value: item, label: item.replaceAll("_", " ") }));

function formatGoalValue(type: string, value: string | null, unit: string | null, currency: string): string {
  if (value === null) return "Unavailable";
  if (type === "ACCOUNT_BALANCE" || type === "MAX_DRAWDOWN_AMOUNT") return `${currency} ${value}`;
  if (type.endsWith("PERCENT")) return `${value}%`;
  if (type === "CUMULATIVE_R") return `${value}R`;
  return `${value}${unit ? ` ${unit}` : ""}`;
}

export default async function GoalsPage({ searchParams }: GoalsPageProps) {
  await requireUserId();
  const [query, supabase] = await Promise.all([searchParams, createClient()]);
  const data = await getProgressDataset(supabase, query.account, true);
  const account = data.account;
  const returnPath = account ? `/goals?account=${encodeURIComponent(account.id)}` : "/goals";
  const now = new Date().toISOString().slice(0, 16);
  return <div className="space-y-6">
    <PageHeader eyebrow="Research milestones" title="Goals & progress" description="Automatic goals follow canonical account data. Custom progress is append-only and manually evidenced." />
    {query.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{query.error}</p> : null}{query.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{query.message}</p> : null}
    <Card><CardContent className="p-4"><form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-64 flex-1"><SelectField label="Account" name="account" defaultValue={account?.id} items={data.accounts.map((item) => ({ value: item.id, label: item.name }))} /></div><Button type="submit" variant="outline">Load goals</Button></form></CardContent></Card>
    {!account ? <Card className="p-10 text-center text-muted-foreground">Create an account before adding goals.</Card> : <>
      <p className="rounded-lg border border-primary/20 bg-primary/8 p-4 text-sm"><strong>Trade-count goals are research sample milestones.</strong> They are not targets requiring extra or lower-quality trades.</p>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.goals.map((goal) => <Card key={goal.id} className={!goal.active ? "opacity-60" : ""}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{goal.title}</CardTitle><CardDescription>{goal.goal_type.replaceAll("_", " ")}</CardDescription></div><Badge variant={goal.achieved_at ? "default" : "secondary"}>{goal.achieved_at ? "Achieved" : goal.active ? "Active" : "Inactive"}</Badge></div></CardHeader><CardContent>
        <div className="flex items-end justify-between gap-3"><p className="font-mono text-2xl font-semibold">{formatGoalValue(goal.goal_type, goal.currentValue, goal.custom_unit, account.currency_code)}</p><p className="text-xs text-muted-foreground">Target {formatGoalValue(goal.goal_type, goal.target_value, goal.custom_unit, account.currency_code)}</p></div>
        {goal.percentage !== null ? <><div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${goal.percentage}%` }} /></div><p className="mt-2 text-right font-mono text-xs text-muted-foreground">{goal.percentage}%</p></> : <p className="mt-3 text-xs text-muted-foreground">{goal.unavailableReason}</p>}
        {goal.goal_type === "CUSTOM" ? <form action={recordCustomGoalProgress} className="mt-5 grid gap-3 border-t border-border/70 pt-4"><input type="hidden" name="goalId" value={goal.id} /><input type="hidden" name="returnPath" value={returnPath} /><div className="grid grid-cols-2 gap-3"><div><Label htmlFor={`progress-${goal.id}`}>Current {goal.custom_unit}</Label><Input id={`progress-${goal.id}`} name="progressValue" defaultValue={goal.currentValue ?? "0"} required /></div><div><Label htmlFor={`recorded-${goal.id}`}>Recorded at</Label><Input id={`recorded-${goal.id}`} name="recordedAt" type="datetime-local" defaultValue={now} required /></div></div><Input name="notes" placeholder="Optional evidence or context" /><Button type="submit" size="sm" variant="outline">Append progress event</Button></form> : null}
      </CardContent></Card>)}{data.goals.length === 0 ? <Card className="p-8 text-center text-muted-foreground md:col-span-2 xl:col-span-3"><Flag className="mx-auto size-7" /><p className="mt-3">No goals for this account.</p></Card> : null}</section>
      <section className="grid items-start gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card><CardHeader><Plus className="size-5 text-primary" /><CardTitle>Create goal</CardTitle><CardDescription>Standard goal progress is derived automatically. Only CUSTOM goals accept manual progress events.</CardDescription></CardHeader><CardContent><form action={createGoal} className="grid gap-4"><input type="hidden" name="accountId" value={account.id} /><input type="hidden" name="returnPath" value={returnPath} /><div><Label htmlFor="goalTitle">Title</Label><Input id="goalTitle" name="title" required placeholder="Build a 100-trade research sample" /></div><SelectField label="Goal type" name="goalType" items={options} required /><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="targetValue">Target value</Label><Input id="targetValue" name="targetValue" required /></div><div><Label htmlFor="targetDate">Target date</Label><Input id="targetDate" name="targetDate" type="date" /></div></div><div><Label htmlFor="customUnit">Custom unit</Label><Input id="customUnit" name="customUnit" placeholder="Required for CUSTOM" /></div><div><Label htmlFor="goalNotes">Notes</Label><Textarea id="goalNotes" name="notes" /></div><Button type="submit">Create goal</Button></form></CardContent></Card>
        <Card><CardHeader><TrendingUp className="size-5 text-primary" /><CardTitle>Practice / research summary</CardTitle><CardDescription>Descriptive evidence only. Missing reviews are excluded rather than interpreted as negative answers.</CardDescription></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[["Closed trades",data.closedTrades],["Reviewed trades",data.reviewedTrades],["Cumulative R",`${data.cumulativeR}R`],["Rule compliance",data.ruleCompliancePercentage ? `${data.ruleCompliancePercentage}%` : "Not reviewed"],["Maximum drawdown",data.maximumDrawdown ? `${account.currency_code} ${data.maximumDrawdown}` : "Unavailable"],["Current balance",`${account.currency_code} ${data.currentBalance}`]].map(([label, value]) => <div key={label} className="rounded-lg border border-border/70 bg-muted/25 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p></div>)}</div>{data.maximumDrawdownUnavailableReason ? <p className="mt-4 text-xs text-muted-foreground">{data.maximumDrawdownUnavailableReason}</p> : null}<div className="mt-5 border-t border-border/70 pt-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setup sample sizes</p><div className="mt-3 flex flex-wrap gap-2">{data.setupSamples.map((item) => <Badge key={item.name} variant="secondary">{item.name}: {item.trades}</Badge>)}{!data.setupSamples.length ? <span className="text-sm text-muted-foreground">No setup samples yet.</span> : null}</div></div></CardContent></Card>
      </section>
    </>}
  </div>;
}
