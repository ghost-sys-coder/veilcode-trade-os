"use client";

import { useState } from "react";
import { Calculator, PencilLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TradeSection } from "@/features/trades/trade-section";
import type { CalculationPreview, TradeFormAccount } from "@/features/trades/types";
import type { TradeRow } from "@/types/database-helpers";

interface RiskSectionProps {
  account?: TradeFormAccount;
  trade?: TradeRow;
  locked: boolean;
  preview: CalculationPreview;
  initialValues?: { plannedRiskAmount: string; plannedRewardAmount?: string };
}

export function RiskSection({ account, trade, locked, preview, initialValues }: RiskSectionProps) {
  const [correctingBalance, setCorrectingBalance] = useState(false);
  const balance = trade?.account_id === account?.id && trade?.account_balance_before
    ? trade.account_balance_before
    : account?.derived_balance ?? "";
  return (
    <TradeSection eyebrow="04 · Risk" title="Risk and reward" description="Authoritative monetary calculations use decimal arithmetic and the selected account's currency precision.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="balanceBefore">Balance before trade</Label>
          {correctingBalance && !locked ? (
            <Input key={account?.id} id="balanceBefore" name="accountBalanceBefore" defaultValue={balance} inputMode="decimal" autoFocus />
          ) : (
            <Input id="balanceBefore" name="accountBalanceBefore" value={balance} readOnly />
          )}
          <p className="text-xs text-muted-foreground">Derived from starting balance, closed PnL, and adjustments.</p>
          {!locked ? (
            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setCorrectingBalance((value) => !value)}>
              <PencilLine /> {correctingBalance ? "Use derived balance" : "Correct recorded balance snapshot"}
            </Button>
          ) : null}
        </div>
        <div className="space-y-2"><Label htmlFor="plannedRiskAmount">Planned risk amount</Label><Input id="plannedRiskAmount" name="plannedRiskAmount" inputMode="decimal" defaultValue={trade?.planned_risk_amount ?? initialValues?.plannedRiskAmount ?? ""} disabled={locked} /><p className="text-xs text-muted-foreground">Maximum account-currency loss planned at the stop.</p></div>
        <div className="space-y-2"><Label>Planned risk percentage</Label><div className="flex h-10 items-center rounded-lg border border-border bg-muted/30 px-3 font-mono text-sm">{preview.riskPercentage ?? trade?.planned_risk_percentage ?? "—"}{preview.riskPercentage || trade?.planned_risk_percentage ? "%" : ""}</div><p className="text-xs text-muted-foreground">Calculated as risk amount ÷ balance before × 100.</p></div>
        <div className="space-y-2"><Label htmlFor="plannedRewardAmount">Planned reward amount</Label><Input id="plannedRewardAmount" name="plannedRewardAmount" inputMode="decimal" defaultValue={trade?.planned_reward_amount ?? initialValues?.plannedRewardAmount ?? ""} disabled={locked} /><p className="text-xs text-muted-foreground">Expected account-currency gain at the planned target.</p></div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Calculator className="size-4 text-primary" /> Planned RR</div><p className="mt-2 font-mono text-xl font-semibold">{preview.plannedRiskReward ?? trade?.planned_risk_reward ?? "—"}{preview.plannedRiskReward || trade?.planned_risk_reward ? "R" : ""}</p></div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Stop distance</p><p className="mt-2 font-mono text-xl font-semibold">{preview.stopDistance ?? "—"}</p></div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Currency precision</p><p className="mt-2 font-mono text-xl font-semibold">{account?.currency_code ?? "—"} · {account?.currency_precision ?? "—"} dp</p></div>
      </div>
    </TradeSection>
  );
}
