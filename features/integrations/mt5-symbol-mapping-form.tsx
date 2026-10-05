"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mapMt5BrokerSymbol } from "@/features/integrations/mt5-actions";

const selectClass="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/25";
export function Mt5SymbolMappingForm(props:{connectionId:string;version:string;snapshotToken:string;operationId:string;
  symbols:string[];instruments:{id:string;symbol:string;display_name:string;user_id:string|null}[]}) {
  const [state,action,pending]=useActionState(mapMt5BrokerSymbol,{message:"",success:false});
  return <form action={action} className="space-y-4">
    <input type="hidden" name="connection_id" value={props.connectionId}/><input type="hidden" name="version" value={props.version}/>
    <input type="hidden" name="operation_id" value={props.operationId}/><input type="hidden" name="snapshot_token" value={props.snapshotToken}/>
    <fieldset disabled={pending} className="grid gap-4 md:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="mt5-broker-symbol">Captured broker symbol</Label>
        <select id="mt5-broker-symbol" name="broker_symbol" required defaultValue="" className={selectClass}>
          <option value="" disabled>Select a captured symbol</option>{props.symbols.map(symbol=><option key={symbol} value={symbol}>{symbol}</option>)}
        </select></div>
      <div className="grid gap-2"><Label htmlFor="mt5-mapped-instrument">Corresponding Trade OS instrument</Label>
        <select id="mt5-mapped-instrument" name="instrument_id" required defaultValue="" className={selectClass}>
          <option value="" disabled>Select the corresponding instrument</option>{props.instruments.map(instrument=><option key={instrument.id} value={instrument.id}>{instrument.symbol} · {instrument.display_name} · {instrument.user_id ? "Your instrument" : "Shared catalog"}</option>)}
        </select></div>
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="mt5-symbol-reason">Symbol mapping reason</Label>
        <Input id="mt5-symbol-reason" name="reason" required minLength={8} maxLength={1000} placeholder="Explain the confirmed broker/instrument relationship"/></div>
    </fieldset>
    <p className="text-xs leading-5 text-muted-foreground">No suffixes or approximate names are guessed. This records instrument identity only, without converting currencies, prices or volumes. Published symbols cannot be reassigned.</p>
    <Button type="submit" disabled={pending || !props.symbols.length || !props.instruments.length}>{pending?"Saving mapping…":"Approve symbol mapping"}</Button>
    {state.message?<p role="alert" className="text-sm leading-6">{state.message}</p>:null}
  </form>;
}
