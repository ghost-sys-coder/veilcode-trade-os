"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mapMt5Account, changeMt5State } from "@/features/integrations/mt5-actions";

const selectClass = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/25";
type Permission = { grantId: string; accountName: string; currencyCode: string; currencyPrecision: number };
const initial = { message: "",success: false };

export function Mt5MappingForm({ permissions,operationId }: { permissions: Permission[]; operationId: string }) {
  const [grantId,setGrantId] = useState(permissions[0]?.grantId ?? "");
  const selected = permissions.find(item => item.grantId === grantId);
  const [state,action,pending] = useActionState(mapMt5Account,initial);
  return <form action={action} className="space-y-4">
    <input type="hidden" name="operation_id" value={operationId} />
    <input type="hidden" name="currency_code" value={selected?.currencyCode ?? ""} />
    <input type="hidden" name="currency_precision" value={selected?.currencyPrecision ?? ""} />
    <div className="grid gap-4 md:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="mt5-grant">Authorized Trade OS account</Label>
        <select id="mt5-grant" name="grant_id" required className={selectClass} value={grantId} onChange={event => setGrantId(event.target.value)}>
          {permissions.map(permission => <option key={permission.grantId} value={permission.grantId}>{permission.accountName} · {permission.currencyCode} · {permission.currencyPrecision} decimals</option>)}
        </select></div>
      <div className="grid gap-2"><Label htmlFor="mt5-server">Exact broker demo server</Label><Input id="mt5-server" name="server" required maxLength={255} placeholder="Broker-Demo" /></div>
      <div className="grid gap-2"><Label htmlFor="mt5-login">Demo account login</Label><Input id="mt5-login" name="login" required inputMode="numeric" pattern="[1-9][0-9]{0,19}" maxLength={20} autoComplete="off" /></div>
      <div className="grid gap-2"><Label htmlFor="mt5-mode">Position accounting mode</Label><select id="mt5-mode" name="position_mode" required className={selectClass}><option value="HEDGING">Hedging</option><option value="NETTING">Netting</option></select></div>
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="mt5-terminal">Dedicated collector terminal-installation ID</Label><Input id="mt5-terminal" name="terminal_installation_id" required maxLength={36} placeholder="UUID from the dedicated collector configuration" /><p className="text-xs leading-5 text-muted-foreground">Use the exact UUID in the collector manifest, not the terminal data-folder hash. Never enter a broker password here.</p></div>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">Mapping permits read-only capture, not publication approval. The dedicated terminal must match this account, currency precision and position mode. Your existing terminal is not switched or modified.</p>
    <Button type="submit" disabled={pending || !selected || state.success}>{pending ? "Mapping…" : "Map dedicated demo account"}</Button>
    {state.message ? <p role={state.success ? "status" : "alert"} className="text-sm leading-6">{state.message}</p> : null}
  </form>;
}

export function Mt5ControlForm({ connectionId,version,operationId,action: controlAction }: {
  connectionId: string; version: string; operationId: string; action: "PAUSE" | "RESUME";
}) {
  const [state,action,pending] = useActionState(changeMt5State,initial);
  const reasonId = `mt5-reason-${connectionId}-${controlAction}`;
  return <form action={action} className="space-y-3">
    <input type="hidden" name="connection_id" value={connectionId} /><input type="hidden" name="version" value={version} />
    <input type="hidden" name="operation_id" value={operationId} /><input type="hidden" name="action" value={controlAction} />
    <div className="grid gap-2"><Label htmlFor={reasonId}>{controlAction === "PAUSE" ? "Pause reason" : "Resume reason"}</Label>
      <Input id={reasonId} name="reason" required minLength={8} maxLength={1000} placeholder="Explain the operator control change" /></div>
    <Button type="submit" variant="outline" disabled={pending || state.success}>{pending ? "Applying…" : controlAction === "PAUSE" ? "Pause server uploads" : "Resume server capture"}</Button>
    {state.message ? <p role={state.success ? "status" : "alert"} className="text-sm leading-6">{state.message}</p> : null}
  </form>;
}
