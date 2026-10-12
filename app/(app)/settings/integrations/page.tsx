import Link from "next/link";
import { randomUUID } from "node:crypto";
import { PlugZap, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { revokeClientAccess } from "@/features/integrations/actions";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listConnectedGrants, type ConnectedGrant } from "@/services/integrations/grant-management";
import { listMt5Connections } from "@/services/mt5/onboarding";
import type { Mt5ConnectionView } from "@/domain/mt5/onboarding";
import { Mt5Monitor } from "@/features/integrations/mt5-monitor";
import { Mt5MappingForm } from "@/features/integrations/mt5-forms";
import { IntegrationSetupStart } from "@/features/integrations/setup-start";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireUserId();
  const [query, client] = await Promise.all([searchParams,createClient()]);
  let grants: ConnectedGrant[] = [];
  let unavailable = false;
  try { grants = await listConnectedGrants(client); } catch { unavailable = true; }
  let connections: Mt5ConnectionView[] = [];
  let monitorUnavailable = false;
  try { connections = await listMt5Connections(client); } catch { monitorUnavailable = true; }
  const accounts = await client.from("trading_accounts").select("id,name,currency_code,currency_precision");
  const names = new Map((accounts.data ?? []).map((account) => [account.id,account.name]));
  const permissions = grants.filter(grant => grant.purpose === "MT5" && grant.status === "ACTIVE"
    && !connections.some(connection => connection.accountId === grant.account_id)).flatMap(grant => {
      const account = accounts.data?.find(account => account.id === grant.account_id);
      return account ? [{ grantId: grant.id,accountName: account.name,currencyCode: account.currency_code,currencyPrecision: account.currency_precision }] : [];
    });
  return <div className="space-y-6">
    <PageHeader eyebrow="Workspace control" title="Integrations & connected clients" description="Inspect authorized account scope and revoke client access immediately. Broker execution and AI-provider credentials are never part of a connection." />
    <Link href="/settings" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">Back to settings</Link>
    <IntegrationSetupStart />
    {query.status === "revoked" ? <p role="status" className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm">Application access and provider consent revoked.</p> : null}
    {query.status === "revoked-provider-pending" ? <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">Application access is revoked immediately. Provider credential revocation needs a retry; use Retry provider revocation below.</p> : null}
    {query.status === "failed" ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">The grant could not be revoked. Reload to get its current version and retry.</p> : null}
    {query.status === "mapped" ? <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">Demo account mapped. Start capture with the dedicated collector, then review the import preview.</p> : null}
    {query.status === "paused" ? <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">Server uploads paused; the previous worker lease is invalidated.</p> : null}
    {query.status === "resumed" ? <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">Server capture enabled. If the local collector is paused or requires attention, explicitly resume it locally after resolving the cause.</p> : null}
    <Card>
      <CardHeader className="border-b border-border/70"><ShieldCheck className="size-5 text-primary" aria-hidden="true" /><CardTitle>Authorized clients</CardTitle><CardDescription>MT5 grants cover exactly one account. MCP grants cover normal application workflows; permanent deletion requires separate browser confirmation.</CardDescription></CardHeader>
      <CardContent className="px-0 pb-0"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Authorized scope</TableHead><TableHead>State</TableHead><TableHead>Resource / version</TableHead><TableHead>Access control</TableHead></TableRow></TableHeader><TableBody>
        {grants.map((grant) => <TableRow key={grant.id}>
          <TableCell><p className="font-semibold">{grant.purpose} client</p><p className="mt-1 font-mono text-xs text-muted-foreground">{grant.client_id}</p></TableCell>
          <TableCell>{grant.account_id ? names.get(grant.account_id) ?? "Account unavailable" : "Full application"}</TableCell>
          <TableCell><Badge variant={grant.status === "ACTIVE" ? "default" : "secondary"}>{grant.status}</Badge></TableCell>
          <TableCell><p className="max-w-80 break-all text-xs text-muted-foreground">{grant.resource}</p><p className="mt-1 font-mono text-xs">Version {grant.version}</p></TableCell>
          <TableCell><form action={revokeClientAccess}><input type="hidden" name="grant_id" value={grant.id} /><input type="hidden" name="version" value={grant.version} /><Button variant="outline" type="submit">{grant.status === "REVOKED" ? "Retry provider revocation" : "Revoke access"}</Button></form></TableCell>
        </TableRow>)}
        {!grants.length ? <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">{unavailable ? "Connected-client management is unavailable. Integration migrations and authenticated browser access are required." : "No clients authorized. Start a connection from an approved integration client."}</TableCell></TableRow> : null}
      </TableBody></Table></CardContent>
    </Card>
    <div className="flex gap-3 rounded-lg border border-border/70 bg-muted/30 p-4"><PlugZap className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /><p className="text-sm leading-6 text-muted-foreground">Dedicated demo terminals only. Broker orders are never placed, changed or canceled. Imported plans and behavioral reviews remain unknown unless the user supplies evidence.</p></div>
    {monitorUnavailable ? <p role="alert" className="rounded-lg border border-border/70 p-4 text-sm">MT5 monitoring is unavailable. Verify the onboarding migrations and browser session; no terminal-health claim can be made.</p> : connections.length ? <Mt5Monitor connections={connections} names={names} /> : <p className="text-sm text-muted-foreground">No dedicated MT5 accounts mapped yet.</p>}
    {!monitorUnavailable && permissions.length ? <Card><CardHeader className="border-b border-border/70"><CardTitle>Map a dedicated demo terminal</CardTitle><CardDescription>Select an already-consented account and record its exact broker identity.</CardDescription></CardHeader><CardContent className="pt-5"><Mt5MappingForm permissions={permissions} operationId={randomUUID()} /></CardContent></Card> : null}
  </div>;
}
