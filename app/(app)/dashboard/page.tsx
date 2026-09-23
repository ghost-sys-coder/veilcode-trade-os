import {
  ArrowRight,
  ChartNoAxesCombined,
  Check,
  CircleDashed,
  Landmark,
  ShieldCheck,
  Target,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { getAccountsWithDerivedBalances } from "@/services/accounts/get-account-balances";

export default async function DashboardPage() {
  const supabase = await createClient();
  const [accountsResult, strategiesResult, setupsResult, rulesResult] = await Promise.all([
    supabase.from("trading_accounts").select("*").order("created_at"),
    supabase.from("strategies").select("id, active"),
    supabase.from("setups").select("id, active"),
    supabase.from("trading_rules").select("id, name, active, is_example").order("name"),
  ]);
  const error = accountsResult.error ?? strategiesResult.error ?? setupsResult.error ?? rulesResult.error;
  const accounts = accountsResult.data
    ? await getAccountsWithDerivedBalances(supabase, accountsResult.data)
    : [];
  const strategies = strategiesResult.data ?? [];
  const setups = setupsResult.data ?? [];
  const rules = rulesResult.data ?? [];
  const activeStrategies = strategies.filter((strategy) => strategy.active).length;
  const activeRules = rules.filter((rule) => rule.active).length;
  const currentAccount = accounts.find((account) => account.status === "ACTIVE") ?? accounts[0];
  const readinessItems = [
    { label: "Trading account configured", complete: accounts.length > 0 },
    { label: "At least one active strategy", complete: activeStrategies > 0 },
    { label: "At least one repeatable setup", complete: setups.some((setup) => setup.active) },
    { label: "Trading rules activated", complete: activeRules > 0 },
  ];
  const completedItems = readinessItems.filter((item) => item.complete).length;
  const readiness = Math.round((completedItems / readinessItems.length) * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command center"
        title="Performance foundation"
        description="Build the reference system your journal and analytics will rely on. Every value below comes from your saved workspace."
        actions={
          <Button render={<Link href="/accounts" />}>
            Manage accounts
            <ArrowRight data-icon="inline-end" />
          </Button>
        }
      />

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
          Database setup is not available: {error.message}
        </p>
      ) : null}

      <section aria-label="Workspace metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Derived balance"
          value={currentAccount ? `${currentAccount.currency_code} ${currentAccount.derived_balance}` : "—"}
          detail={currentAccount ? `${currentAccount.name} · reproducible ledger balance` : "Create an account to establish a balance"}
          icon={<WalletCards className="size-5" aria-hidden="true" />}
          emphasis={currentAccount ? "positive" : "default"}
        />
        <StatCard
          label="Trading accounts"
          value={accounts.length}
          detail="Demo, prop, funded, and personal accounts"
          icon={<Landmark className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Active strategies"
          value={activeStrategies}
          detail={`${strategies.length} total methodologies in your library`}
          icon={<ChartNoAxesCombined className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Active rules"
          value={activeRules}
          detail={`${rules.length} total behavioral and measurable guardrails`}
          icon={<ShieldCheck className="size-5" aria-hidden="true" />}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.7fr)]">
        <Card>
          <CardHeader className="border-b border-border/70">
            <CardTitle>Workspace readiness</CardTitle>
            <CardDescription>Foundation coverage before manual trade logging begins.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-4xl font-semibold tracking-[-0.05em] tabular-nums">{readiness}%</p>
                <p className="mt-1 text-xs text-muted-foreground">{completedItems} of {readinessItems.length} foundation layers ready</p>
              </div>
              <span className="text-xs font-semibold text-primary">Phase 01</span>
            </div>
            <div className="mb-6 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${readiness}%` }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {readinessItems.map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/35 p-3.5">
                  <span className={item.complete ? "flex size-7 items-center justify-center rounded-md bg-profit/12 text-profit" : "flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground"}>
                    {item.complete ? <Check className="size-4" aria-hidden="true" /> : <CircleDashed className="size-4" aria-hidden="true" />}
                  </span>
                  <p className="text-sm font-medium">{item.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/70">
            <CardTitle>Current account</CardTitle>
            <CardDescription>{currentAccount ? "Primary active workspace" : "No account selected"}</CardDescription>
          </CardHeader>
          <CardContent>
            {currentAccount ? (
              <dl className="divide-y divide-border/70 text-sm">
                <div className="flex items-center justify-between gap-4 py-3 first:pt-0"><dt className="text-muted-foreground">Account</dt><dd className="font-semibold">{currentAccount.name}</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-muted-foreground">Type</dt><dd>{currentAccount.account_type.replaceAll("_", " ")}</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-muted-foreground">Platform</dt><dd>{currentAccount.platform}</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-muted-foreground">Currency</dt><dd>{currentAccount.currency_code}</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-muted-foreground">Starting balance</dt><dd className="font-mono tabular-nums">{currentAccount.starting_balance}</dd></div>
                <div className="flex items-center justify-between gap-4 pt-3"><dt className="text-muted-foreground">Derived balance</dt><dd className="font-mono font-semibold tabular-nums text-profit">{currentAccount.derived_balance}</dd></div>
              </dl>
            ) : (
              <div className="py-8 text-center">
                <Target className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Create your first account</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Your reproducible balance and account context will appear here.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card>
          <CardHeader className="border-b border-border/70">
            <CardTitle>Account register</CardTitle>
            <CardDescription>Derived balances use starting balance, closed-trade net PnL, and adjustments.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Derived balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {accounts.slice(0, 5).map((account) => (
                  <TableRow key={account.id}>
                    <TableCell><p className="font-semibold">{account.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{account.broker_name ?? account.platform}</p></TableCell>
                    <TableCell>{account.account_type.replaceAll("_", " ")}</TableCell>
                    <TableCell><Badge variant="secondary">{account.status}</Badge></TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">{account.currency_code} {account.derived_balance}</TableCell>
                  </TableRow>
                ))}
                {accounts.length === 0 ? <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">No accounts configured yet.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/70">
            <CardTitle>Rule discipline</CardTitle>
            <CardDescription>Rules prepared for future trade reviews.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rules.slice(0, 5).map((rule, index) => (
              <div key={rule.id} className="flex items-center gap-3 border-b border-border/60 pb-3 last:border-0 last:pb-0">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs text-muted-foreground">{index + 1}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{rule.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{rule.active ? "Active" : rule.is_example ? "Example · inactive" : "Inactive"}</p></div>
                <span className={rule.active ? "size-2 rounded-full bg-profit" : "size-2 rounded-full bg-border"} />
              </div>
            ))}
            {rules.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No rules configured yet.</p> : null}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
