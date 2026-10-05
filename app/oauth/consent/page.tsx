import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { denyConsent } from "@/app/oauth/consent/actions";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authorizationIdSchema, consentPath } from "@/domain/integrations/oauth-consent";
import { createClient } from "@/lib/supabase/server";
import { loadOAuthConsent } from "@/services/integrations/oauth-consent";

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
  const view = id.success
    ? await loadOAuthConsent(await createClient(), id.data)
    : { status: "INVALID_REQUEST" as const };
  if (view.status === "SIGN_IN_REQUIRED" && id.success) {
    redirect(`/login?next=${encodeURIComponent(consentPath(id.data))}`);
  }
  const request = view.status === "REQUEST" ? view.request : null;

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
          {query.decision_error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">The request could not be rejected safely. Start a new authorization request from your client.</p> : null}
          {request ? (
            <>
              <dl className="space-y-4 text-sm">
                <div><dt className="font-semibold">Requesting client</dt><dd className="mt-1 break-words text-muted-foreground">{request.clientName}</dd></div>
                <div><dt className="font-semibold">Client identifier</dt><dd className="mt-1 break-all font-mono text-xs text-muted-foreground">{request.clientId}</dd></div>
                <div><dt className="font-semibold">Registered callback</dt><dd className="mt-1 break-all text-muted-foreground">{request.callback}</dd></div>
                <div><dt className="font-semibold">Requested identity scopes</dt><dd className="mt-1 text-muted-foreground">{request.scopes.join(", ") || "No identity scopes"}</dd></div>
              </dl>
              <p id="approval-help" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm leading-6">Approval is unavailable while integration security setup is in progress. Identity scopes do not restrict database access. Account-bound grants, resource validation and isolation tests must pass before approval is enabled.</p>
              <form action={denyConsent} className="flex flex-wrap gap-3">
                <input type="hidden" name="authorization_id" value={request.authorizationId} />
                <Button disabled type="button" aria-describedby="approval-help">Approval unavailable</Button>
                <Button type="submit" variant="outline">Reject request</Button>
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
