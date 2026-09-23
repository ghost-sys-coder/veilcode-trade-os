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

  return (
    <div className="space-y-8">
      <div><h1 className="text-3xl font-semibold tracking-tight">Strategies and setups</h1><p className="mt-2 text-muted-foreground">A strategy is a broad methodology. A setup is a repeatable pattern inside that methodology.</p></div>
      {status.error || error ? <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">{status.error ?? error?.message}</p> : null}
      {status.message ? <p className="rounded-lg bg-muted p-4 text-sm">{status.message}</p> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Create strategy</CardTitle><CardDescription>Define the broad logic behind a family of trades.</CardDescription></CardHeader><CardContent><StrategyForm /></CardContent></Card>
        <Card><CardHeader><CardTitle>Create setup</CardTitle><CardDescription>Attach a specific, repeatable entry pattern to a strategy.</CardDescription></CardHeader><CardContent>{strategies.length ? <SetupForm strategies={strategies} /> : <p className="text-sm text-muted-foreground">Create a strategy before adding a setup.</p>}</CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Strategies</CardTitle><CardDescription>Example strategies are inactive until you deliberately enable them.</CardDescription></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Kind</TableHead><TableHead>Edit</TableHead></TableRow></TableHeader><TableBody>
          {strategies.map((strategy) => <TableRow key={strategy.id}><TableCell><p className="font-medium">{strategy.name}</p><p className="max-w-xl text-xs text-muted-foreground">{strategy.description}</p></TableCell><TableCell><Badge variant="secondary">{strategy.active ? "ACTIVE" : "INACTIVE"}</Badge></TableCell><TableCell>{strategy.is_example ? "Editable example" : "Personal"}</TableCell><TableCell><details><summary className="cursor-pointer text-sm underline underline-offset-4">Edit</summary><div className="mt-4 min-w-[28rem]"><StrategyForm strategy={strategy} /></div></details></TableCell></TableRow>)}
        </TableBody></Table>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Setups</CardTitle><CardDescription>{setups.length} repeatable setup{setups.length === 1 ? "" : "s"}.</CardDescription></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Setup</TableHead><TableHead>Strategy</TableHead><TableHead>Status</TableHead><TableHead>Edit</TableHead></TableRow></TableHeader><TableBody>
          {setups.map((setup) => <TableRow key={setup.id}><TableCell><p className="font-medium">{setup.name}</p><p className="text-xs text-muted-foreground">{setup.description}</p></TableCell><TableCell>{strategies.find((strategy) => strategy.id === setup.strategy_id)?.name ?? "Unknown"}</TableCell><TableCell><Badge variant="secondary">{setup.active ? "ACTIVE" : "INACTIVE"}</Badge></TableCell><TableCell><details><summary className="cursor-pointer text-sm underline underline-offset-4">Edit</summary><div className="mt-4 min-w-[28rem]"><SetupForm setup={setup} strategies={strategies} /></div></details></TableCell></TableRow>)}
          {setups.length === 0 ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No setups yet.</TableCell></TableRow> : null}
        </TableBody></Table>
      </CardContent></Card>
    </div>
  );
}
