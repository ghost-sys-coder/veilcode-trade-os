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

  return (
    <div className="space-y-8">
      <div><h1 className="text-3xl font-semibold tracking-tight">Trading rules</h1><p className="mt-2 text-muted-foreground">Define measurable and behavioral rules. Example rules remain inactive until you configure them.</p></div>
      {status.error || error ? <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{status.error ?? error?.message}</p> : null}
      {status.message ? <p className="rounded-lg bg-muted p-4 text-sm">{status.message}</p> : null}
      <Card><CardHeader><CardTitle>Create rule</CardTitle><CardDescription>Rules can apply globally or only to one account.</CardDescription></CardHeader><CardContent><TradingRuleForm accounts={accounts} /></CardContent></Card>
      <Card><CardHeader><CardTitle>Your rules</CardTitle><CardDescription>{rules.length} configured rule{rules.length === 1 ? "" : "s"}.</CardDescription></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Scope</TableHead><TableHead>Type / limit</TableHead><TableHead>Status</TableHead><TableHead>Edit</TableHead></TableRow></TableHeader><TableBody>
          {rules.map((rule) => <TableRow key={rule.id}><TableCell><p className="font-medium">{rule.name}</p><p className="max-w-lg text-xs text-muted-foreground">{rule.description}</p></TableCell><TableCell>{rule.account_id ? accounts.find((account) => account.id === rule.account_id)?.name ?? "Unknown account" : "All accounts"}</TableCell><TableCell>{rule.rule_type.replaceAll("_", " ")}{rule.numeric_limit ? ` · ${rule.numeric_limit}` : ""}</TableCell><TableCell><Badge variant="secondary">{rule.active ? "ACTIVE" : rule.is_example ? "EXAMPLE" : "INACTIVE"}</Badge></TableCell><TableCell><details><summary className="cursor-pointer text-sm underline underline-offset-4">Edit</summary><div className="mt-4 min-w-[30rem]"><TradingRuleForm accounts={accounts} rule={rule} /></div></details></TableCell></TableRow>)}
        </TableBody></Table>
      </CardContent></Card>
    </div>
  );
}
