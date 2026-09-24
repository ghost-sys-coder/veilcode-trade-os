import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import { TRADE_EMOTIONS } from "@/types/domain";
import type { TradePsychologyRow } from "@/types/database-helpers";

interface PsychologySectionProps {
  psychology?: TradePsychologyRow | null;
  canComplete: boolean;
}

const emotionItems = [
  { label: "Not recorded", value: "UNSET" },
  ...TRADE_EMOTIONS.map((value) => ({ label: value.replaceAll("_", " "), value })),
];

const yesNoItems = [
  { label: "Not answered", value: "UNSET" },
  { label: "Yes", value: "YES" },
  { label: "No", value: "NO" },
];

function booleanValue(value: boolean | null | undefined): string {
  return value === true ? "YES" : value === false ? "NO" : "UNSET";
}

export function PsychologySection({ psychology, canComplete }: PsychologySectionProps) {
  const completed = Boolean(psychology?.reviewed_at);
  return (
    <TradeSection eyebrow="08 · Psychology" title="Trading mindset" description="Behavioral self-observation only—not a medical or psychological assessment.">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
        <div>
          <p className="text-sm font-medium">Psychology review</p>
          <p className="mt-1 text-xs text-muted-foreground">Yes, no, and not answered remain distinct until review completion.</p>
        </div>
        {completed ? <Badge variant="secondary">Reviewed</Badge> : canComplete ? (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input className="size-4 accent-primary" type="checkbox" name="completePsychologyReview" />
            Mark psychology review complete
          </label>
        ) : <Badge variant="outline">Close trade to complete</Badge>}
        {completed ? <input type="hidden" name="psychologyReviewAlreadyComplete" value="true" /> : null}
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <SelectField name="confidenceBeforeEntry" label="Confidence before entry" items={[{ label: "Not recorded", value: "UNSET" }, ...[1, 2, 3, 4, 5].map((value) => ({ label: String(value), value: String(value) }))]} defaultValue={psychology?.confidence_before_entry ? String(psychology.confidence_before_entry) : "UNSET"} />
        <SelectField name="emotionBefore" label="Emotion before" items={emotionItems} defaultValue={psychology?.emotion_before ?? "UNSET"} />
        <SelectField name="emotionDuring" label="Emotion during" items={emotionItems} defaultValue={psychology?.emotion_during ?? "UNSET"} />
        <SelectField name="emotionAfter" label="Emotion after" items={emotionItems} defaultValue={psychology?.emotion_after ?? "UNSET"} />
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <SelectField name="fearInfluenced" label="Fear influenced the trade" items={yesNoItems} defaultValue={booleanValue(psychology?.fear_influenced)} />
        <SelectField name="greedInfluenced" label="Greed influenced the trade" items={yesNoItems} defaultValue={booleanValue(psychology?.greed_influenced)} />
        <SelectField name="fomoInfluenced" label="FOMO influenced the trade" items={yesNoItems} defaultValue={booleanValue(psychology?.fomo_influenced)} />
      </div>
      <div className="mt-5 space-y-2"><Label htmlFor="psychologyNotes">Psychology notes</Label><Textarea id="psychologyNotes" name="psychologyNotes" rows={4} defaultValue={psychology?.notes ?? ""} /></div>
    </TradeSection>
  );
}
