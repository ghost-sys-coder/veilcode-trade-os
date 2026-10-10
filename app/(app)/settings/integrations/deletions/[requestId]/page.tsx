import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { getDeletion, inspectDeletion } from "@/services/application/deletions";
import type { DeletionRecord } from "@/domain/deletions/commands";
import { decideDeletionRequest, resumeDeletionRequest } from "@/features/integrations/deletion-actions";
import { PageHeader } from "@/components/app/page-header";
import { MutationForm } from "@/components/app/mutation-form";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default async function DeletionApprovalPage({ params, searchParams }: {
  params: Promise<{ requestId: string }>; searchParams: Promise<{ result?: string }>;
}) {
  await requireUserId(); const [{ requestId }, query, client] = await Promise.all([params, searchParams, createClient()]);
  let record: DeletionRecord | null = null, current = false, effect = "DELETE";
  try {
    const context = await getVerifiedBrowserContext(client); record = await getDeletion(context, { requestId });
    effect = record.target.effect;
    if (record.status === "PENDING") {
      try { const target = await inspectDeletion(context, { entity: record.target.entity, id: record.target.id });
        current = target.version === record.target.version; effect = target.effect;
      } catch { current = false; }
    }
  } catch { /* Missing/inaccessible/schema unavailable are never approvals. */ }
  return <div className="space-y-6">
    <PageHeader eyebrow="Secure connections" title="Review deletion request" description="Only you can approve this exact action. Opening this page does not approve or delete anything." />
    <Link href="/settings/integrations" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">Back to integrations</Link>
    {query.result === "failed" ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">Approval was not recorded. Reload and check the target, expiry and client access before retrying.</p> : null}
    {!record ? <p role="alert" className="rounded-lg border border-border/70 p-4 text-sm">This request is unavailable. Check your session and the deletion migration; no action was approved.</p> : <Card>
      <CardHeader className="border-b border-border/70"><CardTitle>{record.target.name}</CardTitle><CardDescription>{record.target.entity} · {record.status}</CardDescription></CardHeader>
      <CardContent className="space-y-5 pt-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Requesting client</dt><dd className="mt-1 break-words font-semibold">{record.clientName}</dd></div>
          <div><dt className="text-muted-foreground">Account context</dt><dd className="mt-1 font-semibold">{record.target.accountName ?? "Owned workspace configuration"}</dd></div>
          <div><dt className="text-muted-foreground">Exact record</dt><dd className="mt-1 break-all font-mono text-xs">{record.target.id}</dd></div>
          <div><dt className="text-muted-foreground">Target version</dt><dd className="mt-1 break-all font-mono text-xs">{record.target.version}</dd></div>
          <div><dt className="text-muted-foreground">Known references at request</dt><dd className="mt-1 font-semibold">{record.target.referenceCount}</dd></div>
          <div><dt className="text-muted-foreground">One-use execution ID</dt><dd className="mt-1 break-all font-mono text-xs">{record.executionOperationId}</dd></div>
          <div><dt className="text-muted-foreground">Reason</dt><dd className="mt-1 break-words">{record.reason}</dd></div>
          <div><dt className="text-muted-foreground">Approval expires (UTC)</dt><dd className="mt-1 break-words">{record.expiresAt}</dd></div>
        </dl>
        <p className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm leading-6">{effect === "ARCHIVE"
          ? "Historical or current references require archival. The record and its evidence will be preserved, not permanently deleted."
          : record.target.entity === "SCREENSHOT" ? "Approved execution removes this attachment from the workspace. Image removal remains PURGE_PENDING until Storage confirms it. Image bytes are not recoverable after deletion; audit metadata is retained."
          : "Approved execution permanently removes this unused record. If a historical reference is found at execution, it will be archived instead. Audit evidence is never deleted."}</p>
        {record.status === "PENDING" ? <>
          {!current ? <p role="alert" className="text-sm text-destructive">The target changed or is unavailable. This request cannot be approved; ask the client for a fresh inspection and request.</p> : null}
          <MutationForm action={decideDeletionRequest} className="space-y-4">
            <input type="hidden" name="requestId" value={record.requestId} /><input type="hidden" name="operationId" value={randomUUID()} />
            <input type="hidden" name="expectedVersion" value={record.version} /><input type="hidden" name="decision" value="APPROVE" />
            <Label className="flex items-start gap-3 text-sm"><input type="checkbox" name="acknowledged" value="true" required className="mt-0.5 size-4 shrink-0 accent-primary" />I reviewed the exact record and authorize this one execution.</Label>
            <Button type="submit" variant="destructive" disabled={!current}>Approve one-use action</Button>
          </MutationForm>
          <MutationForm action={decideDeletionRequest}><input type="hidden" name="requestId" value={record.requestId} /><input type="hidden" name="operationId" value={randomUUID()} />
            <input type="hidden" name="expectedVersion" value={record.version} /><input type="hidden" name="decision" value="REJECT" /><Button variant="outline" type="submit">Reject request</Button></MutationForm>
        </> : record.status === "PURGE_PENDING" ? <MutationForm action={resumeDeletionRequest} className="space-y-3">
          <p role="status" className="text-sm text-muted-foreground">The attachment is hidden. Physical file removal is still pending; retry only this already-approved job.</p>
          <input type="hidden" name="requestId" value={record.requestId} /><Button variant="outline" type="submit">Retry file removal</Button>
        </MutationForm> : <p role="status" className="text-sm text-muted-foreground">{record.status === "APPROVED" ? "Approved for the original client and execution ID only. Approval has not executed the action." : record.status === "DELETED" ? "Deletion completed. Original audit metadata is preserved." : record.status === "ARCHIVED" ? "Referenced record archived; historical evidence is preserved." : "No new execution is authorized by this request."}</p>}
      </CardContent>
    </Card>}
  </div>;
}
