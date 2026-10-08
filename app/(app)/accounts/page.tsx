import { Landmark, Plus, WalletCards } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountForm } from "@/features/accounts/account-form";
import { createClient } from "@/lib/supabase/server";
import { listBrowserAccounts } from "@/services/application/accounts";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { ApplicationWorkflowError } from "@/services/application/transaction";
import type { ApplicationAccount } from "@/domain/accounts/commands";

interface AccountsPageProps {
  searchParams: Promise<{ error?: string; message?: string }>;
}

export default async function AccountsPage({ searchParams }: AccountsPageProps) {
  const status = await searchParams;
  const supabase = await createClient();
  let accounts:ApplicationAccount[]=[];
  let error:string|null=null;
  try {accounts=await listBrowserAccounts(await getVerifiedBrowserContext(supabase));}
  catch(cause) {error=cause instanceof ApplicationWorkflowError?cause.message:"Unable to load accounts. Check your session and reload.";}
  const activeAccounts = accounts.filter((account) => account.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capital structure"
        title="Trading accounts"
        description="Keep each account's currency, starting capital, and operating context explicit. Derived balance remains the authoritative performance value."
        actions={
          <a href="#new-account" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
            <Plus className="size-4" aria-hidden="true" />
            New account
          </a>
        }
      />

      {status.error || error ? (
        <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
          {status.error ?? error}
        </p>
      ) : null}
      {status.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{status.message}</p> : null}

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Account summary">
        <Card className="gap-3 p-5">
          <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Configured</p><Landmark className="size-4 text-primary" aria-hidden="true" /></div>
          <p className="font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums">{accounts.length}</p>
          <p className="text-xs text-muted-foreground">Total account records</p>
        </Card>
        <Card className="gap-3 p-5">
          <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Active</p><span className="size-2 rounded-full bg-profit" /></div>
          <p className="font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums text-profit">{activeAccounts}</p>
          <p className="text-xs text-muted-foreground">Currently operating</p>
        </Card>
        <Card className="gap-3 p-5">
          <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Balance model</p><WalletCards className="size-4 text-primary" aria-hidden="true" /></div>
          <p className="text-lg font-semibold tracking-tight">Ledger derived</p>
          <p className="text-xs text-muted-foreground">Start + closed PnL + adjustments</p>
        </Card>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.75fr)]">
        <Card>
          <CardHeader className="border-b border-border/70">
            <CardTitle>Account register</CardTitle>
            <CardDescription>{accounts.length} configured account{accounts.length === 1 ? "" : "s"}, each kept in its own currency precision.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Derived balance</TableHead><TableHead className="w-24 text-right">Manage</TableHead></TableRow></TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell><Link href={`/accounts/${account.id}`} className="font-semibold hover:text-primary hover:underline">{account.name}</Link><p className="mt-0.5 text-xs text-muted-foreground">{account.broker_name ?? account.platform} · {account.currency_code}</p></TableCell>
                    <TableCell className="capitalize">{account.account_type.replaceAll("_", " ").toLowerCase()}</TableCell>
                    <TableCell><Badge variant={account.status === "ACTIVE" ? "default" : "secondary"}>{account.status}</Badge></TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">{account.currency_code} {account.derived_balance}</TableCell>
                    <TableCell className="text-right"><Link href={`/accounts/${account.id}`} className="text-xs font-semibold text-primary hover:underline hover:underline-offset-4">View</Link></TableCell>
                  </TableRow>
                ))}
                {accounts.length === 0 ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No accounts yet. Use the form to create your first account.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
            {accounts.length > 0 ? (
              <div className="space-y-2 border-t border-border/70 p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Manage account records</p>
                {accounts.map((account) => (
                  <details key={account.id} id={`edit-${account.id}`} className="group scroll-mt-24 rounded-lg border border-border/70 bg-muted/25 open:bg-card">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold"><span>{account.name}</span><span className="text-xs text-primary group-open:hidden">Edit</span><span className="hidden text-xs text-muted-foreground group-open:inline">Close</span></summary>
                    <div className="border-t border-border/70 p-4"><p className="mb-4 text-xs text-muted-foreground">Changes update this account&apos;s current configuration.</p><AccountForm account={account} /></div>
                  </details>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card id="new-account" className="scroll-mt-24">
          <CardHeader className="border-b border-border/70">
            <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><Plus className="size-4" aria-hidden="true" /></div>
            <CardTitle>Create account</CardTitle>
            <CardDescription>Add the account that future trades and performance records will belong to.</CardDescription>
          </CardHeader>
          <CardContent><AccountForm /></CardContent>
        </Card>
      </section>
    </div>
  );
}
