import Link from "next/link";
import { z } from "zod";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  integrationSetupAvailability,
  readSetupState,
} from "@/services/integrations/setup-profiles";
import { listConnectedGrants } from "@/services/integrations/grant-management";
import { listMt5Connections } from "@/services/mt5/onboarding";
import {
  setupLabels,
  setupProgress,
  type SetupProfile,
} from "@/domain/integrations/setup";
import { CheckSetupRegistration } from "@/features/integrations/setup-form";
import { Mt5PairingForm } from "@/features/integrations/mt5-pairing-form";
import { getBrowserMt5Pairing } from "@/services/integrations/mt5-pairing";
import { randomUUID } from "node:crypto";
import type { IntegrationDatabase } from "@/types/integration-database";
import { companionDistribution } from "@/domain/integrations/companion-distribution";

export default async function IntegrationSetupPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  await requireUserId();
  const id = z
    .string()
    .uuid()
    .safeParse((await params).profileId);
  if (!id.success) notFound();
  const client = (await createClient()) as SupabaseClient<IntegrationDatabase>;
  let profile: SetupProfile | undefined;
  let unavailable = false;
  let databaseEnabled = false;
  try {
    const state = await readSetupState(client);
    profile = state.profiles.find((row) => row.id === id.data);
    if (profile) databaseEnabled = state.databaseEnabled[profile.purpose];
  } catch {
    unavailable = true;
  }
  if (!profile && !unavailable) notFound();
  if (!profile)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Setup temporarily unavailable"
          description="The saved setup could not be verified. No registration was repeated."
        />
        <Link
          href="/settings/integrations"
          className="text-sm font-semibold text-primary hover:underline"
        >
          Return to integrations
        </Link>
      </div>
    );
  const availability = integrationSetupAvailability(profile.purpose);
  const available = availability.enabled && databaseEnabled;
  const distribution =
    available && profile.status === "READY"
      ? companionDistribution(process.env)
      : null;
  let grantsUnavailable = false;
  let grant:
    | Awaited<ReturnType<typeof listConnectedGrants>>[number]
    | undefined;
  let reviewId: string | undefined;
  let existing: { id: string; version: string; status: string } | null = null;
  let pairing: Awaited<ReturnType<typeof getBrowserMt5Pairing>> = null;
  let pairingUnavailable = false;
  try {
    const grants = await listConnectedGrants(client);
    grant = grants.find(
      (item) =>
        item.client_id === profile!.clientId &&
        item.purpose === profile!.purpose &&
        item.resource === profile!.resource &&
        item.account_id === profile!.accountId,
    );
    if (profile.purpose === "MT5") {
      existing =
        (await listMt5Connections(client)).find(
          (row) => row.accountId === profile!.accountId,
        ) ?? null;
      if (existing?.id) reviewId = existing.id;
    }
  } catch {
    grantsUnavailable = true;
  }
  const progress = setupProgress(profile, grant);
  if (profile.purpose === "MT5" && available) {
    try {
      pairing = await getBrowserMt5Pairing(client, profile.id);
    } catch {
      pairingUnavailable = true;
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Saved connection setup"
        title={`${setupLabels[profile.clientKind]} setup`}
        description="Configuration, consent and verified activity are separate milestones. No setup step silently grants access."
      />
      <Link
        href="/settings/integrations"
        className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to integrations
      </Link>
      <Card>
        <CardHeader className="min-w-0 border-b border-border/70">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <CardTitle>Connection progress</CardTitle>
            <Badge variant="secondary" className="h-auto min-h-6 max-w-full whitespace-normal">
              {grantsUnavailable ? "Access state unavailable" : progress.label}
            </Badge>
          </div>
          <CardDescription className="wrap-break-word">
            Prepared {new Date(profile.createdAt).toISOString()} · Registration
            version {profile.version}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {!available ? (
            <p
              role="status"
              className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6"
            >
              Setup is disabled or its rollout policy is not enabled. Your saved
              profile, grants and imported data are preserved.
            </p>
          ) : null}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">1. Public registration</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {profile.status === "READY"
                ? "Provider registration was verified. This is public configuration, not permission to read your account."
                : "A durable registration attempt is saved. Check its existing provider record rather than sending another create request."}
            </p>
            {profile.status === "REGISTERING" ? (
              <CheckSetupRegistration
                id={profile.id}
                version={profile.version}
                available={available}
              />
            ) : (
              <Button
                variant="outline"
                nativeButton={!available}
                disabled={!available}
                render={
                  available ? (
                    <a
                      href={`/api/integrations/setup/${profile.id}/configuration`}
                    />
                  ) : undefined
                }
              >
                <Download className="size-4" aria-hidden="true" />
                Download public configuration
              </Button>
            )}
          </section>
          <section className="space-y-3 border-t border-border/70 pt-5">
            <h2 className="text-sm font-semibold">
              2. Install or configure the client
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {profile.purpose === "MT5"
                ? "The Windows companion must select a dedicated demo terminal and verify its server, login, currency precision and position mode. The downloaded bootstrap is not a runnable collector manifest."
                : "Local stdio requires the Windows adapter. Its generated configuration is compatible with the existing adapter; client installation and approval still need to be completed."}
            </p>
            {distribution ? (
              <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-4">
                <p role="status" className="text-sm leading-6">
                  Unsigned Windows 10/11 x64 preview · Framework 4.8 required.
                  This is a testing build, not a signed or production-certified
                  release. Do not disable Windows security protections to
                  install it.
                </p>
                <Button
                  variant="outline"
                  className="h-auto min-h-10 max-w-full whitespace-normal"
                  nativeButton={false}
                  render={<a href={distribution.url} rel="noreferrer" />}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Download Windows companion preview
                </Button>
                <p className="text-sm leading-6 text-muted-foreground">
                  Choose a local installation folder, open TradeOS.exe, then
                  import the public configuration from step 1. No Git checkout,
                  npm, pip, broker password or AI-provider key is needed.
                  Installation starts no integration or startup task.
                </p>
                <p className="break-all text-xs leading-5 text-muted-foreground">
                  {distribution.tag} ·{" "}
                  {(distribution.bytes / 1_048_576).toFixed(1)} MiB
                  <br />
                  SHA-256: {distribution.sha256}
                </p>
                <a
                  href={distribution.releaseUrl}
                  className="text-sm font-semibold text-primary hover:underline"
                  rel="noreferrer"
                >
                  Preview notes and verification limits
                </a>
              </div>
            ) : (
              <p
                role="status"
                className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm leading-6"
              >
                No verified companion download is available for this setup
                environment. Preparing a profile does not install or connect a
                client. Your saved setup and grants are preserved.
              </p>
            )}
          </section>
          <section className="space-y-3 border-t border-border/70 pt-5">
            <h2 className="text-sm font-semibold">
              3. Approve application access
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {grantsUnavailable
                ? "Access state could not be loaded. No active permission can be inferred."
                : grant?.status === "ACTIVE" && !grant.revoked_at
                  ? "An active matching grant exists. You can revoke it separately in Integrations; it does not prove the client is online."
                  : "Start authorization from the configured client or companion, then approve the verified browser consent request. Opening the consent page without a request cannot authorize anything."}
            </p>
            <Link
              href="/settings/integrations"
              className="text-sm font-semibold text-primary hover:underline"
            >
              Manage authorized clients
            </Link>
          </section>
          {profile.purpose === "MT5" &&
          profile.clientId &&
          profile.accountId ? (
            <section className="space-y-3 border-t border-border/70 pt-5">
              <h2 className="text-sm font-semibold">
                4. Review dedicated-terminal mapping
              </h2>
              {pairingUnavailable ? (
                <p role="alert" className="text-sm">
                  Mapping state is unavailable. No approval or empty state is
                  inferred.
                </p>
              ) : pairing ? (
                <>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Mapping approved at {pairing.approvedAt}. Import this mapped
                    configuration into the companion to initialize PAUSED; it is
                    not evidence of collection or reconciliation.
                  </p>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a
                        href={
                          "/api/integrations/setup/" + profile.id + "/pairing"
                        }
                      />
                    }
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Download approved mapping
                  </Button>
                </>
              ) : (
                <Mt5PairingForm
                  profileId={profile.id}
                  version={profile.version}
                  clientId={profile.clientId}
                  accountId={profile.accountId}
                  operationId={randomUUID()}
                  existing={existing}
                  available={
                    available &&
                    !grantsUnavailable &&
                    grant?.status === "ACTIVE" &&
                    !grant.revoked_at
                  }
                />
              )}
            </section>
          ) : null}
          <section className="space-y-3 border-t border-border/70 pt-5">
            <h2 className="text-sm font-semibold">
              5. Verify activity and review
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {profile.purpose === "MT5"
                ? "A heartbeat and durable sync must be observed. Review symbol mappings, missing history, account cash and the balance bridge before approving publication."
                : "Verify discovery and a real owner-scoped read in the selected AI client. Configuration and provider consent alone are not successful tool execution."}
            </p>
            {reviewId ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link href={`/settings/integrations/mt5/${reviewId}`} />
                }
              >
                Review MT5 history and balance bridge
              </Button>
            ) : null}
          </section>
          <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-4">
            <ShieldCheck
              className="mt-0.5 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              OAuth credentials stay in protected local storage, never
              configuration downloads. Existing account balance, planned values,
              reviews and MT5 controls are unchanged.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
