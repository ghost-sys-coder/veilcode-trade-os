import { ArrowLeft, Edit3, ImageIcon, Tag } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { assignTag, removeTag } from "@/features/journal/actions";
import { SelectField } from "@/features/trades/select-field";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getManualTradeRecord, getTradeFormReferences } from "@/services/trades/get-trade-form-data";
import { SCREENSHOT_CATEGORIES } from "@/types/domain";
import { plannedActualComparison } from "@/domain/journal/analytics";

interface TradeDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
}

function show(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replaceAll("_", " ");
}

export default async function TradeDetailPage({ params, searchParams }: TradeDetailPageProps) {
  const [{ id }, status, userId, supabase] = await Promise.all([params, searchParams, requireUserId(), createClient()]);
  const [record, references, tagsResult, tradeTagsResult] = await Promise.all([
    getManualTradeRecord(supabase, id, userId),
    getTradeFormReferences(supabase),
    supabase.from("tags").select("id,name,color").order("name"),
    supabase.from("trade_tags").select("tag_id").eq("trade_id", id),
  ]);
  if (!record) notFound();
  const trade = record.trade;
  const account = references.accounts.find((item) => item.id === trade.account_id);
  const instrument = references.instruments.find((item) => item.id === trade.instrument_id);
  const strategy = references.strategies.find((item) => item.id === trade.strategy_id);
  const setup = references.setups.find((item) => item.id === trade.setup_id);
  const assignedIds = new Set((tradeTagsResult.data ?? []).map((item) => item.tag_id));
  const tags = tagsResult.data ?? [];
  const assignedTags = tags.filter((tag) => assignedIds.has(tag.id));
  const availableTags = tags.filter((tag) => !assignedIds.has(tag.id));
  const signedByPath = new Map<string, string>();
  await Promise.all(record.screenshots.map(async (screenshot) => {
    const { data } = await supabase.storage.from("trade-screenshots").createSignedUrl(screenshot.storage_path, 3600);
    if (data?.signedUrl) signedByPath.set(screenshot.storage_path, data.signedUrl);
  }));
  const ruleResultById = new Map(record.ruleResults.map((result) => [result.trading_rule_id, result]));
  const complianceRules = references.rules.filter((rule) => (rule.active && (rule.account_id === null || rule.account_id === trade.account_id)) || ruleResultById.has(rule.id));
  const activeApplicableRules = complianceRules.filter((rule) => rule.active && (rule.account_id === null || rule.account_id === trade.account_id));
  const reviewedActiveRules = activeApplicableRules.filter((rule) => ruleResultById.has(rule.id));
  const violations = activeApplicableRules.filter((rule) => ruleResultById.get(rule.id)?.complied === false).length;
  const complianceState = activeApplicableRules.length === 0 || reviewedActiveRules.length < activeApplicableRules.length ? "NOT_REVIEWED" : violations ? "VIOLATIONS_PRESENT" : "FULLY_COMPLIANT";
  const comparisons = plannedActualComparison({ plannedEntry: trade.planned_entry, actualEntry: trade.actual_entry, plannedStop: trade.planned_stop_loss, actualStop: trade.actual_stop_loss, plannedTarget: trade.planned_take_profit, actualExit: trade.actual_exit, plannedVolume: trade.planned_lot_size, actualVolume: trade.actual_lot_size, plannedRisk: trade.planned_risk_amount, netPnl: trade.net_pnl, plannedRr: trade.planned_risk_reward, actualR: trade.actual_r }, account?.currency_code ?? "currency");

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Canonical trade record" title={`${instrument?.symbol ?? "Trade"} · ${trade.direction}`} description="The complete decision, execution, management, and review record for this position." actions={<div className="flex gap-2"><Button variant="outline" nativeButton={false} render={<Link href="/trades"><ArrowLeft />Journal</Link>} /><Button nativeButton={false} render={<Link href={`/trades/${id}/edit`}><Edit3 />Edit record</Link>} /></div>} />
      {status.error || tagsResult.error || tradeTagsResult.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{status.error ?? tagsResult.error?.message ?? tradeTagsResult.error?.message}</p> : null}
      {status.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{status.message}</p> : null}

      <Card><CardContent className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4">{[["Instrument", instrument?.symbol], ["Account", account?.name], ["Journal date", trade.opened_at ?? trade.planned_at ?? trade.created_at], ["Status", trade.status], ["Outcome", trade.outcome], ["Net PnL", trade.net_pnl === null ? null : `${account?.currency_code} ${trade.net_pnl}`], ["Actual R", trade.actual_r === null ? null : `${trade.actual_r}R`], ["Grade", record.review?.trade_quality_grade]].map(([label, value]) => <div key={label}><p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1.5 font-semibold">{show(value)}</p></div>)}</CardContent></Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Original plan</CardTitle><CardDescription>Current corrected values are shown; correction evidence remains below.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{[["Thesis", trade.thesis], ["Entry rationale", trade.entry_reason], ["Confirmation notes", trade.confirmation_notes], ["Strategy", strategy?.name], ["Setup", setup?.name], ["Higher-timeframe bias", trade.higher_timeframe_bias], ["Market condition", trade.market_condition], ["Planned entry", trade.planned_entry], ["Planned stop", trade.planned_stop_loss], ["Planned target", trade.planned_take_profit], ["Planned lot size", trade.planned_lot_size], ["Risk amount", trade.planned_risk_amount], ["Risk percentage", trade.planned_risk_percentage], ["Planned RR", trade.planned_risk_reward]].map(([label, value]) => <div key={label} className={["Thesis", "Entry rationale", "Confirmation notes"].includes(String(label)) ? "sm:col-span-2" : ""}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap font-medium">{show(value)}</p></div>)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Actual execution</CardTitle><CardDescription>Observed fills, costs, and elapsed time.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{[["Actual entry", trade.actual_entry], ["Actual stop", trade.actual_stop_loss], ["Actual exit", trade.actual_exit], ["Actual lot size", trade.actual_lot_size], ["Holding duration", trade.holding_duration_seconds === null ? null : `${trade.holding_duration_seconds}s`], ["Commission", trade.commission], ["Swap", trade.swap], ["Other fees", trade.other_fees]].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{show(value)}</p></div>)}</CardContent></Card>
      </section>

      <Card><CardHeader><CardTitle>Plan versus actual</CardTitle><CardDescription>Labels preserve the meaning and units of unlike values; this table does not imply direct equivalence.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><div className="grid grid-cols-[1.2fr_1fr_1fr] border-y border-border/70 bg-muted/30 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><span>Measure</span><span>Planned</span><span>Actual / result</span></div>{comparisons.map(({ label, planned, actual, unit }) => <div key={label} className="grid grid-cols-[1.2fr_1fr_1fr] gap-3 border-b border-border/60 px-5 py-3 text-sm"><div><p className="font-medium">{label}</p><p className="text-xs text-muted-foreground">{unit}</p></div><p className="font-mono tabular-nums">{show(planned)}</p><p className="font-mono tabular-nums">{show(actual)}</p></div>)}</CardContent></Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Targets and partial exits</CardTitle></CardHeader><CardContent className="space-y-3">{record.targets.map((target) => <div key={target.id} className="rounded-lg border border-border/70 p-3 text-sm"><div className="flex justify-between"><strong>{target.label}</strong><span>{target.hit_at ? "Hit" : "Not hit"}</span></div><p className="mt-2 text-muted-foreground">Plan {target.planned_price} · {show(target.planned_close_percentage)}%</p><p className="text-muted-foreground">Fill {show(target.actual_fill_price)} · closed {show(target.actual_close_percentage)}%</p><p className="text-muted-foreground">PnL contribution {show(target.pnl_contribution)}</p></div>)}{record.targets.length === 0 ? <p className="text-sm text-muted-foreground">No staged targets were recorded.</p> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle>Trade management</CardTitle><CardDescription>Execution events are separate from corrections to the recorded plan.</CardDescription></CardHeader><CardContent className="space-y-3">{record.managementEvents.map((event) => <div key={event.id} className="rounded-lg border border-border/70 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{event.event_type.replaceAll("_", " ")}</strong><time className="text-xs text-muted-foreground">{new Date(event.occurred_at).toLocaleString()}</time></div><p className="mt-2 text-muted-foreground">Price {show(event.price)} · volume {show(event.volume)}</p><p className="mt-1 whitespace-pre-wrap">{event.notes ?? "No note"}</p></div>)}{record.managementEvents.length === 0 ? <p className="text-sm text-muted-foreground">No management events were recorded.</p> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle>Execution quality</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{record.executionReview ? Object.entries(record.executionReview).filter(([key]) => !["id", "user_id", "trade_id", "created_at", "updated_at"].includes(key)).map(([key, value]) => <div key={key} className="flex justify-between gap-4 border-b border-border/50 py-2"><span className="text-muted-foreground">{key.replaceAll("_", " ")}</span><span className="text-right font-medium">{show(value)}</span></div>) : <p className="text-muted-foreground">No execution review yet.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Psychology</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{record.psychology ? Object.entries(record.psychology).filter(([key]) => !["id", "user_id", "trade_id", "created_at", "updated_at"].includes(key)).map(([key, value]) => <div key={key} className="flex justify-between gap-4 border-b border-border/50 py-2"><span className="text-muted-foreground">{key.replaceAll("_", " ")}</span><span className="text-right font-medium">{show(value)}</span></div>) : <p className="text-muted-foreground">No psychology review yet.</p>}</CardContent></Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Rule compliance</CardTitle><Badge variant={complianceState === "VIOLATIONS_PRESENT" ? "destructive" : "secondary"}>{complianceState}</Badge></div><CardDescription>Not reviewed is never treated as compliant.</CardDescription></CardHeader><CardContent className="space-y-3">{complianceRules.map((rule) => { const result = ruleResultById.get(rule.id); return <div key={rule.id} className="flex items-start justify-between gap-4 rounded-lg border border-border/70 p-3"><div><p className="font-medium">{rule.name}</p><p className="mt-1 text-xs text-muted-foreground">{result?.notes ?? "No review recorded"}</p></div><Badge variant={result?.complied === false ? "destructive" : "secondary"}>{result ? result.complied ? "FOLLOWED" : "VIOLATED" : "NOT REVIEWED"}</Badge></div>; })}{complianceRules.length === 0 ? <p className="text-sm text-muted-foreground">NOT REVIEWED — no enabled rule review is applicable.</p> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle>Post-trade review</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">{[["Grade", record.review?.trade_quality_grade], ["Would take again", record.review?.would_take_again], ["What worked", record.review?.what_went_well], ["What failed", record.review?.what_went_wrong], ["Improvement", record.review?.improvement], ["Lesson", record.review?.lesson_learned]].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap font-medium">{show(value)}</p></div>)}</CardContent></Card>
      </section>

      <Card><CardHeader><ImageIcon className="size-5 text-primary" /><CardTitle>Screenshots</CardTitle><CardDescription>Grouped by review stage. Open any available image for full-size inspection.</CardDescription></CardHeader><CardContent className="space-y-5">{SCREENSHOT_CATEGORIES.map((category) => {
        const screenshots = record.screenshots.filter((item) => item.category === category);
        if (!screenshots.length) return null;
        return <section key={category}><h3 className="mb-2 text-sm font-semibold">{category.replaceAll("_", " ")}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{screenshots.map((screenshot) => { const url = signedByPath.get(screenshot.storage_path); return <a key={screenshot.id} href={url ?? "#"} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-border/70 bg-muted/30"><div role="img" aria-label={screenshot.caption ?? category} className="aspect-video bg-cover bg-center" style={url ? { backgroundImage: `url(${JSON.stringify(url)})` } : undefined} /><div className="p-3"><p className="text-sm font-medium">{screenshot.caption ?? "Untitled screenshot"}</p><p className="text-xs text-muted-foreground">{screenshot.timeframe ?? "No timeframe"} · Open full size</p></div></a>; })}</div></section>;
      })}{record.screenshots.length === 0 ? <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No screenshots attached to this trade.</div> : null}</CardContent></Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Plan correction history</CardTitle><CardDescription>Append-only evidence of post-open recorded-value corrections.</CardDescription></CardHeader><CardContent className="space-y-3">{record.corrections.map((correction) => <div key={correction.id} className="rounded-lg border border-border/70 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{correction.field_name.replaceAll("_", " ")}</strong><time className="text-xs text-muted-foreground">{new Date(correction.created_at).toLocaleString()}</time></div><p className="mt-2 font-mono text-xs">{JSON.stringify(correction.previous_value)} → {JSON.stringify(correction.new_value)}</p><p className="mt-2 text-muted-foreground">{correction.reason}</p></div>)}{record.corrections.length === 0 ? <p className="text-sm text-muted-foreground">No plan corrections. The recorded plan remains unchanged.</p> : null}</CardContent></Card>
        <Card><CardHeader><Tag className="size-5 text-primary" /><CardTitle>Tags</CardTitle><CardDescription>User-owned labels with case-insensitive uniqueness.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap gap-2">{assignedTags.map((tag) => <form action={removeTag} key={tag.id}><input type="hidden" name="tradeId" value={id} /><input type="hidden" name="tagId" value={tag.id} /><input type="hidden" name="returnPath" value={`/trades/${id}`} /><Button type="submit" size="sm" variant="outline">{tag.name} ×</Button></form>)}{assignedTags.length === 0 ? <p className="text-sm text-muted-foreground">No tags assigned.</p> : null}</div>{availableTags.length ? <form action={assignTag} className="flex items-end gap-2"><input type="hidden" name="tradeId" value={id} /><input type="hidden" name="returnPath" value={`/trades/${id}`} /><div className="flex-1"><SelectField label="Assign tag" name="tagId" required items={availableTags.map((tag) => ({ value: tag.id, label: tag.name }))} /></div><Button type="submit">Assign</Button></form> : <p className="text-xs text-muted-foreground">Create more tags from the journal page.</p>}</CardContent></Card>
      </section>
    </div>
  );
}
