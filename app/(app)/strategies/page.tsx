import { ChartNoAxesCombined, Layers3, Plus, Workflow } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SetupForm } from "@/features/strategies/setup-form";
import { StrategyForm } from "@/features/strategies/strategy-form";
import { createClient } from "@/lib/supabase/server";

interface StrategiesPageProps {
  searchParams: Promise<{ error?: string; message?: string }>;
}

export default async function StrategiesPage({ searchParams }: StrategiesPageProps) {
  const status = await searchParams;
  const supabase = await createClient();
  const [strategiesResult, setupsResult] = await Promise.all([
    supabase.from("strategies").select("*").order("name"),
    supabase.from("setups").select("*").order("name"),
  ]);
  const strategies = strategiesResult.data ?? [];
  const setups = setupsResult.data ?? [];
  const error = strategiesResult.error ?? setupsResult.error;
  const activeStrategies = strategies.filter((strategy) => strategy.active).length;
  const activeSetups = setups.filter((setup) => setup.active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Execution framework"
        title="Strategies & setups"
        description="Separate the broad methodology from the repeatable entry pattern so future performance reviews stay precise."
      />

      {status.error || error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{status.error ?? error?.message}</p> : null}
      {status.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{status.message}</p> : null}

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Strategy summary">
        <Card className="gap-3 p-5"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Methodologies</p><ChartNoAxesCombined className="size-4 text-primary" aria-hidden="true" /></div><p className="font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums">{strategies.length}</p><p className="text-xs text-muted-foreground">{activeStrategies} currently active</p></Card>
        <Card className="gap-3 p-5"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Setups</p><Layers3 className="size-4 text-primary" aria-hidden="true" /></div><p className="font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums">{setups.length}</p><p className="text-xs text-muted-foreground">{activeSetups} available for entry</p></Card>
        <Card className="gap-3 p-5"><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Model</p><Workflow className="size-4 text-primary" aria-hidden="true" /></div><p className="text-lg font-semibold tracking-tight">Strategy → setup</p><p className="text-xs text-muted-foreground">One methodology, many patterns</p></Card>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border/70"><div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><Plus className="size-4" aria-hidden="true" /></div><CardTitle>Create strategy</CardTitle><CardDescription>Define the broad logic behind a family of trades.</CardDescription></CardHeader>
          <CardContent><StrategyForm /></CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border/70"><div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><Plus className="size-4" aria-hidden="true" /></div><CardTitle>Create setup</CardTitle><CardDescription>Attach a specific, repeatable entry pattern to a strategy.</CardDescription></CardHeader>
          <CardContent>{strategies.length ? <SetupForm strategies={strategies} /> : <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Create a strategy before adding a setup.</div>}</CardContent>
        </Card>
      </section>

      <section className="grid items-start gap-4 2xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border/70"><CardTitle>Strategy library</CardTitle><CardDescription>Examples remain inactive until you deliberately enable them.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-0">
            <Table><TableHeader><TableRow><TableHead>Methodology</TableHead><TableHead>Status</TableHead><TableHead>Kind</TableHead><TableHead className="text-right">Manage</TableHead></TableRow></TableHeader><TableBody>
              {strategies.map((strategy) => <TableRow key={strategy.id}><TableCell><p className="font-semibold">{strategy.name}</p><p className="mt-0.5 max-w-md text-xs leading-5 text-muted-foreground">{strategy.description || "No description recorded."}</p></TableCell><TableCell><Badge variant={strategy.active ? "default" : "secondary"}>{strategy.active ? "ACTIVE" : "INACTIVE"}</Badge></TableCell><TableCell>{strategy.is_example ? "Example" : "Personal"}</TableCell><TableCell className="text-right"><a href={`#edit-strategy-${strategy.id}`} className="text-xs font-semibold text-primary hover:underline hover:underline-offset-4">Edit</a></TableCell></TableRow>)}
              {strategies.length === 0 ? <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">No strategies yet.</TableCell></TableRow> : null}
            </TableBody></Table>
            {strategies.length > 0 ? <div className="space-y-2 border-t border-border/70 p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Manage strategies</p>{strategies.map((strategy) => <details key={strategy.id} id={`edit-strategy-${strategy.id}`} className="group scroll-mt-24 rounded-lg border border-border/70 bg-muted/25 open:bg-card"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold"><span>{strategy.name}</span><span className="text-xs text-primary group-open:hidden">Edit</span><span className="hidden text-xs text-muted-foreground group-open:inline">Close</span></summary><div className="border-t border-border/70 p-4"><StrategyForm strategy={strategy} /></div></details>)}</div> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/70"><CardTitle>Setup library</CardTitle><CardDescription>{setups.length} repeatable setup{setups.length === 1 ? "" : "s"} mapped to a parent strategy.</CardDescription></CardHeader>
          <CardContent className="px-0 pb-0">
            <Table><TableHeader><TableRow><TableHead>Setup</TableHead><TableHead>Strategy</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Manage</TableHead></TableRow></TableHeader><TableBody>
              {setups.map((setup) => <TableRow key={setup.id}><TableCell><p className="font-semibold">{setup.name}</p><p className="mt-0.5 max-w-md text-xs leading-5 text-muted-foreground">{setup.description || "No description recorded."}</p></TableCell><TableCell>{strategies.find((strategy) => strategy.id === setup.strategy_id)?.name ?? "Unknown"}</TableCell><TableCell><Badge variant={setup.active ? "default" : "secondary"}>{setup.active ? "ACTIVE" : "INACTIVE"}</Badge></TableCell><TableCell className="text-right"><a href={`#edit-setup-${setup.id}`} className="text-xs font-semibold text-primary hover:underline hover:underline-offset-4">Edit</a></TableCell></TableRow>)}
              {setups.length === 0 ? <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">No setups yet.</TableCell></TableRow> : null}
            </TableBody></Table>
            {setups.length > 0 ? <div className="space-y-2 border-t border-border/70 p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Manage setups</p>{setups.map((setup) => <details key={setup.id} id={`edit-setup-${setup.id}`} className="group scroll-mt-24 rounded-lg border border-border/70 bg-muted/25 open:bg-card"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold"><span>{setup.name}</span><span className="text-xs text-primary group-open:hidden">Edit</span><span className="hidden text-xs text-muted-foreground group-open:inline">Close</span></summary><div className="border-t border-border/70 p-4"><SetupForm setup={setup} strategies={strategies} /></div></details>)}</div> : null}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
