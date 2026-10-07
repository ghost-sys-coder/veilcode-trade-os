"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitMt5Review,changeMt5PublicationPolicy } from "@/features/integrations/mt5-actions";

type Snapshot={connectionId:string;version:string;operationId:string;snapshotToken:string;ledgerToken:string};
function fields(props:Snapshot) { return <><input type="hidden" name="connection_id" value={props.connectionId}/>
  <input type="hidden" name="version" value={props.version}/><input type="hidden" name="operation_id" value={props.operationId}/>
  <input type="hidden" name="snapshot_token" value={props.snapshotToken}/><input type="hidden" name="ledger_token" value={props.ledgerToken}/></>; }

export function Mt5SourceReviewForm(props:Snapshot&{kind:string;sourceId:string;revisionId:string}) {
  const [state,action,pending]=useActionState(submitMt5Review,{message:"",success:false});
  return <form action={action} className="space-y-4">{fields(props)}
    <input type="hidden" name="review_kind" value="SOURCE"/><input type="hidden" name="source_kind" value={props.kind}/>
    <input type="hidden" name="source_id" value={props.sourceId}/><input type="hidden" name="source_revision_id" value={props.revisionId}/>
    <Label htmlFor={`reason-${props.kind}-${props.sourceId}`}>Source review reason</Label>
    <Input id={`reason-${props.kind}-${props.sourceId}`} name="reason" minLength={8} maxLength={1000} required disabled={pending}/>
    <p className="text-xs leading-5 text-muted-foreground">Accept the recorded revision after checking the evidence. Unsupported/canceled events and incomplete history remain blocked. This does not publish a trade or correct its original plan.</p>
    <Button type="submit" disabled={pending}>Accept reviewed source revision</Button>
    {state.message?<p role="alert" className="text-sm">{state.message}</p>:null}
  </form>;
}
export function Mt5ManualReviewForm(props:Snapshot&{canonicalIdentity:string;tradeId:string;tradeToken:string;reopenOnly?:boolean}) {
  const [state,action,pending]=useActionState(submitMt5Review,{message:"",success:false});
  const id=`manual-${props.tradeId}-${props.operationId}`;
  return <form action={action} className="space-y-4">{fields(props)}
    <input type="hidden" name="canonical_identity" value={props.canonicalIdentity}/><input type="hidden" name="trade_id" value={props.tradeId}/>
    <input type="hidden" name="trade_token" value={props.tradeToken}/>
    <div className="grid gap-2"><Label htmlFor={id}>Manual match decision</Label><select id={id} name="review_kind" required defaultValue="" disabled={pending}
      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
      <option value="" disabled>Choose the verified relationship</option>{props.reopenOnly?<option value="REOPEN">Withdraw separate-position decision — require review again</option>:<><option value="DISTINCT">Separate trading positions — retain both</option>
      <option value="LINK">Same position — link broker facts to this existing trade</option></>}</select></div>
    <Label htmlFor={`${id}-reason`}>Manual match reason</Label><Input id={`${id}-reason`} name="reason" required minLength={8} maxLength={1000} disabled={pending}/>
    <p className="text-xs leading-5 text-muted-foreground">Linking retains this trade ID, plans, notes and reviews, replaces execution fields with verified broker evidence, and preserves the previous record in the audit. Closed trades cannot reopen. Separate-position decisions become invalid if the manual trade changes.</p>
    <Button type="submit" disabled={pending}>Record manual match decision</Button>
    {state.message?<p role="alert" className="text-sm">{state.message}</p>:null}
  </form>;
}
export function Mt5CashReconciliationForm(props:Snapshot&{sourceId:string;revisionId:string;previousAmount:string;currentAmount:string;currencyCode:string}) {
  const [state,action,pending]=useActionState(submitMt5Review,{message:"",success:false});
  const id=`cash-reconcile-${props.sourceId}`;
  return <form action={action} className="space-y-4">{fields(props)}<input type="hidden" name="review_kind" value="CASH"/>
    <input type="hidden" name="source_id" value={props.sourceId}/><input type="hidden" name="source_revision_id" value={props.revisionId}/>
    <p className="text-sm">Previously attributed: {props.currencyCode} {props.previousAmount}. Current broker amount: {props.currencyCode} {props.currentAmount}.</p>
    <div className="grid gap-2"><Label htmlFor={id}>Reconciliation delta performance classification</Label><select id={id} name="performance_classification" required defaultValue="" disabled={pending}
      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/25">
      <option value="" disabled>Explicitly classify any monetary difference</option><option value="true">Cash-only — performance-neutral</option><option value="false">Intentionally performance-affecting</option></select></div>
    <Label htmlFor={`${id}-reason`}>Cash reconciliation reason</Label><Input id={`${id}-reason`} name="reason" required minLength={8} maxLength={1000} disabled={pending}/>
    <p className="text-xs leading-5 text-muted-foreground">The existing attribution and adjustment are retained. Only the normalized difference becomes an audited OTHER adjustment; an unchanged amount adds no adjustment. Credit facilities cannot use this workflow.</p>
    <Button type="submit" disabled={pending}>Reconcile revised cash evidence</Button>
    {state.message?<p role="alert" className="text-sm">{state.message}</p>:null}
  </form>;
}
export function Mt5AutomaticPolicyForm(props:Snapshot&{enabled:boolean;ready:boolean}) {
  const [state,action,pending]=useActionState(changeMt5PublicationPolicy,{message:"",success:false});
  return <form action={action} className="space-y-4">{fields(props)}<input type="hidden" name="enabled" value={String(!props.enabled)}/>
    <p className="text-sm font-semibold">Automatic publication: {props.enabled?"Enabled":"Disabled"}</p>
    <p className="text-xs leading-5 text-muted-foreground">Only complete, unambiguous source executions are eligible. Revised broker facts, manual overlaps, unsupported events and uncertain symbols stay staged. Balance reconciliation is separate. Disabling preserves all imported evidence and does not pause collection.</p>
    {!props.enabled&&!props.ready?<p id="mt5-policy-prerequisite" className="rounded-lg border border-border/70 bg-muted/25 p-4 text-sm leading-6">Automatic publication is locked until the current captured-history snapshot is approved. A publication policy reason alone cannot unlock it. <a href="#mt5-onboarding-approval" className="font-semibold text-primary hover:underline">Approve captured history above</a>.</p>:null}
    <Label htmlFor="mt5-policy-reason">Publication policy reason</Label><Input id="mt5-policy-reason" name="reason" required minLength={8} maxLength={1000} disabled={pending||(!props.enabled&&!props.ready)} aria-describedby={!props.enabled&&!props.ready?"mt5-policy-prerequisite":undefined}/>
    <Button type="submit" disabled={pending||(!props.enabled&&!props.ready)}>{props.enabled?"Disable automatic publication":"Enable automatic publication"}</Button>
    {state.message?<p role="alert" className="text-sm">{state.message}</p>:null}
  </form>;
}
