import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveStrategy } from "@/features/strategies/actions";
import type { StrategyRow } from "@/types/database-helpers";

export function StrategyForm({ strategy }: { strategy?: StrategyRow }) {
  return (
    <form action={saveStrategy} className="space-y-4">
      {strategy ? <input type="hidden" name="id" value={strategy.id} /> : null}
      <div className="space-y-2">
        <Label htmlFor={`strategy-name-${strategy?.id ?? "new"}`}>Strategy name</Label>
        <Input id={`strategy-name-${strategy?.id ?? "new"}`} name="name" defaultValue={strategy?.name} placeholder="Liquidity continuation" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`strategy-description-${strategy?.id ?? "new"}`}>Description</Label>
        <Textarea id={`strategy-description-${strategy?.id ?? "new"}`} name="description" defaultValue={strategy?.description ?? ""} placeholder="Describe the broad trading methodology." />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/35 p-4">
        <div><Label htmlFor={`strategy-active-${strategy?.id ?? "new"}`}>Active</Label><p className="text-xs text-muted-foreground">Active strategies appear in trade-entry choices.</p></div>
        <Switch id={`strategy-active-${strategy?.id ?? "new"}`} name="active" defaultChecked={strategy?.active ?? true} />
      </div>
      <Button type="submit" className="w-full sm:w-auto">{strategy ? "Save strategy" : "Create strategy"}</Button>
    </form>
  );
}
