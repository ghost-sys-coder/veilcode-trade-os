import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import { recordTradeManagement } from "@/features/trades/actions";

export function TradeManagementForm({id,operationId,expectedVersion}:{id:string;operationId:string;expectedVersion:string}) {
  return <TradeSection eyebrow="Management history" title="Record actual trade management" description="Append what actually happened. A real stop move is not a correction to the original plan. Financial outcomes remain final-closure results.">
    <form action={recordTradeManagement.bind(null,id)} className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      <input type="hidden" name="operationId" value={operationId} /><input type="hidden" name="expectedVersion" value={expectedVersion} />
      <SelectField name="eventType" label="Management event" required items={["STOP_MOVED","TARGET_CHANGED","SCALE_IN","SCALE_OUT","NOTE"].map(value=>({value,label:value.replaceAll("_"," ")}))} />
      <div className="space-y-2"><Label htmlFor="management-time">Occurred at (UTC)</Label><Input id="management-time" name="occurredAt" type="datetime-local" required /><p className="text-xs text-muted-foreground">For execution changes, use a time within the trade&apos;s opened/closed interval.</p></div>
      <div className="space-y-2"><Label htmlFor="management-price">Price</Label><Input id="management-price" name="price" inputMode="decimal" /><p className="text-xs text-muted-foreground">Required for an actual stop move.</p></div>
      <div className="space-y-2"><Label htmlFor="management-volume">Volume</Label><Input id="management-volume" name="volume" inputMode="decimal" /></div>
      <div className="space-y-2 md:col-span-2 xl:col-span-3"><Label htmlFor="management-notes">What changed and why?</Label><Textarea id="management-notes" name="notes" minLength={5} required /></div>
      <Button type="submit" className="self-end">Record management event</Button>
    </form>
  </TradeSection>;
}
