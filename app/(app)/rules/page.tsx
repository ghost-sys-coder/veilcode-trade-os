import { Gauge, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TradingRuleForm } from "@/features/rules/trading-rule-form";
import { createClient } from "@/lib/supabase/server";

interface RulesPageProps {
  searchParams: Promise<{ error?: string; message?: string }>;
}

export default async function RulesPage({ searchParams }: RulesPageProps) {
  const status = await searchParams;
  const supabase = await createClient();
  const [accountsResult, rulesResult] = await Promise.all([
    supabase.from("trading_accounts").select("*").order("name"),
    supabase.from("trading_rules").select("*").order("name"),
  ]);
  const accounts = accountsResult.data ?? [];
  const rules = rulesResult.data ?? [];
  const error = accountsResult.error ?? rulesResult.error;
  const activeRules = rules.filter((rule) => rule.active).length;
  const measurableRules = rules.filter((rule) => rule.numeric_limit !== null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Risk governance"
        title="Trading rules"
        description="Turn discipline into an explicit operating system with account-scoped, measurable, and behavioral guardrails."
        actions={<a href="#new-rule" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"><Plus className="size-4" aria-hidden="true" />New rule</a>}
      />

      {status.error || error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{status.error ?? error?.message}</p> : null}
      {status.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{status.message}</p> : null}

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Rule summary">
        <Card className="gap-3 p-5"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rulebook</p><ShieldCheck className="size-4 text-primary" aria-hidden="true" /></div><p className="font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums">{rules.length}</p><p className="text-xs text-muted-foreground">Total saved guardrails</p></Card>
        <Card className="gap-3 p-5"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Enforced</p><span className="size-2 rounded-full bg-profit" /></div><p className="font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums text-profit">{activeRules}</p><p className="text-xs text-muted-foreground">Active for future reviews</p></Card>
        <Card className="gap-3 p-5"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Measurable</p><Gauge className="size-4 text-primary" aria-hidden="true" /></div><p className="font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums">{measurableRules}</p><p className="text-xs text-muted-foreground">Rules with numeric thresholds</p></Card>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.75fr)]">
        <Card>
          <CardHeader className="border-b border-border/70"><CardTitle>Rule register</CardTitle><CardDescription>{rules.length} configured rule{rules.length === 1 ? "" : "s"}, including inactive examples retained for reference.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-0">
            <Table><TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Scope</TableHead><TableHead>Type / limit</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Manage</TableHead></TableRow></TableHeader><TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell><p className="font-semibold">{rule.name}</p><p className="mt-0.5 max-w-lg text-xs leading-5 text-muted-foreground">{rule.description}</p></TableCell>
                  <TableCell>{rule.account_id ? accounts.find((account) => account.id === rule.account_id)?.name ?? "Unknown account" : "All accounts"}</TableCell>
                  <TableCell><p className="capitalize">{rule.rule_type.replaceAll("_", " ").toLowerCase()}</p>{rule.numeric_limit ? <p className="mt-0.5 font-mono text-xs font-semibold text-primary">Limit {rule.numeric_limit}</p> : null}</TableCell>
                  <TableCell><Badge variant={rule.active ? "default" : "secondary"}>{rule.active ? "ACTIVE" : rule.is_example ? "EXAMPLE" : "INACTIVE"}</Badge></TableCell>
                  <TableCell className="text-right"><a href={`#edit-rule-${rule.id}`} className="text-xs font-semibold text-primary hover:underline hover:underline-offset-4">Edit</a></TableCell>
                </TableRow>
              ))}
              {rules.length === 0 ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No rules yet. Start with one guardrail you can follow consistently.</TableCell></TableRow> : null}
            </TableBody></Table>
            {rules.length > 0 ? <div className="space-y-2 border-t border-border/70 p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Manage rules</p>{rules.map((rule) => <details key={rule.id} id={`edit-rule-${rule.id}`} className="group scroll-mt-24 rounded-lg border border-border/70 bg-muted/25 open:bg-card"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold"><span>{rule.name}</span><span className="text-xs text-primary group-open:hidden">Edit</span><span className="hidden text-xs text-muted-foreground group-open:inline">Close</span></summary><div className="border-t border-border/70 p-4"><TradingRuleForm accounts={accounts} rule={rule} /></div></details>)}</div> : null}
          </CardContent>
        </Card>

        <Card id="new-rule" className="scroll-mt-24">
          <CardHeader className="border-b border-border/70"><div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><SlidersHorizontal className="size-4" aria-hidden="true" /></div><CardTitle>Create rule</CardTitle><CardDescription>Apply a rule to the whole workspace or scope it to one account.</CardDescription></CardHeader>
          <CardContent><TradingRuleForm accounts={accounts} /></CardContent>
        </Card>
      </section>
    </div>
  );
}
