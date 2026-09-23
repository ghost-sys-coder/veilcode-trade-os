import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/features/trades/select-field";
import { SwitchField } from "@/features/trades/switch-field";
import { TradeSection } from "@/features/trades/trade-section";
import { TRADE_EMOTIONS } from "@/types/domain";
import type { TradePsychologyRow } from "@/types/database-helpers";

interface PsychologySectionProps { psychology?: TradePsychologyRow | null }

const emotionItems = [
  { label: "Not recorded", value: "UNSET" },
  ...TRADE_EMOTIONS.map((value) => ({ label: value.replaceAll("_", " "), value })),
];

export function PsychologySection({ psychology }: PsychologySectionProps) {
  return (
    <TradeSection eyebrow="08 · Psychology" title="Mental state" description="Capture emotion and confidence for later comparison. Confidence is subjective, not a quality score.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <SelectField name="confidenceBeforeEntry" label="Confidence before entry" items={[{ label: "Not recorded", value: "UNSET" }, ...[1, 2, 3, 4, 5].map((value) => ({ label: String(value), value: String(value) }))]} defaultValue={psychology?.confidence_before_entry ? String(psychology.confidence_before_entry) : "UNSET"} />
        <SelectField name="emotionBefore" label="Emotion before" items={emotionItems} defaultValue={psychology?.emotion_before ?? "UNSET"} />
        <SelectField name="emotionDuring" label="Emotion during" items={emotionItems} defaultValue={psychology?.emotion_during ?? "UNSET"} />
        <SelectField name="emotionAfter" label="Emotion after" items={emotionItems} defaultValue={psychology?.emotion_after ?? "UNSET"} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <SwitchField name="fearInfluenced" label="Fear influenced the trade" defaultChecked={psychology?.fear_influenced} />
        <SwitchField name="greedInfluenced" label="Greed influenced the trade" defaultChecked={psychology?.greed_influenced} />
        <SwitchField name="fomoInfluenced" label="FOMO influenced the trade" defaultChecked={psychology?.fomo_influenced} />
      </div>
      <div className="mt-5 space-y-2"><Label htmlFor="psychologyNotes">Psychology notes</Label><Textarea id="psychologyNotes" name="psychologyNotes" rows={4} defaultValue={psychology?.notes ?? ""} /></div>
    </TradeSection>
  );
}
