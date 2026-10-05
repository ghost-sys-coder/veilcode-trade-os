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
import { getIntegrationConfig } from "@/config/integrations";

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
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Broker symbol mapping</CardTitle><CardDescription>Explicitly resolve aliases and ambiguous catalog symbols. Each decision is versioned and audited.</CardDescription></CardHeader><CardContent className="space-y-5 pt-5">
      {status==="symbol-mapped"?<p role="status" className="text-sm">Symbol mapping saved. The preview below uses the approved instrument.</p>:null}
      {data.symbolMappings.length?<ul className="space-y-3">{data.symbolMappings.map(mapping=><li key={mapping.brokerSymbol} className="rounded-lg border border-border/70 bg-muted/25 p-4"><p className="text-sm font-semibold">{mapping.brokerSymbol} → {data.instruments.find(item=>item.id===mapping.instrumentId)?.symbol??"Instrument unavailable"} · version {mapping.version}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{mapping.reason} · {mapping.updatedAt}</p></li>)}</ul>:<p className="text-sm text-muted-foreground">No explicit mappings recorded. Unique exact symbols can resolve without an alias; suffixes are never inferred.</p>}
      {publicationAvailable?<Mt5SymbolMappingForm connectionId={connection.id} version={connection.version} operationId={randomUUID()} snapshotToken={data.snapshotToken} symbols={symbols} instruments={data.instruments}/>:<p className="text-sm text-muted-foreground">Mapping changes are unavailable while this connection needs attention or the integration is disabled.</p>}
    </CardContent></Card>
    <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">{published?"The selected canonical trades were published. ":"Previewing does not import trades. "}Reconciliation remains unapproved. Publishing preserves the opening balance; cash classification, conflicts and incomplete history remain explicit review requirements. History availability is not proof of completeness.</p>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Balance reconciliation bridge</CardTitle><CardDescription>Amounts in {bridge.currencyCode}. Trading profit excludes account cash adjustments; open-trade cash is not realized canonical performance.</CardDescription></CardHeader><CardContent className="pt-5"><dl className="space-y-3">{bridgeRows.map(([label,value]) => <div key={label} className="flex flex-wrap justify-between gap-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono font-semibold tabular-nums">{value ?? "Unavailable"}</dd></div>)}</dl></CardContent></Card>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Review requirements</CardTitle><CardDescription>{preview.problems.length} issues; {preview.cashMovements.length} cash movements awaiting baseline attribution or classification.</CardDescription></CardHeader><CardContent className="space-y-3 pt-5">{preview.problems.length ? preview.problems.map((problem,index) => <div key={`${problem.code}-${index}`} className="rounded-lg border border-border/70 bg-muted/25 p-4"><p className="text-sm font-semibold">{problem.code.replaceAll("_"," ")}{problem.positionId ? ` · position ${problem.positionId}` : ""}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{problem.detail}</p></div>) : <p className="text-sm text-muted-foreground">No reconstruction blockers found in this snapshot. Explicit onboarding approval is still required.</p>}</CardContent></Card>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Canonical trade groups</CardTitle><CardDescription>Scale-ins and partial exits stay together. Reversals start a new directional episode. Original plans, risk and reviews are not inferred.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><Table><TableHeader><TableRow><TableHead>Identity / symbol</TableHead><TableHead>Execution</TableHead><TableHead>Financial result</TableHead><TableHead>Review</TableHead></TableRow></TableHeader><TableBody>{preview.episodes.map(({ episode,publishable }) => <TableRow key={episode.canonicalIdentity}>
      <TableCell><p className="font-semibold">{episode.symbol} · {episode.direction}</p><p className="mt-1 text-xs text-muted-foreground">Position {episode.positionId} · opening deal {episode.openingDealTicket}</p></TableCell>
      <TableCell><p>{episode.status} · {episode.openedVolume} opened / {episode.remainingVolume} remaining</p><p className="mt-1 text-xs text-muted-foreground">{episode.openedAt}{episode.closedAt ? ` → ${episode.closedAt}` : " · still open"}</p></TableCell>
      <TableCell><p className="font-mono tabular-nums">{episode.finalNetPnl ?? "No finalized PnL"}</p><p className="mt-1 text-xs text-muted-foreground">{episode.outcome ?? "Outcome only after complete closure"}</p></TableCell><TableCell>{publishable ? "Eligible for approval" : "Requires resolution"}</TableCell>
    </TableRow>)}{!preview.episodes.length ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No reconstructable trade episodes captured yet.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Approve canonical publication</CardTitle><CardDescription>{eligible.length} eligible groups. Selected execution facts, source attribution and the approval audit commit together. Pause server capture to freeze a preview; manual approval does not resume the worker.</CardDescription></CardHeader><CardContent className="pt-5">
      {publicationAvailable && eligible.length?<Mt5PublicationForm connectionId={connection.id} version={connection.version} operationId={randomUUID()}
        snapshotToken={data.snapshotToken} ledgerToken={data.ledgerToken} openingBaseline={bridge.openingBaseline} currencyCode={bridge.currencyCode} episodes={eligible}/>
        :<p className="text-sm leading-6 text-muted-foreground">{publicationAvailable?"No eligible groups are available. Resolve the listed execution-history requirements first.":"Publication is unavailable while this connection needs attention or the integration is disabled."}</p>}
    </CardContent></Card>
    {preview.cashMovements.length ? <Card><CardHeader className="border-b border-border/70"><CardTitle>Broker cash movements</CardTitle><CardDescription>No movement is automatically counted twice as opening funding and an adjustment.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><Table><TableHeader><TableRow><TableHead>Ticket / date</TableHead><TableHead>Broker type</TableHead><TableHead>Broker amount</TableHead><TableHead>Classification</TableHead></TableRow></TableHeader><TableBody>{preview.cashMovements.map(movement => <TableRow key={movement.ticket}><TableCell>{movement.ticket}<p className="mt-1 text-xs text-muted-foreground">{movement.occurredAt}</p></TableCell><TableCell>{movement.type}</TableCell><TableCell className="font-mono">{movement.profit}</TableCell><TableCell>Awaiting explicit attribution</TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : null}
  </div>;
}
