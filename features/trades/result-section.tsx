import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TradeSection } from "@/features/trades/trade-section";
import type { CalculationPreview } from "@/features/trades/types";
import type { TradeRow } from "@/types/database-helpers";

interface ResultSectionProps { trade?: TradeRow; preview: CalculationPreview; visible: boolean }

export function ResultSection({ trade, preview, visible }: ResultSectionProps) {
  const broker=Boolean(trade?.mt5_connection_id)||Boolean(trade&&["MT4","MT5","BROKER_API"].includes(trade.source_type));
  if (!visible) return null;
  return (
    <TradeSection eyebrow="06 · Result" title="Financial result" description="Net PnL, outcome, R, and duration are derived from normalized account-currency values when the trade closes.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2"><Label htmlFor="grossPnl">Gross PnL</Label><Input readOnly={broker} id="grossPnl" name="grossPnl" inputMode="decimal" defaultValue={trade?.gross_pnl ?? ""} /><p className="text-xs text-muted-foreground">Profit or loss before commission, swap, and other fees.</p></div>
        <div className="space-y-2"><Label htmlFor="commission">Commission</Label><Input readOnly={broker} id="commission" name="commission" inputMode="decimal" defaultValue={trade?.commission ?? "0"} /></div>
        <div className="space-y-2"><Label htmlFor="swap">Swap</Label><Input readOnly={broker} id="swap" name="swap" inputMode="decimal" defaultValue={trade?.swap ?? "0"} /></div>
        <div className="space-y-2"><Label htmlFor="otherFees">Other fees</Label><Input readOnly={broker} id="otherFees" name="otherFees" inputMode="decimal" defaultValue={trade?.other_fees ?? "0"} /></div>
        <div className="space-y-2"><Label htmlFor="tradingCredits">Trading credits</Label><Input readOnly={broker} id="tradingCredits" name="tradingCredits" inputMode="decimal" defaultValue={trade?.trading_credits ?? "0"} /><p className="text-xs text-muted-foreground">Trade-attributed rebates only, not broker borrowing facilities or deposits.</p></div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Normalized net PnL</p><p className="mt-2 font-mono text-xl font-semibold">{preview.netPnl ?? trade?.net_pnl ?? "—"}</p></div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Outcome</p><p className="mt-2 text-xl font-semibold">{preview.outcome?.replaceAll("_", " ") ?? trade?.outcome?.replaceAll("_", " ") ?? "—"}</p></div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Actual R</p><p className="mt-2 font-mono text-xl font-semibold">{preview.actualR ?? trade?.actual_r ?? "—"}</p></div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Holding duration</p><p className="mt-2 font-mono text-xl font-semibold">{preview.holdingDurationSeconds ?? trade?.holding_duration_seconds ?? "—"}<span className="ml-1 text-xs text-muted-foreground">sec</span></p></div>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2"><Label htmlFor="pipsResult">Pips result</Label><Input readOnly={broker} id="pipsResult" name="pipsResult" inputMode="decimal" defaultValue={trade?.pips_result ?? ""} /></div>
        <div className="space-y-2"><Label htmlFor="mfeAmount">MFE amount</Label><Input readOnly={broker} id="mfeAmount" name="mfeAmount" inputMode="decimal" defaultValue={trade?.mfe_amount ?? ""} /><p className="text-xs text-muted-foreground">Maximum favorable excursion.</p></div>
        <div className="space-y-2"><Label htmlFor="mfePips">MFE pips</Label><Input readOnly={broker} id="mfePips" name="mfePips" inputMode="decimal" defaultValue={trade?.mfe_pips ?? ""} /></div>
        <div className="space-y-2"><Label htmlFor="mfeR">MFE R</Label><Input readOnly={broker} id="mfeR" name="mfeR" inputMode="decimal" defaultValue={trade?.mfe_r ?? ""} /></div>
        <div className="space-y-2"><Label htmlFor="maeAmount">MAE amount</Label><Input readOnly={broker} id="maeAmount" name="maeAmount" inputMode="decimal" defaultValue={trade?.mae_amount ?? ""} /><p className="text-xs text-muted-foreground">Maximum adverse excursion.</p></div>
        <div className="space-y-2"><Label htmlFor="maePips">MAE pips</Label><Input readOnly={broker} id="maePips" name="maePips" inputMode="decimal" defaultValue={trade?.mae_pips ?? ""} /></div>
        <div className="space-y-2"><Label htmlFor="maeR">MAE R</Label><Input readOnly={broker} id="maeR" name="maeR" inputMode="decimal" defaultValue={trade?.mae_r ?? ""} /></div>
      </div>
    </TradeSection>
  );
}
