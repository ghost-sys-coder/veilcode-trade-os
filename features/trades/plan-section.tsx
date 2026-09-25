"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TradeSection } from "@/features/trades/trade-section";
import type { TradeRow, TradeTargetRow } from "@/types/database-helpers";

interface PlanSectionProps {
  trade?: TradeRow;
  initialTargets: TradeTargetRow[];
  locked: boolean;
  initialValues?: { plannedEntry: string; plannedStopLoss: string; plannedTakeProfit?: string; plannedLotSize: string };
}

export function PlanSection({ trade, initialTargets, locked, initialValues }: PlanSectionProps) {
  const [targets, setTargets] = useState<Array<{ key: string; target: TradeTargetRow | null }>>(() => initialTargets.length
    ? initialTargets.map((target) => ({ key: target.id, target }))
    : [{ key: crypto.randomUUID(), target: null }]);

  return (
    <TradeSection eyebrow="03 · Plan" title="Original trade plan" description="Planned prices and sizing are evidence of the original decision. They lock after OPEN and can only change through the correction workflow.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2"><Label htmlFor="plannedEntry">Planned entry price</Label><Input id="plannedEntry" name="plannedEntry" inputMode="decimal" defaultValue={trade?.planned_entry ?? initialValues?.plannedEntry ?? ""} readOnly={locked} /><p className="text-xs text-muted-foreground">The intended entry before execution.</p></div>
        <div className="space-y-2"><Label htmlFor="plannedStopLoss">Planned stop loss</Label><Input id="plannedStopLoss" name="plannedStopLoss" inputMode="decimal" defaultValue={trade?.planned_stop_loss ?? initialValues?.plannedStopLoss ?? ""} readOnly={locked} /><p className="text-xs text-muted-foreground">Where the original idea became invalid.</p></div>
        <div className="space-y-2"><Label htmlFor="plannedTakeProfit">Main take profit</Label><Input id="plannedTakeProfit" name="plannedTakeProfit" inputMode="decimal" defaultValue={trade?.planned_take_profit ?? initialValues?.plannedTakeProfit ?? ""} readOnly={locked} /><p className="text-xs text-muted-foreground">The primary target planned before entry.</p></div>
        <div className="space-y-2"><Label htmlFor="plannedLotSize">Planned lot size</Label><Input id="plannedLotSize" name="plannedLotSize" inputMode="decimal" defaultValue={trade?.planned_lot_size ?? initialValues?.plannedLotSize ?? ""} readOnly={locked} /><p className="text-xs text-muted-foreground">Position volume, not leverage.</p></div>
      </div>

      <div className="mt-7 flex items-center justify-between gap-4">
        <div><h3 className="font-semibold">Partial targets</h3><p className="mt-1 text-xs text-muted-foreground">Plan TP1, TP2, TP3, or custom exits. Total planned closure cannot exceed 100%.</p></div>
        {!locked ? <Button type="button" variant="outline" size="sm" onClick={() => setTargets((current) => [...current, { key: crypto.randomUUID(), target: null }])}><Plus /> Add target</Button> : null}
      </div>
      <div className="mt-4 space-y-3">
        {targets.map(({ key, target }, index) => (
          <div key={key} className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-4 md:grid-cols-2 xl:grid-cols-[0.7fr_1fr_1fr_1fr_1fr_1fr_auto]">
            <input type="hidden" name="targetId" value={target?.id ?? ""} />
            <div className="space-y-1.5"><Label>Label</Label><Input name="targetLabel" defaultValue={target?.label ?? `TP${index + 1}`} readOnly={locked} /></div>
            <div className="space-y-1.5"><Label>Planned price</Label><Input name="targetPlannedPrice" inputMode="decimal" defaultValue={target?.planned_price ?? ""} readOnly={locked} /></div>
            <div className="space-y-1.5"><Label>Planned close %</Label><Input name="targetPlannedPercentage" inputMode="decimal" defaultValue={target?.planned_close_percentage ?? ""} readOnly={locked} /></div>
            <div className="space-y-1.5"><Label>Actual fill</Label><Input name="targetActualFillPrice" inputMode="decimal" defaultValue={target?.actual_fill_price ?? ""} /></div>
            <div className="space-y-1.5"><Label>Actual close %</Label><Input name="targetActualPercentage" inputMode="decimal" defaultValue={target?.actual_close_percentage ?? ""} /></div>
            <div className="space-y-1.5"><Label>PnL contribution</Label><Input name="targetPnlContribution" inputMode="decimal" defaultValue={target?.pnl_contribution ?? ""} /></div>
            <div className="space-y-1.5"><Label>Hit at</Label><Input name="targetHitAt" type="datetime-local" defaultValue={target?.hit_at ? new Date(new Date(target.hit_at).getTime() - new Date(target.hit_at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ""} /></div>
            {!locked ? <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={`Remove target ${index + 1}`} onClick={() => setTargets((current) => current.filter((item) => item.key !== key))}><X /></Button> : <span />}
          </div>
        ))}
      </div>
    </TradeSection>
  );
}
