import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { integrationSetupAvailability, readSetupState } from "@/services/integrations/setup-profiles";
import { setupLabels, type SetupProfile } from "@/domain/integrations/setup";
import { IntegrationSetupForm } from "@/features/integrations/setup-form";
import type { IntegrationDatabase } from "@/types/integration-database";

export default async function ConnectIntegrationPage({ params }: { params: Promise<{ purpose: string }> }) {
  await requireUserId();
  const route = (await params).purpose;
  if (!['mt5', 'mcp'].includes(route)) notFound();
  const purpose = route === "mt5" ? "MT5" : "MCP";
  const availability = integrationSetupAvailability(purpose);
  let unavailable = false;
  let databaseEnabled = false;
  let profiles: SetupProfile[] = [];
  let accounts: { id: string; name: string; currency_code: string }[] = [];
  if (availability.enabled) {
    try {
      const client = await createClient() as SupabaseClient<IntegrationDatabase>;
      const browser = await getVerifiedBrowserContext(client);
      const setup = await readSetupState(client);
      profiles = setup.profiles.filter(profile => profile.purpose === purpose);
      databaseEnabled = setup.databaseEnabled[purpose];
      if (purpose === "MT5") {
        const response = await client.from("trading_accounts").select("id,name,currency_code").eq("user_id", browser.userId).order("name").limit(1000);
        if (response.error || response.data.length === 1000) throw new Error("Account selection unavailable");
        accounts = response.data;
      }
    } catch { unavailable = true; }
  }
  const steps = ["Choose account or client", "Install or configure", "Approve access", "Verify and review"];
  return <div className="space-y-6">
    <PageHeader eyebrow="Integration onboarding" title={purpose === "MT5" ? "Connect MetaTrader 5" : "Connect an AI client"}
      description={purpose === "MT5" ? "An account-bound connection to one dedicated demo terminal. No broker execution." : "Prepare a distinct client configuration, then explicitly authorize application access."} />
    <Link href="/settings/integrations" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="size-4" aria-hidden="true" />Back to integrations</Link>
    <ol aria-label="Connection setup steps" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{steps.map((step, index) => <li key={step}
      className="flex items-center gap-3 rounded-lg border border-border/70 bg-card p-4 text-sm"><span className="font-mono text-primary">0{index + 1}</span><span className="font-semibold">{step}</span></li>)}</ol>
    {!availability.enabled || !availability.provisioning || !databaseEnabled || unavailable ? <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
      {!availability.enabled ? "New connection setup is not enabled for this integration. Existing clients and MT5 controls remain available; no registration or access is being granted."
        : unavailable ? "Owned setup data is unavailable. Setup prerequisites must be installed before you can prepare a connection."
          : !databaseEnabled ? "New setup is disabled by the database rollout policy. Existing connections are preserved."
          : "Connection provisioning is not configured. Your existing grants and data are preserved; no registration will be attempted."}</p> : null}
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Prepare your connection</CardTitle>
      <CardDescription>{purpose === "MT5" ? "Use an existing Trade OS account, or create one first. Dedicated-terminal identity is verified separately." : "Start with a local Windows client profile. Vendor connection and consent remain explicit steps."}</CardDescription></CardHeader>
      <CardContent className="pt-5"><IntegrationSetupForm purpose={purpose} accounts={accounts} operationId={randomUUID()}
        available={availability.enabled && availability.provisioning && databaseEnabled && !unavailable} /></CardContent></Card>
    <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-4"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <p className="text-sm leading-6 text-muted-foreground">{purpose === "MT5" ? "MT5 needs a Windows companion and a dedicated demo terminal. Configuration does not start capture, approve history or enable automatic publication."
        : "Remote MCP does not require MT5 or its desktop. Remote connector setup and the packaged local companion remain release-gated until verified; preparing a profile alone is not a successful connection."}</p></div>
    <Card><CardHeader className="border-b border-border/70"><CardTitle>Your saved setups</CardTitle><CardDescription>Resume the same setup rather than repeating an uncertain registration.</CardDescription></CardHeader>
      <CardContent className="space-y-3 pt-5">{profiles.map(profile => <Link key={profile.id} href={`/settings/integrations/setup/${profile.id}`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-4 text-sm hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-semibold">{setupLabels[profile.clientKind]}{profile.accountId ? ` · ${accounts.find(account => account.id === profile.accountId)?.name ?? "Account unavailable"}` : ""}</span>
        <span className="text-xs text-muted-foreground">{profile.status === "READY" ? "Configuration prepared" : "Registration needs verification"}</span></Link>)}
        {!profiles.length ? <p className="text-sm text-muted-foreground">{unavailable ? "Saved setups could not be loaded." : "No saved setup is shown for this integration."}</p> : null}</CardContent></Card>
  </div>;
}
