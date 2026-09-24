import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import type { TradeRuleResultRow, TradeRuleReviewItemRow, TradeRuleReviewRow, TradingRuleRow } from "@/types/database-helpers";

interface RuleComplianceSectionProps {
  rules: TradingRuleRow[];
  results: TradeRuleResultRow[];
  review?: TradeRuleReviewRow | null;
  reviewItems?: TradeRuleReviewItemRow[];
  canComplete: boolean;
}

export function RuleComplianceSection({ rules, results, review, reviewItems = [], canComplete }: RuleComplianceSectionProps) {
  if (review) {
    const violations = reviewItems.filter((item) => !item.complied).length;
    return (
      <TradeSection eyebrow="09 · Rules" title="Rule compliance" description="This immutable snapshot preserves the exact rule set evaluated when the review was completed.">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
          <div><p className="text-sm font-medium">Completed rule review</p><p className="mt-1 text-xs text-muted-foreground">{review.applicable_rule_count} applicable rule{review.applicable_rule_count === 1 ? "" : "s"} · {violations} violation{violations === 1 ? "" : "s"}</p></div>
          <Badge variant={violations ? "destructive" : "secondary"}>{violations ? "Violations present" : "Fully compliant"}</Badge>
        </div>
        {reviewItems.length ? <div className="space-y-3">{reviewItems.map((item) => (
          <div key={item.id} className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div><p className="font-semibold">{item.rule_name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.rule_description}</p>{item.notes ? <p className="mt-2 text-sm">{item.notes}</p> : null}</div>
            <Badge variant={item.complied ? "secondary" : "destructive"}>{item.complied ? "Followed" : "Broken"}</Badge>
          </div>
        ))}</div> : <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No rules were applicable when this review was completed.</div>}
        <input type="hidden" name="ruleReviewAlreadyComplete" value="true" />
      </TradeSection>
    );
  }

  return (
    <TradeSection eyebrow="09 · Rules" title="Rule compliance" description="Draft answers do not count as reviewed. Completion snapshots the exact active rule set and all explicit results.">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
        <div><p className="text-sm font-medium">Rule review</p><p className="mt-1 text-xs text-muted-foreground">Every applicable rule must be marked followed or broken.</p></div>
        {canComplete ? <label className="flex items-center gap-2 text-sm font-medium"><input className="size-4 accent-primary" type="checkbox" name="completeRuleReview" />Mark rule review complete</label> : <Badge variant="outline">Close trade to complete</Badge>}
      </div>
      {rules.length ? <div className="space-y-3">
        {rules.map((rule) => {
          const result = results.find((item) => item.trading_rule_id === rule.id);
          return (
            <div key={rule.id} className="grid gap-4 rounded-lg border border-border/70 bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_14rem_minmax(15rem,0.8fr)] lg:items-end">
              <div><p className="font-semibold">{rule.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{rule.description}</p></div>
              <SelectField name={`ruleResult:${rule.id}`} label="Result" items={[{ label: "Not answered", value: "UNSET" }, { label: "Followed", value: "YES" }, { label: "Broken", value: "NO" }]} defaultValue={result ? (result.complied ? "YES" : "NO") : "UNSET"} />
              <Input name={`ruleNote:${rule.id}`} aria-label={`Note for ${rule.name}`} placeholder="Optional note" defaultValue={result?.notes ?? ""} />
            </div>
          );
        })}
      </div> : <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No active rules apply to this account. You may still complete the review to preserve that zero-rule snapshot.</div>}
    </TradeSection>
  );
}
