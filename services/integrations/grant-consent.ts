import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getIntegrationConfig } from "@/config/integrations";
import { safeApprovalRedirect } from "@/domain/integrations/oauth-consent";
import { loadOAuthConsent } from "@/services/integrations/oauth-consent";
import type { IntegrationDatabase } from "@/types/integration-database";

const contextSchema = z.object({ client_id: z.string().uuid(), purpose: z.enum(["MT5","MCP"]),
  resource: z.string().url(), callback: z.string().url(), status: z.enum(["pending","approved"]) });
const grantSchema = z.object({ id: z.string().uuid(), version: z.string().regex(/^[1-9][0-9]*$/),
  purpose: z.enum(["MT5","MCP"]), client_id: z.string().uuid(), account_id: z.string().uuid().nullable(), resource: z.string().url() });
const selectionSchema = z.object({ accountId: z.string().uuid().nullable() });
const activationSchema = z.object({ id: z.string().uuid(), version: z.string().regex(/^[1-9][0-9]*$/), status: z.literal("ACTIVE") });

export async function loadGrantConsent(client: SupabaseClient<IntegrationDatabase>, input: unknown) {
  const view = await loadOAuthConsent(client, input);
  if (view.status !== "REQUEST") return { view, eligibility: null };
  try {
    const response = await client.rpc("get_integration_consent_request", { p_authorization_id: view.request.authorizationId });
    if (response.error) return { view, eligibility: null };
    const context = contextSchema.parse(response.data);
    const configured = getIntegrationConfig(context.purpose);
    if (!configured.enabled || configured.resource !== context.resource || context.client_id !== view.request.clientId
      || context.callback !== view.request.callback) return { view, eligibility: null };
    return { view, eligibility: context };
  } catch { return { view, eligibility: null }; }
}

export async function approveGrantConsent(client: SupabaseClient<IntegrationDatabase>, authorizationId: unknown, selection: unknown): Promise<
  { status: "APPROVED"; redirectUrl: string } | { status: "BLOCKED" | "UNAVAILABLE" | "SIGN_IN_REQUIRED" | "INVALID_REQUEST" }
> {
  // Server repeats browser/provider identity checks; form purpose/owner/resource are never authoritative.
  const current = await loadGrantConsent(client, authorizationId);
  if (current.view.status !== "REQUEST") return current.view;
  const account = selectionSchema.safeParse(selection);
  if (!current.eligibility || !account.success || (current.eligibility.purpose === "MT5") !== (account.data.accountId !== null)) return { status: "BLOCKED" };
  let grant: z.infer<typeof grantSchema> | undefined;
  try {
    const result = await client.rpc("approve_integration_grant", { p_authorization_id: current.view.request.authorizationId,
      p_purpose: current.eligibility.purpose, p_account_id: account.data.accountId });
    if (result.error) return { status: "BLOCKED" };
    grant = grantSchema.parse(result.data);
    if (grant.client_id !== current.view.request.clientId || grant.resource !== current.eligibility.resource
      || grant.purpose !== current.eligibility.purpose || grant.account_id !== account.data.accountId) throw new Error("Grant mismatch");
    const approval = await client.auth.oauth.approveAuthorization(current.view.request.authorizationId, { skipBrowserRedirect: true });
    if (approval.error || !approval.data) throw new Error("Provider approval unavailable");
    const redirectUrl = safeApprovalRedirect(approval.data.redirect_url, current.view.request.callback);
    if (!redirectUrl) throw new Error("Unsafe callback");
    const activated = await client.rpc("activate_integration_grant", { p_authorization_id: current.view.request.authorizationId, p_expected_version: grant.version });
    if (activated.error) throw new Error("Grant activation unavailable");
    const active = activationSchema.parse(activated.data);
    if (active.id !== grant.id || active.version !== grant.version) throw new Error("Grant activation mismatch");
    return { status: "APPROVED", redirectUrl };
  } catch {
    // Provider and app grants are separate transactions. Any uncertain approval
    // remains unusable: revoke locally first, then invalidate provider consent.
    if (grant) {
      await Promise.resolve(client.rpc("revoke_integration_grant", { p_grant_id: grant.id, p_expected_version: grant.version })).catch(() => null);
      await client.auth.oauth.revokeGrant({ clientId: grant.client_id }).catch(() => null);
    }
    return { status: "UNAVAILABLE" };
  }
}
