"use client";

import { useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import { MARKET_BIASES, MARKET_CONDITIONS, TIMEFRAMES } from "@/types/domain";
import type { SetupRow, StrategyRow, TradeRow } from "@/types/database-helpers";

interface SetupSectionProps {
  strategies: StrategyRow[];
  setups: SetupRow[];
  trade?: TradeRow;
  locked: boolean;
}

const unset = { label: "Not recorded", value: "UNSET" };

export function SetupSection({ strategies, setups, trade, locked }: SetupSectionProps) {
  const [strategyId, setStrategyId] = useState(trade?.strategy_id ?? "UNSET");
  const [setupId, setSetupId] = useState(trade?.setup_id ?? "UNSET");
  const availableSetups = useMemo(() => setups.filter((setup) => setup.strategy_id === strategyId), [setups, strategyId]);

  return (
    <TradeSection eyebrow="02 · Setup" title="Context and thesis" description="Capture the decision record that existed before execution. These fields lock once the trade opens.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <SelectField
          name="strategyId"
          label="Strategy"
          items={[unset, ...strategies.map((strategy) => ({ label: strategy.name, value: strategy.id }))]}
          value={strategyId}
          onValueChange={(value) => { const next = value ?? "UNSET"; setStrategyId(next); if (!setups.some((setup) => setup.id === setupId && setup.strategy_id === next)) setSetupId("UNSET"); }}
          disabled={locked}
        />
        <SelectField
          name="setupId"
          label="Setup"
          items={[unset, ...availableSetups.map((setup) => ({ label: setup.name, value: setup.id }))]}
          value={setupId}
          onValueChange={(value) => setSetupId(value ?? "UNSET")}
          disabled={locked || strategyId === "UNSET"}
          help="Filtered to setups under the selected strategy."
        />
        {locked ? <><input type="hidden" name="strategyId" value={strategyId} /><input type="hidden" name="setupId" value={setupId} /></> : null}
        <SelectField name="primaryAnalysisTimeframe" label="Analysis timeframe" items={[unset, ...TIMEFRAMES.map((value) => ({ label: value, value }))]} defaultValue={trade?.primary_analysis_timeframe ?? "UNSET"} />
        <SelectField name="entryTimeframe" label="Entry timeframe" items={[unset, ...TIMEFRAMES.map((value) => ({ label: value, value }))]} defaultValue={trade?.entry_timeframe ?? "UNSET"} />
        <SelectField name="higherTimeframeBias" label="Higher-timeframe bias" items={[unset, ...MARKET_BIASES.map((value) => ({ label: value.replaceAll("_", " "), value }))]} defaultValue={trade?.higher_timeframe_bias ?? "UNSET"} help="Your directional view before entering." />
        <SelectField name="marketCondition" label="Market condition" items={[unset, ...MARKET_CONDITIONS.map((value) => ({ label: value.replaceAll("_", " "), value }))]} defaultValue={trade?.market_condition ?? "UNSET"} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="thesis">Trade thesis</Label><Textarea id="thesis" name="thesis" rows={5} defaultValue={trade?.thesis ?? ""} disabled={locked} /><p className="text-xs leading-5 text-muted-foreground">What you believed the market would do and why.</p></div>
        <div className="space-y-2"><Label htmlFor="entryReason">Entry reason</Label><Textarea id="entryReason" name="entryReason" rows={5} defaultValue={trade?.entry_reason ?? ""} disabled={locked} /><p className="text-xs leading-5 text-muted-foreground">Why you entered at this point rather than earlier or later.</p></div>
        <div className="space-y-2"><Label htmlFor="confirmationNotes">Confirmation notes</Label><Textarea id="confirmationNotes" name="confirmationNotes" rows={5} defaultValue={trade?.confirmation_notes ?? ""} disabled={locked} /><p className="text-xs leading-5 text-muted-foreground">Structure break, candle close, retest, rejection, or other confirmation.</p></div>
      </div>
    </TradeSection>
  );
}
