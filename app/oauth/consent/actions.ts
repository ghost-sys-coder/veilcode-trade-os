"use server";

import { redirect } from "next/navigation";

import { authorizationIdSchema, consentPath } from "@/domain/integrations/oauth-consent";
import { createClient } from "@/lib/supabase/server";
import { decideOAuthConsent } from "@/services/integrations/oauth-consent";
import { approveGrantConsent } from "@/services/integrations/grant-consent";

export async function approveConsent(formData: FormData): Promise<void> {
  const id = authorizationIdSchema.safeParse(formData.get("authorization_id"));
  if (!id.success) redirect("/oauth/consent");
  const account = formData.get("account_id");
  const result = await approveGrantConsent(await createClient(), id.data, { accountId: account === null || account === "" ? null : account });
  if (result.status === "APPROVED") redirect(result.redirectUrl);
  const next = consentPath(id.data);
  if (result.status === "SIGN_IN_REQUIRED") redirect(`/login?next=${encodeURIComponent(next)}`);
  redirect(`${next}&decision_error=1`);
}

export async function denyConsent(formData: FormData): Promise<void> {
  const id = authorizationIdSchema.safeParse(formData.get("authorization_id"));
  if (!id.success) redirect("/oauth/consent");
  const result = await decideOAuthConsent(await createClient(), id.data, "deny");
  if (result.status === "DENIED") redirect(result.redirectUrl);
  const next = consentPath(id.data);
  if (result.status === "SIGN_IN_REQUIRED") redirect(`/login?next=${encodeURIComponent(next)}`);
  redirect(`${next}&decision_error=1`);
}
