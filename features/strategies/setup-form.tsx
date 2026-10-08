import { randomUUID } from "node:crypto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveSetup } from "@/features/strategies/actions";
import type { SetupRow, StrategyRow } from "@/types/database-helpers";

interface SetupFormProps {
  setup?: SetupRow;
  strategies: StrategyRow[];
}

export function SetupForm({ setup, strategies }: SetupFormProps) {
  const availableStrategies = strategies.filter(strategy => !strategy.archived_at || strategy.id === setup?.strategy_id);
  const strategyItems = availableStrategies.map((strategy) => ({
    label: strategy.name,
    value: strategy.id,
  }));

  return (
    <form action={saveSetup} className="space-y-4">
      <input type="hidden" name="operationId" value={randomUUID()} />
      {setup ? <input type="hidden" name="expectedVersion" value={Number.isSafeInteger(setup.record_version) ? String(setup.record_version) : ""} /> : null}
      {setup ? <input type="hidden" name="id" value={setup.id} /> : null}
      <div className="space-y-2">
        <Label>Parent strategy</Label>
        <Select
          name="strategyId"
          defaultValue={setup?.strategy_id ?? availableStrategies[0]?.id}
          items={strategyItems}
          required
        >
          <SelectTrigger className="w-full"><SelectValue placeholder="Choose a strategy" /></SelectTrigger>
          <SelectContent>{availableStrategies.map((strategy) => <SelectItem key={strategy.id} value={strategy.id}>{strategy.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`setup-name-${setup?.id ?? "new"}`}>Setup name</Label>
        <Input id={`setup-name-${setup?.id ?? "new"}`} name="name" defaultValue={setup?.name} placeholder="Liquidity sweep reversal" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`setup-description-${setup?.id ?? "new"}`}>Description</Label>
        <Textarea id={`setup-description-${setup?.id ?? "new"}`} name="description" defaultValue={setup?.description ?? ""} placeholder="Describe the repeatable conditions that define this setup." />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/35 p-4">
        <div><Label htmlFor={`setup-active-${setup?.id ?? "new"}`}>Active</Label><p className="text-xs text-muted-foreground">Inactive setups remain in history but are hidden from new entries.</p></div>
        <Switch id={`setup-active-${setup?.id ?? "new"}`} name="active" defaultChecked={setup?.active ?? true} />
      </div>
      <Button type="submit" className="w-full sm:w-auto" disabled={availableStrategies.length === 0 || Boolean(setup?.archived_at)}>{setup?.archived_at ? "Archived setup" : setup ? "Save setup" : "Create setup"}</Button>
    </form>
  );
}
