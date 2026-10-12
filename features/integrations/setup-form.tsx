"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MutationForm } from "@/components/app/mutation-form";
import { setupLabels, type SetupKind } from "@/domain/integrations/setup";
import { prepareIntegrationSetup, checkIntegrationSetup, type SetupActionState } from "./setup-actions";

const initial: SetupActionState = { message: "", profileId: null, ready: false };
const selectClass = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/25";
export function IntegrationSetupForm({ purpose, accounts, operationId, available }: {
  purpose: "MT5" | "MCP"; accounts: { id: string; name: string; currency_code: string }[];
  operationId: string; available: boolean;
}) {
  const [kind, setKind] = useState<SetupKind>(purpose === "MT5" ? "MT5_WINDOWS" : "CODEX");
  const [state, action, pending] = useActionState(prepareIntegrationSetup, initial);
  return <MutationForm action={action} className="space-y-5">
    <input type="hidden" name="operation_id" value={operationId} />
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="setup-client">Integration client</Label>
        <select id="setup-client" name="client_kind" className={selectClass} value={kind}
          onChange={event => setKind(event.target.value as SetupKind)} disabled={!available || Boolean(state.profileId)}>
          {(purpose === "MT5" ? ["MT5_WINDOWS"] as const : ["CODEX", "CLAUDE_CODE", "GEMINI_CLI"] as const)
            .map(value => <option key={value} value={value}>{setupLabels[value]}</option>)}
        </select>
      </div>
      {purpose === "MT5" ? <div className="grid gap-2"><Label htmlFor="setup-account">Trade OS account</Label>
        <select id="setup-account" name="account_id" className={selectClass} required defaultValue=""
          disabled={!available || Boolean(state.profileId)}><option value="" disabled>Select an account</option>
          {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>)}
        </select>
        {!accounts.length ? <Link href="/accounts" className="text-xs font-semibold text-primary hover:underline">Create a Trade OS account first</Link> : null}
      </div> : <p className="self-end text-sm leading-6 text-muted-foreground">Application access is account-free. Permissions require your explicit consent.</p>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">A distinct public client is prepared for this setup. No passwords, trading permissions or AI-provider keys are requested. Configuration readiness is not a successful connection.</p>
    <Button type="submit" disabled={!available || pending || Boolean(state.profileId) || (purpose === "MT5" && !accounts.length)}>
      {pending ? "Preparing setup…" : "Prepare connection setup"}<ArrowRight className="size-4" aria-hidden="true" />
    </Button>
    {state.message ? <p role={state.ready ? "status" : "alert"} className="text-sm leading-6">{state.message}</p> : null}
    {state.profileId ? <Link href={`/settings/integrations/setup/${state.profileId}`} className="inline-flex text-sm font-semibold text-primary hover:underline">Continue saved setup →</Link> : null}
  </MutationForm>;
}
export function CheckSetupRegistration({ id, version, available }: { id: string; version: string; available: boolean }) {
  const [state, action, pending] = useActionState(checkIntegrationSetup, initial);
  return <MutationForm action={action} className="space-y-3">
    <input type="hidden" name="profile_id" value={id} /><input type="hidden" name="version" value={version} />
    <Button variant="outline" type="submit" disabled={!available || pending || state.ready}>{pending ? "Checking registration…" : "Check existing registration"}</Button>
    {state.message ? <p role={state.ready ? "status" : "alert"} className="text-sm leading-6">{state.message}</p> : null}
  </MutationForm>;
}
