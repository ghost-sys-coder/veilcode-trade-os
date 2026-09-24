import { ArrowLeft, Landmark, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { classifyAccountAdjustment, createAccountAdjustment } from "@/features/journal/actions";
import { SelectField } from "@/features/trades/select-field";
import { createClient } from "@/lib/supabase/server";
import { getAccountLedger } from "@/services/accounts/get-account-ledger";
import { ADJUSTMENT_TYPES } from "@/types/domain";

interface AccountDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
}

export default async function AccountDetailPage({ params, searchParams }: AccountDetailPageProps) {
  const [{ id }, status, supabase] = await Promise.all([params, searchParams, createClient()]);
  const ledger = await getAccountLedger(supabase, id);
  if (!ledger) notFound();
  const {
    account,
    adjustments,
    adjustmentClassifications,
    timeline,
    derivedBalance,
    netTradingPnl,
    snapshots,
  } = ledger;
  const latestSnapshot = snapshots[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account ledger"
        title={account.name}
        description="A reproducible balance history built from starting capital, closed-trade net PnL, and explicit account adjustments."
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/accounts"><ArrowLeft />Accounts</Link>} />
            <Badge>{account.status}</Badge>
          </div>
        )}
      />
      {status.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{status.error}</p> : null}
      {status.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{status.message}</p> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Account metrics">
        {[
          ["Starting balance", `${account.currency_code} ${account.starting_balance}`],
          ["Derived balance", `${account.currency_code} ${derivedBalance}`],
          ["Net trading PnL", `${account.currency_code} ${netTradingPnl}`],
          ["Latest equity", latestSnapshot?.equity ? `${account.currency_code} ${latestSnapshot.equity}` : "No snapshot"],
        ].map(([label, value]) => (
          <Card key={label} className="gap-2 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
            <p className="font-mono text-xl font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.6fr)]">
        <Card>
          <CardHeader className="border-b border-border/70">
            <CardTitle>Balance timeline</CardTitle>
            <CardDescription>Trades enter the ledger only on final closure. Equal timestamps use deterministic ordering.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Event</TableHead><TableHead className="text-right">Change</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {timeline.map((event) => (
                  <TableRow key={`${event.kind}-${event.id}`}>
                    <TableCell className="whitespace-nowrap">{new Date(event.occurredAt).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="secondary">{event.kind}</Badge><span className="ml-2 capitalize">{event.label}</span></TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{event.kind === "START" ? "—" : event.amount}</TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">{account.currency_code} {event.balance}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="border-b border-border/70"><Landmark className="size-5 text-primary" /><CardTitle>Account context</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-muted-foreground">Type</p><p className="mt-1 font-medium">{account.account_type.replaceAll("_", " ")}</p></div>
              <div><p className="text-xs text-muted-foreground">Broker</p><p className="mt-1 font-medium">{account.broker_name ?? "Not recorded"}</p></div>
              <div><p className="text-xs text-muted-foreground">Platform</p><p className="mt-1 font-medium">{account.platform}</p></div>
              <div><p className="text-xs text-muted-foreground">Started</p><p className="mt-1 font-medium">{new Date(account.started_at).toLocaleDateString()}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b border-border/70">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><Plus className="size-4" /></div>
              <CardTitle>Record adjustment</CardTitle>
              <CardDescription>Cash events stay separate from trading performance.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createAccountAdjustment} className="space-y-4">
                <input type="hidden" name="accountId" value={account.id} />
                <input type="hidden" name="returnPath" value={`/accounts/${account.id}`} />
                <SelectField label="Type" name="type" required items={ADJUSTMENT_TYPES.map((value) => ({ value, label: value.replaceAll("_", " ") }))} />
                <div className="grid gap-2"><Label htmlFor="adjustment-amount">Amount</Label><Input id="adjustment-amount" name="amount" inputMode="decimal" placeholder="500.00" required /></div>
                <div className="grid gap-2"><Label htmlFor="adjustment-occurred">Occurred at</Label><Input id="adjustment-occurred" name="occurredAt" type="datetime-local" required /></div>
                <SelectField label="OTHER treatment" name="isPerformanceNeutral" items={[{ value: "YES", label: "Performance-neutral cash movement" }, { value: "NO", label: "Performance-affecting adjustment" }]} help="Required only for OTHER. Fixed adjustment types are always performance-neutral." />
                <div className="grid gap-2"><Label htmlFor="adjustment-classification-reason">Classification reason</Label><Textarea id="adjustment-classification-reason" name="classificationReason" placeholder="Required for OTHER adjustments" /></div>
                <div className="grid gap-2"><Label htmlFor="adjustment-notes">Notes</Label><Textarea id="adjustment-notes" name="notes" placeholder="Required for balance corrections" /></div>
                <Button type="submit" className="w-full">Record adjustment</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader className="border-b border-border/70">
          <CardTitle>Account adjustments</CardTitle>
          <CardDescription>{adjustments.length ? `${adjustments.length} explicit ledger event${adjustments.length === 1 ? "" : "s"}. Performance treatment is stored separately from the cash event.` : "No manual adjustments have been recorded."}</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Performance treatment</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {adjustments.map((adjustment) => (
                <TableRow key={adjustment.id} className="align-top">
                  <TableCell className="whitespace-nowrap">{new Date(adjustment.occurred_at).toLocaleString()}</TableCell>
                  <TableCell>{adjustment.type.replaceAll("_", " ")}</TableCell>
                  <TableCell className="min-w-72">
                    {adjustment.is_performance_neutral === null
                      ? <Badge variant="outline">Classification required</Badge>
                      : <Badge variant="secondary">{adjustment.is_performance_neutral ? "Performance-neutral" : "Performance-affecting"}</Badge>}
                    {adjustment.type === "OTHER" ? (
                      <form action={classifyAccountAdjustment} className="mt-3 grid gap-2">
                        <input type="hidden" name="accountId" value={account.id} />
                        <input type="hidden" name="adjustmentId" value={adjustment.id} />
                        <input type="hidden" name="returnPath" value={`/accounts/${account.id}`} />
                        <SelectField label="Set treatment" name="isPerformanceNeutral" required items={[{ value: "YES", label: "Performance-neutral" }, { value: "NO", label: "Performance-affecting" }]} />
                        <div className="grid gap-2"><Label htmlFor={`reason-${adjustment.id}`}>Reason</Label><Input id={`reason-${adjustment.id}`} name="reason" minLength={5} required placeholder="Why this interpretation is correct" /></div>
                        <Button type="submit" variant="outline" size="sm" className="justify-self-start">{adjustment.is_performance_neutral === null ? "Classify" : "Change classification"}</Button>
                      </form>
                    ) : null}
                  </TableCell>
                  <TableCell>{adjustment.notes ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{account.currency_code} {adjustment.amount}</TableCell>
                </TableRow>
              ))}
              {adjustments.length === 0 ? <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No adjustments. Add one only when money moves independently of a trade.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/70"><CardTitle>Classification history</CardTitle><CardDescription>Append-only audit history for changes to OTHER adjustment interpretation.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader><TableRow><TableHead>Changed at</TableHead><TableHead>Adjustment</TableHead><TableHead>Previous</TableHead><TableHead>New</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
            <TableBody>
              {adjustmentClassifications.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap">{new Date(item.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{item.adjustment_id.slice(0, 8)}</TableCell>
                  <TableCell>{item.previous_is_performance_neutral === null ? "Unclassified" : item.previous_is_performance_neutral ? "Neutral" : "Performance-affecting"}</TableCell>
                  <TableCell>{item.new_is_performance_neutral ? "Neutral" : "Performance-affecting"}</TableCell>
                  <TableCell>{item.reason}</TableCell>
                </TableRow>
              ))}
              {adjustmentClassifications.length === 0 ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No classification changes have been recorded.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
