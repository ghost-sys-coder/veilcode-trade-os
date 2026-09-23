import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { correctTradePlanValue } from "@/features/trades/actions";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import type { TradePlanCorrectionRow, TradeRow, TradeTargetRow } from "@/types/database-helpers";

interface PlanCorrectionPanelProps {
  trade: TradeRow;
  targets: TradeTargetRow[];
  corrections: TradePlanCorrectionRow[];
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function PlanCorrectionPanel({ trade, targets, corrections }: PlanCorrectionPanelProps) {
  const action = correctTradePlanValue.bind(null, trade.id);
  const fields = [
    "planned_entry", "planned_stop_loss", "planned_take_profit", "planned_lot_size",
    "planned_risk_amount", "planned_risk_percentage", "planned_reward_amount", "planned_risk_reward",
    "strategy_id", "setup_id", "thesis", "entry_reason", "confirmation_notes",
    "target.label", "target.planned_price", "target.planned_close_percentage",
  ].map((field) => ({ label: field.replaceAll("_", " ").replace("target.", "target · "), value: field }));
  const protectedValues = [
    { field: "planned_entry", label: "Entry", current: trade.planned_entry },
    { field: "planned_stop_loss", label: "Stop", current: trade.planned_stop_loss },
    { field: "planned_take_profit", label: "Target", current: trade.planned_take_profit },
    { field: "planned_risk_amount", label: "Risk", current: trade.planned_risk_amount },
  ].map((item) => ({
    ...item,
    original: corrections.find((correction) => correction.field_name === item.field)?.previous_value ?? item.current,
  }));

  return (
    <TradeSection eyebrow="Audit trail" title="Correct recorded plan value" description="Use this only to fix incorrectly recorded evidence. An actual stop move or target change belongs to trade-management history, not this correction log.">
      <form action={action} className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <SelectField name="fieldName" label="Protected field" items={fields} defaultValue="planned_entry" required />
        <SelectField name="tradeTargetId" label="Target, if correcting a target" items={[{ label: "Not a target correction", value: "UNSET" }, ...targets.map((target) => ({ label: target.label, value: target.id }))]} defaultValue="UNSET" />
        <div className="space-y-2"><Label htmlFor="newValue">Corrected value</Label><Input id="newValue" name="newValue" required /></div>
        <div className="space-y-2 lg:col-span-2 xl:col-span-3"><Label htmlFor="reason">Reason</Label><Textarea id="reason" name="reason" rows={3} minLength={5} required placeholder="For example: incorrect decimal placement copied from broker." /></div>
        <Button type="submit" className="self-end">Append correction</Button>
      </form>
      <div className="mt-6 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Original and current plan</p>
          <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-sm">
            <span className="text-xs text-muted-foreground">Field</span><span className="text-xs text-muted-foreground">Original</span><span className="text-xs text-muted-foreground">Current</span>
            {protectedValues.map((item) => (
              <div key={item.field} className="contents">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-mono text-right">{displayValue(item.original)}</span>
                <span className="font-mono text-right">{displayValue(item.current)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Correction history</p>
          {corrections.length ? (
            <ol className="mt-3 space-y-3">
              {corrections.map((correction) => (
                <li key={correction.id} className="border-l-2 border-primary/40 pl-3 text-sm">
                  <p className="font-semibold">{correction.field_name.replaceAll("_", " ")}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{displayValue(correction.previous_value)} → {displayValue(correction.new_value)}</p>
                  <p className="mt-1 text-xs">{correction.reason}</p>
                  <time className="mt-1 block text-[0.68rem] text-muted-foreground">{new Date(correction.created_at).toLocaleString()}</time>
                </li>
              ))}
            </ol>
          ) : <p className="mt-3 text-sm text-muted-foreground">No corrections recorded. The currently stored plan remains the original record.</p>}
        </div>
      </div>
    </TradeSection>
  );
}
