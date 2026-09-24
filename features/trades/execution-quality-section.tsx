import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import { STOP_ACTIONS } from "@/types/domain";
import type { TradeExecutionReviewRow } from "@/types/database-helpers";

interface ExecutionQualitySectionProps {
  review?: TradeExecutionReviewRow | null;
  canComplete: boolean;
}

const yesNoItems = [
  { label: "Not answered", value: "UNSET" },
  { label: "Yes", value: "YES" },
  { label: "No", value: "NO" },
];

function booleanValue(value: boolean | null | undefined): string {
  return value === true ? "YES" : value === false ? "NO" : "UNSET";
}

export function ExecutionQualitySection({ review, canComplete }: ExecutionQualitySectionProps) {
  const completed = Boolean(review?.reviewed_at);
  return (
    <TradeSection eyebrow="07 · Discipline" title="Execution quality" description="Draft observations are excluded from analytics until you explicitly complete this review.">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
        <div>
          <p className="text-sm font-medium">Execution review</p>
          <p className="mt-1 text-xs text-muted-foreground">Completion requires an explicit answer for every plan and behavior question.</p>
        </div>
        {completed ? <Badge variant="secondary">Reviewed</Badge> : canComplete ? (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input className="size-4 accent-primary" type="checkbox" name="completeExecutionReview" />
            Mark execution review complete
          </label>
        ) : <Badge variant="outline">Close trade to complete</Badge>}
        {completed ? <input type="hidden" name="executionReviewAlreadyComplete" value="true" /> : null}
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <SelectField name="entryAccordingToPlan" label="Entry according to plan" items={yesNoItems} defaultValue={booleanValue(review?.entry_according_to_plan)} help="Did you enter where the plan said you should?" />
        <SelectField name="stopAccordingToPlan" label="Stop according to plan" items={yesNoItems} defaultValue={booleanValue(review?.stop_according_to_plan)} help="Was the initial stop placed where the plan required?" />
        <SelectField name="targetAccordingToPlan" label="Target according to plan" items={yesNoItems} defaultValue={booleanValue(review?.target_according_to_plan)} help="Was the target based on the original plan?" />
        <SelectField name="stopAction" label="Stop action" items={[{ label: "Not answered", value: "UNSET" }, ...STOP_ACTIONS.map((value) => ({ label: value.replaceAll("_", " "), value }))]} defaultValue={review?.stop_action ?? "UNSET"} help="Trade management history; this does not rewrite the planned stop." />
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <SelectField name="closedEarly" label="Closed early" items={yesNoItems} defaultValue={booleanValue(review?.closed_early)} help="Exited before target or invalidation for discretionary reasons." />
        <SelectField name="enteredEarly" label="Entered early" items={yesNoItems} defaultValue={booleanValue(review?.entered_early)} help="Entered before the required confirmation." />
        <SelectField name="enteredLate" label="Entered late" items={yesNoItems} defaultValue={booleanValue(review?.entered_late)} help="Entered after the intended opportunity moved away." />
        <SelectField name="chasedPrice" label="Chased price" items={yesNoItems} defaultValue={booleanValue(review?.chased_price)} help="Entered mainly from fear of missing the move." />
        <SelectField name="addedToPosition" label="Added to position" items={yesNoItems} defaultValue={booleanValue(review?.added_to_position)} />
        <SelectField name="revengeTrade" label="Revenge trade" items={yesNoItems} defaultValue={booleanValue(review?.revenge_trade)} help="Influenced by an urge to recover a previous loss." />
        <SelectField name="overRisked" label="Over-risked" items={yesNoItems} defaultValue={booleanValue(review?.over_risked)} help="Risk exceeded the planned or permitted amount." />
        <SelectField name="executionRating" label="Execution rating" items={[{ label: "Not recorded", value: "UNSET" }, ...[1, 2, 3, 4, 5].map((value) => ({ label: `${value} · ${["Poor", "Weak", "Acceptable", "Good", "Excellent"][value - 1]}`, value: String(value) }))]} defaultValue={review?.execution_rating ? String(review.execution_rating) : "UNSET"} help="Discipline score, not financial outcome." />
      </div>
      <div className="mt-5 space-y-2"><Label htmlFor="executionNotes">Execution notes</Label><Textarea id="executionNotes" name="executionNotes" rows={4} defaultValue={review?.notes ?? ""} /></div>
    </TradeSection>
  );
}
