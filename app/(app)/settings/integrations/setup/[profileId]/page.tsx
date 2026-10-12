import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { integrationSetupAvailability, readSetupState } from "@/services/integrations/setup-profiles";
import { listConnectedGrants } from "@/services/integrations/grant-management";
import { listMt5Connections } from "@/services/mt5/onboarding";
import { setupLabels, setupProgress, type SetupProfile } from "@/domain/integrations/setup";
import { CheckSetupRegistration } from "@/features/integrations/setup-form";
import type { IntegrationDatabase } from "@/types/integration-database";

export default async function IntegrationSetupPage({ params }: { params: Promise<{ profileId: string }> }) {
  await requireUserId();
  const id = z.string().uuid().safeParse((await params).profileId);
  if (!id.success) notFound();
  const client = await createClient() as SupabaseClient<IntegrationDatabase>;
  let profile: SetupProfile | undefined;
  let unavailable = false;
  let databaseEnabled = false;
  try {
    const state = await readSetupState(client);
    profile = state.profiles.find(row => row.id === id.data);
    if (profile) databaseEnabled = state.databaseEnabled[profile.purpose];
  } catch { unavailable = true; }
  if (!profile && !unavailable) notFound();
  if (!profile) return <div className="space-y-6"><PageHeader title="Setup temporarily unavailable" description="The saved setup could not be verified. No registration was repeated." />
    <Link href="/settings/integrations" className="text-sm font-semibold text-primary hover:underline">Return to integrations</Link></div>;
  const availability = integrationSetupAvailability(profile.purpose);
  const available = availability.enabled && databaseEnabled;
  let grantsUnavailable = false;
  let grant: Awaited<ReturnType<typeof listConnectedGrants>>[number] | undefined;
  let reviewId: string | undefined;
  try {
    const grants = await listConnectedGrants(client);
    grant = grants.find(item => item.client_id === profile!.clientId && item.purpose === profile!.purpose
      && item.resource === profile!.resource && item.account_id === profile!.accountId);
    if (profile.purpose === "MT5" && grant) reviewId = (await listMt5Connections(client)).find(row => row.grantId === grant!.id)?.id;
  } catch { grantsUnavailable = true; }
  const progress = setupProgress(profile, grant);
  return <div className="space-y-6">
    <PageHeader eyebrow="Saved connection setup" title={`${setupLabels[profile.clientKind]} setup`}
      description="Configuration, consent and verified activity are separate milestones. No setup step silently grants access." />
    <Link href="/settings/integrations" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="size-4" aria-hidden="true" />Back to integrations</Link>
    <Card><CardHeader className="border-b border-border/70"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Connection progress</CardTitle>
      <Badge variant="secondary">{grantsUnavailable ? "Access state unavailable" : progress.label}</Badge></div>
      <CardDescription>Prepared {new Date(profile.createdAt).toISOString()} · Registration version {profile.version}</CardDescription></CardHeader>
      <CardContent className="space-y-5 pt-5">
        {!available ? <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">Setup is disabled or its rollout policy is not enabled. Your saved profile, grants and imported data are preserved.</p> : null}
        <section className="space-y-3"><h2 className="text-sm font-semibold">1. Public registration</h2>
          <p className="text-sm leading-6 text-muted-foreground">{profile.status === "READY" ? "Provider registration was verified. This is public configuration, not permission to read your account." : "A durable registration attempt is saved. Check its existing provider record rather than sending another create request."}</p>
          {profile.status === "REGISTERING" ? <CheckSetupRegistration id={profile.id} version={profile.version} available={available} /> :
            <Button variant="outline" nativeButton={!available} disabled={!available} render={available ? <a href={`/api/integrations/setup/${profile.id}/configuration`} /> : undefined}>
              <Download className="size-4" aria-hidden="true" />Download public configuration</Button>}
        </section>
        <section className="space-y-3 border-t border-border/70 pt-5"><h2 className="text-sm font-semibold">2. Install or configure the client</h2>
          <p className="text-sm leading-6 text-muted-foreground">{profile.purpose === "MT5" ? "The Windows companion must select a dedicated demo terminal and verify its server, login, currency precision and position mode. The downloaded bootstrap is not a runnable collector manifest."
            : "Local stdio requires the Windows adapter. Its generated configuration is compatible with the existing adapter; client installation and approval still need to be completed."}</p>
          <p role="status" className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm leading-6">The packaged Windows companion is not released yet. Installation cannot be completed through this screen in this increment. No worker or startup task is installed by preparing a profile.</p>
        </section>
        <section className="space-y-3 border-t border-border/70 pt-5"><h2 className="text-sm font-semibold">3. Approve application access</h2>
          <p className="text-sm leading-6 text-muted-foreground">{grantsUnavailable ? "Access state could not be loaded. No active permission can be inferred."
            : grant?.status === "ACTIVE" && !grant.revoked_at ? "An active matching grant exists. You can revoke it separately in Integrations; it does not prove the client is online."
              : "Start authorization from the configured client or companion, then approve the verified browser consent request. Opening the consent page without a request cannot authorize anything."}</p>
          <Link href="/settings/integrations" className="text-sm font-semibold text-primary hover:underline">Manage authorized clients</Link>
        </section>
        <section className="space-y-3 border-t border-border/70 pt-5"><h2 className="text-sm font-semibold">4. Verify activity and review</h2>
          <p className="text-sm leading-6 text-muted-foreground">{profile.purpose === "MT5" ? "A heartbeat and durable sync must be observed. Review symbol mappings, missing history, account cash and the balance bridge before approving publication."
            : "Verify discovery and a real owner-scoped read in the selected AI client. Configuration and provider consent alone are not successful tool execution."}</p>
          {reviewId ? <Button variant="outline" nativeButton={false} render={<Link href={`/settings/integrations/mt5/${reviewId}`} />}>Review MT5 history and balance bridge</Button> : null}
        </section>
        <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-4"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-xs leading-5 text-muted-foreground">OAuth credentials stay in protected local storage, never configuration downloads. Existing account balance, planned values, reviews and MT5 controls are unchanged.</p></div>
      </CardContent>
    </Card>
  </div>;
}
