import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMt5OnboardingPreview, Mt5OnboardingError } from "@/services/mt5/onboarding";
import { Mt5PublicationForm } from "@/features/integrations/mt5-publication-form";
import { Mt5SymbolMappingForm } from "@/features/integrations/mt5-symbol-mapping-form";
import { Mt5CashClassificationForm,Mt5OnboardingApprovalForm } from "@/features/integrations/mt5-cash-onboarding-forms";
import { cashMovementAmount,supportedCashTypes } from "@/domain/mt5/cash";
import { normalizeMoney } from "@/domain/money/decimal";
import { getIntegrationConfig } from "@/config/integrations";
import { formatPositionVolume } from "@/domain/trading/volume-display";
import { Mt5SourceReviewForm,Mt5ManualReviewForm,Mt5AutomaticPolicyForm,Mt5CashReconciliationForm } from "@/features/integrations/mt5-review-forms";

function PositionVolume({ value }: { value: string }) {
  const display = formatPositionVolume(value);
  return <span className="font-mono tabular-nums" title={`Exact captured volume: ${display.raw}`} aria-label={`${display.approximate ? "Approximately " : ""}${display.text.replace("≈", "")} lots; exact captured volume ${display.raw}`}>{display.text}</span>;
}

export default async function Mt5PreviewPage({ params,searchParams }: { params: Promise<{ connectionId: string }>;searchParams:Promise<{status?:string}> }) {
  await requireUserId();
  const { connectionId } = await params;
  if (!z.string().uuid().safeParse(connectionId).success) notFound();
  let data: Awaited<ReturnType<typeof getMt5OnboardingPreview>>;
  try { data = await getMt5OnboardingPreview(await createClient(),connectionId); }
  catch (error) { return <div className="space-y-6"><PageHeader eyebrow="MT5 onboarding" title="Preview unavailable" description={error instanceof Mt5OnboardingError && error.code === "CHANGED" ? "The source or account changed during reading. Pause capture and reload to review one consistent snapshot." : "Verify this account mapping, source history and browser access. An unavailable preview is not a reconciled account."} /><Link href="/settings/integrations" className="text-primary hover:underline">Back to integrations</Link></div>; }
  const { preview,connection } = data;
  const status=(await searchParams).status;
  const published=status==="published";
  const publicationAvailable=getIntegrationConfig("MT5").enabled && ["ONBOARDING","ACTIVE","PAUSED"].includes(connection.status);
  const eligible=preview.episodes.filter(item=>item.publishable).map(({episode})=>({identity:episode.canonicalIdentity,symbol:episode.symbol,
    direction:episode.direction,status:episode.status,openingDeal:episode.openingDealTicket,netPnl:episode.finalNetPnl}));
  const bridge = preview.bridge;
  const approved=data.onboardingApproval?.state==="APPROVED_SNAPSHOT";
  const snapshotProps={connectionId:connection.id,version:connection.version,snapshotToken:data.snapshotToken,ledgerToken:data.ledgerToken};
  const movements=preview.unresolvedCash.map(deal=>{
    const source=data.sources.find(item=>item.kind==="DEAL"&&item.sourceId===deal.ticket);
    return {ticket:deal.ticket,revisionId:source?.revisionId??"",type:deal.type,amount:cashMovementAmount(deal,connection.identity.currencyPrecision),
      occurredAt:deal.occurredAt,supported:supportedCashTypes.includes(deal.type)&&Boolean(source&&!source.requiresReview)};
  }).filter(item=>!data.cashDecisions.some(decision=>decision.sourceTicket===item.ticket));
  const revisedCash=preview.unresolvedCash.flatMap(deal=>{
    const source=data.sources.find(s=>s.kind==="DEAL"&&s.sourceId===deal.ticket&&!s.requiresReview);
    const decision=data.cashDecisions.find(d=>d.sourceTicket===deal.ticket);
    return source&&decision&&supportedCashTypes.includes(deal.type)?[{source,decision,deal}]:[];
  });
  const adjustments=data.adjustments.map(item=>({id:item.id,classified:item.isPerformanceNeutral!==null,
    label:`${item.type.replaceAll("_"," ")} · ${bridge.currencyCode} ${normalizeMoney(item.amount,connection.identity.currencyPrecision)} · ${item.occurredAt}`}));
  const symbols=[...new Set(preview.episodes.map(item=>item.episode.symbol))].sort();
  const bridgeRows = [
    ["Preserved opening baseline",bridge.openingBaseline],["Current canonical ledger balance",bridge.ledgerBalance],
    ["Proposed closed-trade PnL change",bridge.proposedClosedPnlChange],["Cash already recognized on open trades",bridge.openTradeRecognizedCash],
    ["Proposed broker balance basis",bridge.proposedBrokerBalanceBasis],["Observed broker balance",bridge.brokerBalance],
    ["Observed broker equity (not the performance curve)",bridge.brokerEquity],["Unexplained difference",bridge.unexplainedDifference],
  ];
  return <div className="space-y-6">
    <PageHeader eyebrow="MT5 import approval" title={`${data.accountName} · MT5 history`} description={`${connection.identity.server} · ${connection.identity.login}. Review available execution history and explicitly approve eligible canonical trades.`} />
    <Link href="/settings/integrations" className="text-sm font-semibold text-primary hover:underline">Back to integrations</Link>
    {approved?<p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">Captured-history snapshot approved at {data.onboardingApproval?.createdAt}. This source/ledger snapshot is reconciled; it does not prove complete broker lifetime history or enable unattended publication.</p>:null}
    {data.onboardingApproval?.state==="STALE_APPROVAL"?<p role="status" className="rounded-lg border border-border/70 bg-muted/25 p-4 text-sm leading-6">Previous onboarding approval is stale. New source or ledger evidence requires review before the current snapshot can be called reconciled.</p>:null}
    {status==="cash-classified"?<p role="status" className="text-sm">Cash attribution recorded with source evidence and audit history. The balance bridge has been recalculated.</p>:null}
    {status==="review-recorded"?<p role="status" className="text-sm">Review recorded with immutable evidence. Remaining source and reconstruction blockers still require resolution.</p>:null}
    {status==="policy-recorded"?<p role="status" className="text-sm">Publication policy recorded. Collection intent and financial reconciliation are separate.</p>:null}
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Unattended canonical publication</CardTitle></CardHeader><CardContent className="pt-5">
      {publicationAvailable?<Mt5AutomaticPolicyForm {...snapshotProps} operationId={randomUUID()} enabled={data.automaticPublicationEnabled} ready={approved}/>:<p className="text-sm text-muted-foreground">Policy changes require an active integration and account grant.</p>}
    </CardContent></Card>
    {data.sources.some(source=>source.requiresReview)?<Card><CardHeader className="border-b border-border/70"><CardTitle>Review revised broker facts</CardTitle></CardHeader><CardContent className="space-y-5 pt-5">
      {data.sources.filter(source=>source.requiresReview).map(source=><section key={`${source.kind}:${source.sourceId}`} className="space-y-4 rounded-lg border border-border/70 p-4">
        <h2 className="text-sm font-semibold">{source.kind} {source.sourceId} · current revision {source.revisionId}</h2>
        <details><summary className="cursor-pointer text-sm font-semibold">Previous and current broker evidence</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({previous:source.previousPayload??null,current:source.payload},null,2)}</pre></details>
        <Mt5SourceReviewForm {...snapshotProps} operationId={randomUUID()} kind={source.kind} sourceId={source.sourceId} revisionId={source.revisionId}/>
      </section>)}
    </CardContent></Card>:null}
    {preview.episodes.some(item=>item.matchingTradeIds.length)?<Card><CardHeader className="border-b border-border/70"><CardTitle>Review possible manual matches</CardTitle></CardHeader><CardContent className="space-y-5 pt-5">
      {preview.episodes.flatMap(item=>item.matchingTradeIds.map(tradeId=>{const trade=data.existingTrades.find(t=>t.id===tradeId);
        return trade?.reviewToken?<section key={`${item.episode.canonicalIdentity}:${tradeId}`} className="space-y-4 rounded-lg border border-border/70 p-4">
          <h2 className="text-sm font-semibold">{item.episode.symbol} · opening deal {item.episode.openingDealTicket}</h2>
          <Link href={`/trades/${tradeId}`} className="text-sm text-primary hover:underline">Review existing trade {tradeId}</Link>
          <Mt5ManualReviewForm {...snapshotProps} operationId={randomUUID()} canonicalIdentity={item.episode.canonicalIdentity} tradeId={tradeId} tradeToken={trade.reviewToken}/>
        </section>:null;}))}
    </CardContent></Card>:null}
    {data.manualDecisions?.length?<Card><CardHeader><CardTitle>Manual match decision history</CardTitle></CardHeader><CardContent><ul className="space-y-3">{data.manualDecisions.map((decision,index)=>{const trade=data.existingTrades.find(t=>t.id===decision.tradeId);
      const current=data.manualDecisions.filter(d=>d.tradeId===decision.tradeId&&d.canonicalIdentity===decision.canonicalIdentity).at(-1);
      return <li key={index} className="space-y-4 text-sm"><p className="font-semibold">{decision.decision} · trade {decision.tradeId}</p><p className="text-muted-foreground">{decision.reason} · {decision.createdAt}. Applies only to the reviewed trade fingerprint.</p>
        {decision===current&&decision.decision==="DISTINCT"&&trade?.reviewToken?<Mt5ManualReviewForm {...snapshotProps} operationId={randomUUID()} canonicalIdentity={decision.canonicalIdentity}
          tradeId={decision.tradeId} tradeToken={trade.reviewToken} reopenOnly/>:null}</li>;})}</ul></CardContent></Card>:null}
    {revisedCash.length?<Card><CardHeader><CardTitle>Reconcile revised cash movements</CardTitle></CardHeader><CardContent className="space-y-5">{revisedCash.map(({source,decision,deal})=><section key={deal.ticket} className="space-y-4 rounded-lg border border-border/70 p-4">
      <h2 className="text-sm font-semibold">Broker cash ticket {deal.ticket}</h2><Mt5CashReconciliationForm {...snapshotProps} operationId={randomUUID()} sourceId={deal.ticket} revisionId={source.revisionId}
        previousAmount={decision.amount} currentAmount={cashMovementAmount(deal,connection.identity.currencyPrecision)} currencyCode={bridge.currencyCode}/>
    </section>)}</CardContent></Card>:null}
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Broker symbol mapping</CardTitle><CardDescription>Explicitly resolve aliases and ambiguous catalog symbols. Each decision is versioned and audited.</CardDescription></CardHeader><CardContent className="space-y-5 pt-5">
      {status==="symbol-mapped"?<p role="status" className="text-sm">Symbol mapping saved. The preview below uses the approved instrument.</p>:null}
      {data.symbolMappings.length?<ul className="space-y-3">{data.symbolMappings.map(mapping=><li key={mapping.brokerSymbol} className="rounded-lg border border-border/70 bg-muted/25 p-4"><p className="text-sm font-semibold">{mapping.brokerSymbol} → {data.instruments.find(item=>item.id===mapping.instrumentId)?.symbol??"Instrument unavailable"} · version {mapping.version}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{mapping.reason} · {mapping.updatedAt}</p></li>)}</ul>:<p className="text-sm text-muted-foreground">No explicit mappings recorded. Unique exact symbols can resolve without an alias; suffixes are never inferred.</p>}
      {publicationAvailable?<Mt5SymbolMappingForm connectionId={connection.id} version={connection.version} operationId={randomUUID()} snapshotToken={data.snapshotToken} symbols={symbols} instruments={data.instruments}/>:<p className="text-sm text-muted-foreground">Mapping changes are unavailable while this connection needs attention or the integration is disabled.</p>}
    </CardContent></Card>
    <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">{published?"The selected canonical trades were published. ":"Previewing does not import trades. "}{approved?"The current captured snapshot is approved.":"Reconciliation remains unapproved."} Publishing preserves the opening balance; cash classification, conflicts and incomplete history remain explicit review requirements. History availability is not proof of completeness.</p>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Balance reconciliation bridge</CardTitle><CardDescription>Amounts in {bridge.currencyCode}. Trading profit excludes account cash adjustments; open-trade cash is not realized canonical performance.</CardDescription></CardHeader><CardContent className="pt-5"><dl className="space-y-3">{bridgeRows.map(([label,value]) => <div key={label} className="flex flex-wrap justify-between gap-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono font-semibold tabular-nums">{value ?? "Unavailable"}</dd></div>)}</dl></CardContent></Card>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Review requirements</CardTitle><CardDescription>{preview.problems.length} issues; {preview.unresolvedCash.length} cash movements awaiting baseline attribution or classification.</CardDescription></CardHeader><CardContent className="space-y-3 pt-5">{preview.problems.length ? preview.problems.map((problem,index) => <div key={`${problem.code}-${index}`} className="rounded-lg border border-border/70 bg-muted/25 p-4"><p className="text-sm font-semibold">{problem.code.replaceAll("_"," ")}{problem.positionId ? ` · position ${problem.positionId}` : ""}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{problem.detail}</p></div>) : <p className="text-sm text-muted-foreground">No reconstruction blockers found in this snapshot. {approved ? "Captured-history onboarding is approved for this snapshot." : "Explicit onboarding approval is still required."}</p>}</CardContent></Card>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Canonical trade groups</CardTitle><CardDescription>Scale-ins and partial exits stay together. Reversals start a new directional episode. Original plans, risk and reviews are not inferred. Volume displays use up to eight fractional digits; ≈ marks presentation rounding. Hover or use the accessible label for exact captured volume. Tiny nonzero remainders stay visible; display rounding never closes a trade.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><Table><TableHeader><TableRow><TableHead>Identity / symbol</TableHead><TableHead>Execution</TableHead><TableHead>Financial result</TableHead><TableHead>Review</TableHead></TableRow></TableHeader><TableBody>{preview.episodes.map(({ episode,publishable }) => <TableRow key={episode.canonicalIdentity}>
      <TableCell><p className="font-semibold">{episode.symbol} · {episode.direction}</p><p className="mt-1 text-xs text-muted-foreground">Position {episode.positionId} · opening deal {episode.openingDealTicket}</p></TableCell>
      <TableCell><p>{episode.status} · <PositionVolume value={episode.openedVolume} /> opened / <PositionVolume value={episode.remainingVolume} /> remaining</p><p className="mt-1 text-xs text-muted-foreground">{episode.openedAt}{episode.closedAt ? ` → ${episode.closedAt}` : " · still open"}</p></TableCell>
      <TableCell><p className="font-mono tabular-nums">{episode.finalNetPnl ?? "No finalized PnL"}</p><p className="mt-1 text-xs text-muted-foreground">{episode.outcome ?? "Outcome only after complete closure"}</p></TableCell><TableCell>{publishable ? "Eligible for approval" : "Requires resolution"}</TableCell>
    </TableRow>)}{!preview.episodes.length ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No reconstructable trade episodes captured yet.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Approve canonical publication</CardTitle><CardDescription>{eligible.length} eligible groups. Selected execution facts, source attribution and the approval audit commit together. Pause server capture to freeze a preview; manual approval does not resume the worker.</CardDescription></CardHeader><CardContent className="pt-5">
      {publicationAvailable && eligible.length?<Mt5PublicationForm connectionId={connection.id} version={connection.version} operationId={randomUUID()}
        snapshotToken={data.snapshotToken} ledgerToken={data.ledgerToken} openingBaseline={bridge.openingBaseline} currencyCode={bridge.currencyCode} episodes={eligible}/>
        :<p className="text-sm leading-6 text-muted-foreground">{publicationAvailable?"No eligible groups are available. Resolve the listed execution-history requirements first.":"Publication is unavailable while this connection needs attention or the integration is disabled."}</p>}
    </CardContent></Card>
    {preview.cashMovements.length ? <Card><CardHeader className="border-b border-border/70"><CardTitle>Broker cash movements</CardTitle><CardDescription>No movement is automatically counted twice as opening funding and an adjustment.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><Table><TableHeader><TableRow><TableHead>Ticket / date</TableHead><TableHead>Broker type</TableHead><TableHead>Normalized cash</TableHead><TableHead>Classification</TableHead></TableRow></TableHeader><TableBody>{preview.cashMovements.map(movement => {
      const decision=data.cashDecisions.find(item=>item.sourceTicket===movement.ticket);
      const unresolved=preview.unresolvedCash.some(item=>item.ticket===movement.ticket);
      return <TableRow key={movement.ticket}><TableCell>{movement.ticket}<p className="mt-1 text-xs text-muted-foreground">{movement.occurredAt}</p></TableCell><TableCell>{movement.type}</TableCell><TableCell className="font-mono">{cashMovementAmount(movement,connection.identity.currencyPrecision)}</TableCell><TableCell>{decision ? unresolved ? "Source changed: reconciliation required" : decision.disposition.replaceAll("_"," ") : "Awaiting explicit attribution"}</TableCell></TableRow>;
    })}</TableBody></Table></CardContent></Card> : null}
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Classify broker cash evidence</CardTitle><CardDescription>{preview.unresolvedCash.length} unresolved movements. Signed amounts include broker profit, commission, swap and fees, normalized once in {bridge.currencyCode}.</CardDescription></CardHeader><CardContent className="space-y-4 pt-5">
      {data.cashDecisions.length?<ul className="space-y-3">{data.cashDecisions.map(decision=><li key={decision.sourceTicket} className="rounded-lg border border-border/70 bg-muted/25 p-4"><p className="text-sm font-semibold">Ticket {decision.sourceTicket} · {decision.disposition.replaceAll("_"," ")} · {bridge.currencyCode} {decision.amount}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{decision.reason} · revision {decision.sourceRevisionId} · {decision.createdAt}</p></li>)}</ul>:null}
      {publicationAvailable&&movements.length?<Mt5CashClassificationForm key={`${connection.version}:${data.snapshotToken}:${data.ledgerToken}`} connectionId={connection.id} version={connection.version} operationId={randomUUID()} snapshotToken={data.snapshotToken} ledgerToken={data.ledgerToken} currencyCode={bridge.currencyCode} movements={movements} adjustments={adjustments}/>:<p className="text-sm text-muted-foreground">{movements.length?"Cash classification is unavailable while the connection requires attention or integration is disabled.":"No unresolved captured cash movements."}</p>}
    </CardContent></Card>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>{approved ? "Captured-history onboarding approved" : "Approve captured-history onboarding"}</CardTitle><CardDescription>All reconstructed executions must be published, all cash evidence resolved, and the current normalized bridge must balance exactly.</CardDescription></CardHeader><CardContent className="pt-5">{approved ? <p className="text-sm leading-6 text-muted-foreground">Approval is recorded for the current source and ledger snapshot. New or revised evidence requires another review. This does not resume a paused collector or enable unattended publication.</p> : <Mt5OnboardingApprovalForm key={`${connection.version}:${data.snapshotToken}:${data.ledgerToken}`} connectionId={connection.id} version={connection.version} operationId={randomUUID()} snapshotToken={data.snapshotToken} ledgerToken={data.ledgerToken} openingBaseline={bridge.openingBaseline} currencyCode={bridge.currencyCode} ready={publicationAvailable&&data.onboardingReady}/>}</CardContent></Card>
  </div>;
}
