import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import { RETAKE_DECISIONS, TRADE_GRADES } from "@/types/domain";
import type { TradeReviewRow } from "@/types/database-helpers";

interface ReviewSectionProps { review?: TradeReviewRow | null; visible: boolean }

export function ReviewSection({ review, visible }: ReviewSectionProps) {
  if (!visible) return null;
  return (
    <TradeSection eyebrow="10 · Review" title="Post-trade review" description="Grade the decision and execution, not the financial result. A disciplined loss can be an A; a lucky rule-breaking win can be poor.">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="whatWentWell">What went well?</Label><Textarea id="whatWentWell" name="whatWentWell" rows={4} defaultValue={review?.what_went_well ?? ""} /></div>
        <div className="space-y-2"><Label htmlFor="whatWentWrong">What went wrong?</Label><Textarea id="whatWentWrong" name="whatWentWrong" rows={4} defaultValue={review?.what_went_wrong ?? ""} /></div>
        <div className="space-y-2"><Label htmlFor="improvement">What should change next time?</Label><Textarea id="improvement" name="improvement" rows={4} defaultValue={review?.improvement ?? ""} /></div>
        <div className="space-y-2"><Label htmlFor="lessonLearned">Lesson learned</Label><Textarea id="lessonLearned" name="lessonLearned" rows={4} defaultValue={review?.lesson_learned ?? ""} /></div>
        <SelectField name="wouldTakeAgain" label="Would you take it again?" items={[{ label: "Not recorded", value: "UNSET" }, ...RETAKE_DECISIONS.map((value) => ({ label: value.replaceAll("_", " "), value }))]} defaultValue={review?.would_take_again ?? "UNSET"} />
        <SelectField name="tradeQualityGrade" label="Trade quality grade" items={[{ label: "Not graded", value: "UNSET" }, ...TRADE_GRADES.map((value) => ({ label: value, value }))]} defaultValue={review?.trade_quality_grade ?? "UNSET"} />
      </div>
    </TradeSection>
  );
}
