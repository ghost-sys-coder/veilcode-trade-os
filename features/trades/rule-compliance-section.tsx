import { Input } from "@/components/ui/input";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import type { TradeRuleResultRow, TradingRuleRow } from "@/types/database-helpers";

interface RuleComplianceSectionProps {
  rules: TradingRuleRow[];
  results: TradeRuleResultRow[];
}

export function RuleComplianceSection({ rules, results }: RuleComplianceSectionProps) {
  return (
    <TradeSection eyebrow="09 · Rules" title="Rule compliance" description="Review only active rules that apply globally or to the selected account. Descriptions stay visible while scoring.">
      {rules.length ? <div className="space-y-3">
        {rules.map((rule) => {
          const result = results.find((item) => item.trading_rule_id === rule.id);
          return (
            <div key={rule.id} className="grid gap-4 rounded-lg border border-border/70 bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_14rem_minmax(15rem,0.8fr)] lg:items-end">
              <div><p className="font-semibold">{rule.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{rule.description}</p></div>
              <SelectField name={`ruleResult:${rule.id}`} label="Complied?" items={[{ label: "Not reviewed", value: "UNSET" }, { label: "Yes", value: "YES" }, { label: "No", value: "NO" }]} defaultValue={result ? (result.complied ? "YES" : "NO") : "UNSET"} />
              <Input name={`ruleNote:${rule.id}`} aria-label={`Note for ${rule.name}`} placeholder="Optional note" defaultValue={result?.notes ?? ""} />
            </div>
          );
        })}
      </div> : <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No active rules apply to this account.</div>}
    </TradeSection>
  );
}
