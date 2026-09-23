import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/features/trades/select-field";
import { SwitchField } from "@/features/trades/switch-field";
import { TradeSection } from "@/features/trades/trade-section";
import { STOP_ACTIONS } from "@/types/domain";
import type { TradeExecutionReviewRow } from "@/types/database-helpers";

interface ExecutionQualitySectionProps { review?: TradeExecutionReviewRow | null }

const yesNoItems = [
  { label: "Not recorded", value: "UNSET" },
  { label: "Yes", value: "YES" },
  { label: "No", value: "NO" },
];

function booleanValue(value: boolean | null | undefined): string {
  return value === true ? "YES" : value === false ? "NO" : "UNSET";
}

export function ExecutionQualitySection({ review }: ExecutionQualitySectionProps) {
  return (
    <TradeSection eyebrow="07 · Discipline" title="Execution quality" description="Rate the quality of execution independently from whether the trade made money.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <SelectField name="entryAccordingToPlan" label="Entry according to plan" items={yesNoItems} defaultValue={booleanValue(review?.entry_according_to_plan)} help="Did you enter where the plan said you should?" />
        <SelectField name="stopAccordingToPlan" label="Stop according to plan" items={yesNoItems} defaultValue={booleanValue(review?.stop_according_to_plan)} help="Was the initial stop placed where the plan required?" />
        <SelectField name="targetAccordingToPlan" label="Target according to plan" items={yesNoItems} defaultValue={booleanValue(review?.target_according_to_plan)} help="Was the target based on the original plan?" />
        <SelectField name="stopAction" label="Stop action" items={[{ label: "Not recorded", value: "UNSET" }, ...STOP_ACTIONS.map((value) => ({ label: value.replaceAll("_", " "), value }))]} defaultValue={review?.stop_action ?? "UNSET"} help="Trade management history; this does not rewrite the planned stop." />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SwitchField name="closedEarly" label="Closed early" description="Exited before target or invalidation for discretionary reasons." defaultChecked={review?.closed_early} />
        <SwitchField name="enteredEarly" label="Entered early" description="Entered before the required confirmation." defaultChecked={review?.entered_early} />
        <SwitchField name="enteredLate" label="Entered late" description="Entered after the intended opportunity moved away." defaultChecked={review?.entered_late} />
        <SwitchField name="chasedPrice" label="Chased price" description="Entered mainly from fear of missing the move." defaultChecked={review?.chased_price} />
        <SwitchField name="addedToPosition" label="Added to position" defaultChecked={review?.added_to_position} />
        <SwitchField name="revengeTrade" label="Revenge trade" description="Influenced by an urge to recover a previous loss." defaultChecked={review?.revenge_trade} />
        <SwitchField name="overRisked" label="Over-risked" description="Risk exceeded the planned or permitted amount." defaultChecked={review?.over_risked} />
        <SelectField name="executionRating" label="Execution rating" items={[{ label: "Not recorded", value: "UNSET" }, ...[1, 2, 3, 4, 5].map((value) => ({ label: `${value} · ${["Poor", "Weak", "Acceptable", "Good", "Excellent"][value - 1]}`, value: String(value) }))]} defaultValue={review?.execution_rating ? String(review.execution_rating) : "UNSET"} help="Discipline score, not financial outcome." />
      </div>
      <div className="mt-5 space-y-2"><Label htmlFor="executionNotes">Execution notes</Label><Textarea id="executionNotes" name="executionNotes" rows={4} defaultValue={review?.notes ?? ""} /></div>
    </TradeSection>
  );
}
