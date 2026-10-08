import { Database, FileCheck2, LockKeyhole, Settings2 } from "lucide-react";
import Link from "next/link";
import { randomUUID } from "node:crypto";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveProfileSettings } from "@/features/settings/actions";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getImportOverview } from "@/services/imports/get-import-overview";
import { getProfile } from "@/services/application/profile";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";

interface SettingsPageProps {
  searchParams: Promise<{ error?: string; message?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [query, , supabase] = await Promise.all([searchParams, requireUserId(), createClient()]);
  const [profile, importOverview] = await Promise.all([
    getProfile(await getVerifiedBrowserContext(supabase)),
    getImportOverview(supabase),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace control" title="Settings & data imports" description="Manage journal-local preferences and review the safeguarded path for broker data." />
      <Link href="/settings/integrations" className="inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">Manage integrations & connected clients</Link>
      {query.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{query.error}</p> : null}
      {query.message ? <p role="status" className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{query.message}</p> : null}

      <section className="grid items-start gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader><Settings2 className="size-5 text-primary" aria-hidden="true" /><CardTitle>Journal preferences</CardTitle><CardDescription>The timezone controls journal grouping and account-local review dates. It does not rewrite stored timestamps.</CardDescription></CardHeader>
          <CardContent>
            <form action={saveProfileSettings} className="space-y-5">
              <input type="hidden" name="operationId" value={randomUUID()} />
              <input type="hidden" name="expectedVersion" value={profile.record_version} />
              <div className="space-y-2"><Label htmlFor="displayName">Display name</Label><Input id="displayName" name="displayName" defaultValue={profile?.display_name ?? ""} autoComplete="name" /><p className="text-xs leading-5 text-muted-foreground">Optional name used to personalize this private workspace.</p></div>
              <div className="space-y-2"><Label htmlFor="timezone">Journal timezone</Label><Input id="timezone" name="timezone" defaultValue={profile?.timezone ?? "Africa/Kampala"} required aria-describedby="timezone-help" /><p id="timezone-help" className="text-xs leading-5 text-muted-foreground">Use an IANA timezone such as Africa/Kampala, Europe/London, or America/New_York.</p></div>
              <Button type="submit">Save settings</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><Database className="size-5 text-primary" aria-hidden="true" /><CardTitle>Import architecture</CardTitle><CardDescription>External data is staged, validated, deduplicated, and reviewed before it can become a canonical trade.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CSV</p><p className="mt-2 text-sm font-semibold">Architecture ready</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Mapping and row validation are defined. Commit UI remains disabled until a broker-specific sample is reviewed.</p></div>
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">MT5</p><p className="mt-2 text-sm font-semibold">Read-only synchronization</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Manage dedicated account collectors, source review and reconciliation under Integrations. No automated trading execution.</p></div>
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Broker API</p><p className="mt-2 text-sm font-semibold">Future adapter</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Adapters must populate the same canonical trade model and retain provenance.</p></div>
            </div>
            <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /><div><p className="text-sm font-semibold">Manual reflection keeps priority</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Imports may enrich execution facts. They cannot silently overwrite thesis, psychology, screenshots, reviews, lessons, or rule evidence.</p></div></div>
            <p className="text-xs text-muted-foreground">{importOverview.accountCount} account{importOverview.accountCount === 1 ? "" : "s"} available for explicit import mapping.</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader><FileCheck2 className="size-5 text-primary" aria-hidden="true" /><CardTitle>Import batch history</CardTitle><CardDescription>Batch and row provenance remain visible even when records are skipped, invalid, duplicated, or held for conflict review.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0">
          <Table><TableHeader><TableRow><TableHead>Started</TableHead><TableHead>Account</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Imported / skipped / failed</TableHead></TableRow></TableHeader><TableBody>
            {importOverview.batches.map((batch) => <TableRow key={batch.id}><TableCell>{new Date(batch.started_at).toLocaleString()}</TableCell><TableCell>{batch.accountName}</TableCell><TableCell>{batch.source_type}</TableCell><TableCell><Badge variant={batch.status === "COMPLETED" ? "default" : "secondary"}>{batch.status}</Badge></TableCell><TableCell className="text-right font-mono tabular-nums">{batch.imported_count} / {batch.skipped_count} / {batch.failed_count}</TableCell></TableRow>)}
            {importOverview.batches.length === 0 ? <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No import batches recorded. MT5 source and reconciliation history is available under Integrations.</TableCell></TableRow> : null}
          </TableBody></Table>
        </CardContent>
      </Card>
    </div>
  );
}
