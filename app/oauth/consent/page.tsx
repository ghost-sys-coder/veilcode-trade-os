import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { approveConsent, denyConsent } from "@/app/oauth/consent/actions";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authorizationIdSchema, consentPath } from "@/domain/integrations/oauth-consent";
import { createClient } from "@/lib/supabase/server";
import { loadGrantConsent } from "@/services/integrations/grant-consent";
import { mcpConsentHandoff } from "@/services/integrations/consent-handoff";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = {
  title: "Integration consent | Trade OS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ConsentPage({ searchParams }: {
  searchParams: Promise<{ authorization_id?: string | string[]; decision_error?: string | string[] }>;
}) {
  const query = await searchParams;
  const id = authorizationIdSchema.safeParse(query.authorization_id);
  const client = await createClient();
  const handoff = id.success ? await mcpConsentHandoff(client, id.data) : null;
  if (handoff) redirect(handoff);
  const consent = id.success ? await loadGrantConsent(client, id.data) : { view: { status: "INVALID_REQUEST" as const }, eligibility: null };
  const { view, eligibility } = consent;
  if (view.status === "RESUMED") redirect(view.redirectUrl);
  if (view.status === "SIGN_IN_REQUIRED" && id.success) {
    redirect(`/login?next=${encodeURIComponent(consentPath(id.data))}`);
  }
  const request = view.status === "REQUEST" ? view.request : null;
  const accountResult = eligibility?.purpose === "MT5" ? await client.from("trading_accounts").select("id,name,currency_code").order("name") : null;
  const accounts = accountResult?.data ?? [];
  const approvalAvailable = Boolean(eligibility && !accountResult?.error && (eligibility.purpose !== "MT5" || accounts.length));

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-20 text-foreground">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <Card className="w-full max-w-xl">
        <CardHeader className="border-b border-border/70 pb-5">
          <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Trade OS · secure connections</p>
          <CardTitle className="text-2xl">Integration consent</CardTitle>
          <CardDescription>Review the requesting client. Your trading account permissions require a separate, verified application grant.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {query.decision_error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">The consent decision could not be completed safely. Start a new authorization request from your client.</p> : null}
          {request ? (
            <>
              <dl className="space-y-4 text-sm">
                <div><dt className="font-semibold">Requesting client</dt><dd className="mt-1 break-words text-muted-foreground">{request.clientName}</dd></div>
                <div><dt className="font-semibold">Client identifier</dt><dd className="mt-1 break-all font-mono text-xs text-muted-foreground">{request.clientId}</dd></div>
                <div><dt className="font-semibold">Registered callback</dt><dd className="mt-1 break-all text-muted-foreground">{request.callback}</dd></div>
                <div><dt className="font-semibold">Requested identity scopes</dt><dd className="mt-1 text-muted-foreground">{request.scopes.join(", ") || "No identity scopes"}</dd></div>
              </dl>
              <p id="approval-help" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">{approvalAvailable
                ? eligibility?.purpose === "MT5" ? "Authorize read-only broker synchronization for one selected account. This does not allow placing, changing or canceling broker orders. You can revoke access in Settings → Integrations."
                  : "Authorize application-wide access, including normal writes. Permanent deletion still needs one-use browser confirmation. Broker execution, SQL, shell access and credentials are never exposed."
                : "Approval is unavailable while this integration is disabled or its resource/account setup is incomplete. Identity scopes alone never grant database access."}</p>
              <form action={approveConsent} className="space-y-4">
                <input type="hidden" name="authorization_id" value={request.authorizationId} />
                {approvalAvailable && eligibility?.purpose === "MT5" ? <div className="space-y-2"><Label htmlFor="consent-account">Authorized trading account</Label>
                  <select id="consent-account" name="account_id" required defaultValue="" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="" disabled>Select an account</option>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>)}
                  </select></div> : null}
                <div className="flex flex-wrap gap-3"><Button disabled={!approvalAvailable} type="submit" aria-describedby="approval-help">{approvalAvailable ? "Approve access" : "Approval unavailable"}</Button>
                <Button type="submit" formAction={denyConsent} variant="outline" formNoValidate>Reject request</Button></div>
              </form>
            </>
          ) : (
            <p role="status" className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm leading-6">
              {view.status === "UNAVAILABLE"
                ? "The authorization provider is temporarily unavailable. Please retry from your client."
                : view.status === "BLOCKED"
                  ? "This request cannot be approved or resumed while integration security setup is incomplete. No authorization code has been forwarded."
                  : "No valid authorization request is available. Start the connection from your client; this page cannot authorize access on its own."}
            </p>
          )}
          <Link href="/dashboard" className="inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">Return to workspace</Link>
        </CardContent>
      </Card>
    </main>
  );
}
