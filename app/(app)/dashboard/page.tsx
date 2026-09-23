import Link from "next/link";
import { ArrowRight, Landmark, ListChecks, Shapes, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const [accounts, strategies, setups, rules] = await Promise.all([
    supabase.from("trading_accounts").select("id", { count: "exact", head: true }),
    supabase.from("strategies").select("id", { count: "exact", head: true }),
    supabase.from("setups").select("id", { count: "exact", head: true }),
    supabase.from("trading_rules").select("id", { count: "exact", head: true }),
  ]);
  const error = accounts.error ?? strategies.error ?? setups.error ?? rules.error;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="secondary" className="mb-3">Foundation workspace</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">Trading foundations</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Set up the accounts, strategies, repeatable setups, and rules that future trade records will reference.</p>
        </div>
      </div>
      {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">Database setup is not available yet: {error.message}</p> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader><CardTitle>Accounts</CardTitle><CardDescription>Demo, prop, funded, and personal live accounts</CardDescription><CardAction><Landmark className="size-5 text-muted-foreground" /></CardAction></CardHeader><CardContent><p className="text-3xl font-semibold">{accounts.count ?? 0}</p><Button className="mt-4" render={<Link href="/accounts" />} variant="outline" size="sm">Manage <ArrowRight data-icon="inline-end" /></Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Strategies</CardTitle><CardDescription>Broad methodologies behind your decisions</CardDescription><CardAction><Shapes className="size-5 text-muted-foreground" /></CardAction></CardHeader><CardContent><p className="text-3xl font-semibold">{strategies.count ?? 0}</p><Button className="mt-4" render={<Link href="/strategies" />} variant="outline" size="sm">Manage <ArrowRight data-icon="inline-end" /></Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Setups</CardTitle><CardDescription>Repeatable patterns within a strategy</CardDescription><CardAction><Target className="size-5 text-muted-foreground" /></CardAction></CardHeader><CardContent><p className="text-3xl font-semibold">{setups.count ?? 0}</p><Button className="mt-4" render={<Link href="/strategies" />} variant="outline" size="sm">Manage <ArrowRight data-icon="inline-end" /></Button></CardContent></Card>
        <Card><CardHeader><CardTitle>Rules</CardTitle><CardDescription>Measurable and behavioral guardrails</CardDescription><CardAction><ListChecks className="size-5 text-muted-foreground" /></CardAction></CardHeader><CardContent><p className="text-3xl font-semibold">{rules.count ?? 0}</p><Button className="mt-4" render={<Link href="/rules" />} variant="outline" size="sm">Manage <ArrowRight data-icon="inline-end" /></Button></CardContent></Card>
      </div>
    </div>
  );
}
