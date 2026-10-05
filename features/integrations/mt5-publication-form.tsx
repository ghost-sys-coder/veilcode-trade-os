"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { approveMt5Publication } from "@/features/integrations/mt5-actions";

type Props={connectionId:string; version:string; operationId:string; snapshotToken:string; ledgerToken:string;
  openingBaseline:string; currencyCode:string; episodes:{identity:string;symbol:string;direction:string;status:string;openingDeal:string;netPnl:string|null}[]};

export function Mt5PublicationForm(props: Props) {
  const [state,action,pending]=useActionState(approveMt5Publication,{message:"",success:false});
  return <form action={action} className="space-y-4">
    <input type="hidden" name="connection_id" value={props.connectionId}/><input type="hidden" name="version" value={props.version}/>
    <input type="hidden" name="operation_id" value={props.operationId}/><input type="hidden" name="snapshot_token" value={props.snapshotToken}/>
    <input type="hidden" name="ledger_token" value={props.ledgerToken}/><input type="hidden" name="opening_baseline" value={props.openingBaseline}/>
    <fieldset disabled={pending} className="space-y-3">
      <legend className="text-sm font-semibold">Select the canonical trades to publish</legend>
      <p className="text-xs leading-5 text-muted-foreground">Select up to 1,000 eligible groups. Unresolved groups stay staged; matching manual trades are never silently overwritten.</p>
      {props.episodes.map(episode=><label key={episode.identity} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-muted/25 p-4">
        <input className="mt-1 accent-primary" type="checkbox" name="episode_identity" value={episode.identity}/>
        <span className="text-sm"><span className="font-semibold">{episode.symbol} · {episode.direction} · opening deal {episode.openingDeal}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{episode.status} · {episode.netPnl===null?"No realized PnL until complete closure":`${episode.netPnl} ${props.currencyCode} final net PnL`}</span></span>
      </label>)}
      <label className="flex items-start gap-3 rounded-lg border border-border/70 p-4 text-sm leading-6">
        <input type="checkbox" name="confirm_baseline" required className="mt-1 accent-primary"/>
        <span>I confirm the preserved opening baseline of <span className="font-mono font-semibold">{props.openingBaseline} {props.currencyCode}</span>. This approval does not change it or classify broker cash movements.</span>
      </label>
      <div className="grid gap-2"><Label htmlFor="mt5-publication-reason">Publication approval reason</Label>
        <Input id="mt5-publication-reason" name="reason" required minLength={8} maxLength={1000} placeholder="Explain why this execution history is approved"/></div>
    </fieldset>
    <p className="text-xs leading-5 text-muted-foreground">Plans and reviews remain untouched. Publishing selected trades does not approve reconciliation or authorize unattended imports. If the preview changes, the server rejects it.</p>
    <Button type="submit" disabled={pending || !props.episodes.length}>{pending?"Publishing…":"Publish selected trades"}</Button>
    {state.message?<p role="alert" className="text-sm leading-6">{state.message}</p>:null}
  </form>;
}
