import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountForm } from "@/features/accounts/account-form";
import { createClient } from "@/lib/supabase/server";
import { getAccountsWithDerivedBalances } from "@/services/accounts/get-account-balances";

interface AccountsPageProps {
  searchParams: Promise<{ error?: string; message?: string }>;
}

export default async function AccountsPage({ searchParams }: AccountsPageProps) {
  const status = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("trading_accounts").select("*").order("created_at");
  const accounts = data ? await getAccountsWithDerivedBalances(supabase, data) : [];

  return (
    <div className="space-y-8">
      <div><h1 className="text-3xl font-semibold tracking-tight">Trading accounts</h1><p className="mt-2 text-muted-foreground">Balance is derived from starting balance, closed-trade net PnL, and account adjustments.</p></div>
      {status.error || error ? <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{status.error ?? error?.message}</p> : null}
      {status.message ? <p className="rounded-lg bg-muted p-4 text-sm">{status.message}</p> : null}
      <Card><CardHeader><CardTitle>Create account</CardTitle><CardDescription>Add the account that future trades and performance records will belong to.</CardDescription></CardHeader><CardContent><AccountForm /></CardContent></Card>
      <Card><CardHeader><CardTitle>Your accounts</CardTitle><CardDescription>{accounts.length} configured account{accounts.length === 1 ? "" : "s"}.</CardDescription></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Derived balance</TableHead><TableHead>Edit</TableHead></TableRow></TableHeader><TableBody>
          {accounts.map((account) => <TableRow key={account.id}><TableCell className="font-medium">{account.name}</TableCell><TableCell>{account.account_type.replaceAll("_", " ")}</TableCell><TableCell><Badge variant="secondary">{account.status}</Badge></TableCell><TableCell className="font-mono">{account.currency_code} {account.derived_balance}</TableCell><TableCell><details><summary className="cursor-pointer text-sm underline underline-offset-4">Edit</summary><div className="mt-4 min-w-[34rem]"><AccountForm account={account} /></div></details></TableCell></TableRow>)}
          {accounts.length === 0 ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No accounts yet.</TableCell></TableRow> : null}
        </TableBody></Table>
      </CardContent></Card>
    </div>
  );
}
