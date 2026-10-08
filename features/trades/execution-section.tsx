import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TradeSection } from "@/features/trades/trade-section";
import type { TradeRow } from "@/types/database-helpers";

interface ExecutionSectionProps { trade?: TradeRow }

export function ExecutionSection({ trade }: ExecutionSectionProps) {
  const broker=Boolean(trade?.mt5_connection_id)||Boolean(trade&&["MT4","MT5","BROKER_API"].includes(trade.source_type));
  return (
    <TradeSection eyebrow="05 · Execution" title="Actual execution" description="Keep fills and live trade-management facts separate from the original plan.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2"><Label htmlFor="actualEntry">Actual entry</Label><Input readOnly={broker} id="actualEntry" name="actualEntry" inputMode="decimal" defaultValue={trade?.actual_entry ?? ""} /><p className="text-xs text-muted-foreground">The actual fill price.</p></div>
        <div className="space-y-2"><Label htmlFor="actualLotSize">Actual lot size</Label><Input readOnly={broker} id="actualLotSize" name="actualLotSize" inputMode="decimal" defaultValue={trade?.actual_lot_size ?? ""} /></div>
        <div className="space-y-2"><Label htmlFor="actualStopLoss">Actual stop loss</Label><Input id="actualStopLoss" name="actualStopLoss" inputMode="decimal" readOnly={broker||trade?.status==="OPEN"||trade?.status==="CLOSED"} defaultValue={trade?.actual_stop_loss ?? ""} /><p className="text-xs text-muted-foreground">After opening, record actual stop movements in management history below. The planned stop is unchanged.</p></div>
        <div className="space-y-2"><Label htmlFor="actualExit">Final actual exit</Label><Input readOnly={broker} id="actualExit" name="actualExit" inputMode="decimal" defaultValue={trade?.actual_exit ?? ""} /></div>
      </div>
    </TradeSection>
  );
}
