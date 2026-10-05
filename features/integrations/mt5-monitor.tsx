import Link from "next/link";
import { randomUUID } from "node:crypto";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mt5ControlForm } from "@/features/integrations/mt5-forms";
import type { Mt5ConnectionView } from "@/domain/mt5/onboarding";

export function Mt5Monitor({ connections,names }: { connections: Mt5ConnectionView[]; names: Map<string,string> }) {
  return <div className="space-y-4">{connections.map(connection => {
    const stale = connection.heartbeatStale;
    return <Card key={connection.id}>
      <CardHeader className="border-b border-border/70"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{names.get(connection.accountId) ?? "Mapped account"}</CardTitle><Badge variant={connection.status === "ACTIVE" && !stale ? "default" : "secondary"}>{connection.status}</Badge></div>
        <CardDescription>{connection.identity.server} · login {connection.identity.login} · {connection.identity.accountKind} · {connection.identity.positionMode} · {connection.identity.currencyCode}</CardDescription></CardHeader>
      <CardContent className="space-y-5 pt-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Heartbeat</dt><dd className="mt-1 font-medium">{connection.lastHeartbeatAt ? stale ? "Stale — worker needs checking" : "Recent" : "Not received"}</dd><dd className="mt-1 break-all text-xs text-muted-foreground">{connection.lastHeartbeatAt ?? "No worker heartbeat yet"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Last durable sync</dt><dd className="mt-1 break-all font-mono text-xs">{connection.lastSyncAt ?? "Not synchronized"}</dd><dd className="mt-1 text-xs text-muted-foreground">{connection.sourceFactCount} source facts · {connection.publishedTradeCount} published trades</dd></div>
          <div><dt className="text-xs text-muted-foreground">Server collection backlog</dt><dd className="mt-1 font-mono font-semibold">{connection.missingServerBatches} missing batches</dd><dd className="mt-1 text-xs text-muted-foreground">{connection.incompleteCollections} incomplete collections</dd></div>
          <div><dt className="text-xs text-muted-foreground">Review / publication</dt><dd className="mt-1 font-medium">{connection.reviewCount} changed facts to review</dd><dd className="mt-1 text-xs text-muted-foreground">{connection.onboardingApprovedAt ? "Onboarding approved" : "Onboarding not approved"}</dd></div>
        </dl>
        {connection.attentionCode ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm">Attention required: {connection.attentionCode}. Correct the identity/authentication problem before resuming.</p> : null}
        <p className="text-xs leading-5 text-muted-foreground">Health snapshot: {connection.healthObservedAt}. Reload for fresh health. Local pending uploads are not yet reported by the worker. Server missing batches are a separate metric. An active grant or a recent heartbeat does not prove reconciliation.</p>
        <Link href={`/settings/integrations/mt5/${connection.id}`} className="inline-block text-sm font-semibold text-primary hover:underline">Review import preview & balance bridge</Link>
        <details className="rounded-lg border border-border/70 bg-muted/25 open:bg-card"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Worker controls</summary><div className="p-4">
          <Mt5ControlForm key={connection.version} connectionId={connection.id} version={connection.version} operationId={randomUUID()} action={connection.status === "PAUSED" || connection.status === "ATTENTION" ? "RESUME" : "PAUSE"} />
        </div></details>
      </CardContent>
    </Card>;
  })}</div>;
}
