"use client";

import { useActionState,useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { classifyMt5CashMovement,completeMt5Onboarding } from "@/features/integrations/mt5-actions";

const selectClass="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/25";
type SnapshotProps={connectionId:string;version:string;operationId:string;snapshotToken:string;ledgerToken:string};
function SnapshotFields(props:SnapshotProps) {
  return <><input type="hidden" name="connection_id" value={props.connectionId}/><input type="hidden" name="version" value={props.version}/>
    <input type="hidden" name="operation_id" value={props.operationId}/><input type="hidden" name="snapshot_token" value={props.snapshotToken}/><input type="hidden" name="ledger_token" value={props.ledgerToken}/></>;
}
export function Mt5CashClassificationForm(props:SnapshotProps & {
  movements:{ticket:string;revisionId:string;type:string;amount:string;occurredAt:string;supported:boolean}[];
  adjustments:{id:string;label:string;classified:boolean}[];currencyCode:string;
}) {
  const [state,action,pending]=useActionState(classifyMt5CashMovement,{message:"",success:false});
  const [ticket,setTicket]=useState("");const [disposition,setDisposition]=useState("");const [type,setType]=useState("");
  const movement=props.movements.find(item=>item.ticket===ticket);
  const adjustment=["ADJUSTMENT","LINK_EXISTING"].includes(disposition);
  return <form action={action} className="space-y-4">
    <SnapshotFields {...props}/><input type="hidden" name="source_revision_id" value={movement?.revisionId??""}/>
    <fieldset disabled={pending} className="grid gap-4 md:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="mt5-cash-ticket">Unresolved cash movement</Label>
        <select id="mt5-cash-ticket" name="source_ticket" required value={ticket} onChange={event=>setTicket(event.target.value)} className={selectClass}>
          <option value="" disabled>Select broker cash evidence</option>{props.movements.map(item=><option key={item.ticket} value={item.ticket} disabled={!item.supported}>{item.ticket} · {item.type} · {props.currencyCode} {item.amount}{item.supported?"":" · Requires source review"}</option>)}
        </select></div>
      <div className="grid gap-2"><Label htmlFor="mt5-cash-disposition">Cash attribution</Label>
        <select id="mt5-cash-disposition" name="disposition" required value={disposition} onChange={event=>setDisposition(event.target.value)} className={selectClass}>
          <option value="" disabled>Choose the confirmed meaning</option><option value="BASELINE_FUNDING">Opening funding already in baseline</option>
          <option value="ADJUSTMENT">Create an account adjustment</option><option value="LINK_EXISTING">Already recorded — link existing adjustment</option><option value="ZERO_EFFECT">Normalized zero — retain evidence only</option>
        </select></div>
      {adjustment?<><div className="grid gap-2"><Label htmlFor="mt5-cash-type">Adjustment type</Label><select id="mt5-cash-type" name="adjustment_type" required value={type} onChange={event=>setType(event.target.value)} className={selectClass}>
        <option value="" disabled>Select adjustment type</option><option value="DEPOSIT">Deposit</option><option value="WITHDRAWAL">Withdrawal</option><option value="BALANCE_CORRECTION">Balance correction</option><option value="OTHER">Other — explicitly classify performance</option>
      </select></div>{type==="OTHER"?<div className="grid gap-2"><Label htmlFor="mt5-cash-neutral">Performance classification</Label><select id="mt5-cash-neutral" name="performance_classification" required defaultValue="" className={selectClass}>
        <option value="" disabled>Choose performance treatment</option><option value="true">Cash-only — performance-neutral</option><option value="false">Intentionally performance-affecting</option>
      </select></div>:<p className="self-end text-xs leading-5 text-muted-foreground">Deposits, withdrawals and balance corrections are performance-neutral. They are not trading profit.</p>}</>:null}
      {disposition==="LINK_EXISTING"?<div className="grid gap-2 md:col-span-2"><Label htmlFor="mt5-cash-existing">Existing recorded adjustment</Label><select id="mt5-cash-existing" name="existing_adjustment_id" required defaultValue="" className={selectClass}>
        <option value="" disabled>Select the matching account record</option>{props.adjustments.map(item=><option key={item.id} value={item.id} disabled={!item.classified}>{item.label}{item.classified?"":" · Classification required"}</option>)}
      </select></div>:null}
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="mt5-cash-reason">Cash classification reason</Label><Input id="mt5-cash-reason" name="reason" required minLength={8} maxLength={1000} placeholder="Explain the evidence for this attribution"/></div>
    </fieldset>
    <p className="text-xs leading-5 text-muted-foreground">Opening funding is not counted twice. Linking an existing record creates no additional adjustment. Credit facilities and unsupported broker types stay unresolved. Recorded financial evidence cannot be casually rewritten or deleted.</p>
    <Button type="submit" disabled={pending||!movement?.supported}>{pending?"Recording classification…":"Record cash classification"}</Button>
    {state.message?<p role="alert" className="text-sm leading-6">{state.message}</p>:null}
  </form>;
}
export function Mt5OnboardingApprovalForm(props:SnapshotProps & {openingBaseline:string;currencyCode:string;ready:boolean}) {
  const [state,action,pending]=useActionState(completeMt5Onboarding,{message:"",success:false});
  return <form action={action} className="space-y-4"><SnapshotFields {...props}/><input type="hidden" name="opening_baseline" value={props.openingBaseline}/>
    <fieldset disabled={pending||!props.ready} className="space-y-4">
      <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/25 p-4 text-sm leading-6"><input type="checkbox" name="confirm_history" required className="mt-1 accent-primary"/>
        <span>I reviewed all captured available history, the preserved opening baseline of {props.currencyCode} {props.openingBaseline}, and the cash/partial-exit bridge. This does not prove the broker supplied complete lifetime history.</span></label>
      <div className="grid gap-2"><Label htmlFor="mt5-onboarding-reason">Onboarding approval reason</Label><Input id="mt5-onboarding-reason" name="reason" required minLength={8} maxLength={1000} placeholder="Explain the evidence for approving this captured snapshot"/></div>
    </fieldset>
    <p className="text-xs leading-5 text-muted-foreground">Approval preserves the baseline and only covers this source/ledger snapshot. New or revised evidence makes it stale. A paused collector stays paused. Unattended canonical publication is not enabled by this action.</p>
    {!props.ready?<p className="text-sm text-muted-foreground">Resolve the review requirements, publish all reconstructed executions and verify a current zero-difference bridge before approval.</p>:null}
    <Button type="submit" disabled={pending||!props.ready}>{pending?"Approving snapshot…":"Approve captured-history onboarding"}</Button>
    {state.message?<p role="alert" className="text-sm leading-6">{state.message}</p>:null}
  </form>;
}
