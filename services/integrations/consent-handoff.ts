import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getIntegrationConfig } from "@/config/integrations";
import { authorizationIdSchema, consentPath, parseConsentRequest, safeApprovalRedirect } from "@/domain/integrations/oauth-consent";
import type { IntegrationDatabase } from "@/types/integration-database";
import { listConnectedGrants } from "@/services/integrations/grant-management";

const contextSchema = z.object({
  client_id: z.string().uuid(),
  purpose: z.literal("MCP"),
  resource: z.string().url(),
  callback: z.string().url(),
  status: z.enum(["pending", "approved"]),
});

/** A routing allowlist, not permission to approve a request or enable MCP. */
export async function mcpConsentHandoff(
  client: SupabaseClient<IntegrationDatabase>, input: unknown,
): Promise<string | null> {
  const allowed = process.env.TRADE_OS_MCP_CONSENT_HANDOFF_ORIGIN;
  const id = authorizationIdSchema.safeParse(input);
  if (!allowed || allowed.length > 2048 || !id.success) return null;
  try {
    const target = new URL(allowed);
    if (target.protocol !== "https:" || target.username || target.password
      || target.pathname !== "/" || target.search || target.hash
      || ![target.origin, `${target.origin}/`].includes(allowed)
      || ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) return null;
    const resource = `${target.origin}/mcp`;
    // The destination must render consent locally; never send it back to itself.
    if (getIntegrationConfig("MCP").resource === resource) return null;
    const claims = await client.auth.getClaims();
    if (claims.error || !claims.data?.claims.sub
      || (claims.data.claims.client_id !== undefined && claims.data.claims.client_id !== null)) return null;
    const user = await client.auth.getUser();
    if (user.error || !user.data.user || user.data.user.id !== claims.data.claims.sub) return null;
    // Private authority checks the direct browser session, owned request, expiry,
    // registered enabled resource and S256. No caller-supplied destination is used.
    let result = await client.rpc("get_integration_consent_request", { p_authorization_id: id.data });
    let boundRequest: ReturnType<typeof parseConsentRequest> = null;
    let resumeRedirect: string | undefined;
    if (result.error) {
      // Fresh provider requests have no owner until getAuthorizationDetails binds
      // them to the authenticated browser. This is the normal consent read, not
      // approval. Pending details must match this exact ID/user. An existing
      // provider consent may instead return a resume URL: retain it only for
      // validation after private ownership checks. Existing-consent reads can
      // issue a one-use code, so an approved reconnect cannot be read again at
      // staging. Only a matching live app grant can authorize its exact callback.
      const details = await client.auth.oauth.getAuthorizationDetails(id.data);
      if (details.error) return null;
      boundRequest = parseConsentRequest(details.data, id.data, user.data.user.id);
      if (!boundRequest) {
        if (!details.data || typeof details.data !== "object" || !("redirect_url" in details.data)
          || typeof details.data.redirect_url !== "string" || !details.data.redirect_url
          || details.data.redirect_url.length > 4096) return null;
        resumeRedirect = details.data.redirect_url;
      }
      // Binding alone is never authority: repeat private resource/S256/expiry/
      // ownership validation, including the provider's exact client/callback.
      result = await client.rpc("get_integration_consent_request", { p_authorization_id: id.data });
    }
    if (result.error) return null;
    const context = contextSchema.safeParse(result.data);
    if (!context.success || context.data.resource !== resource
      || (boundRequest && (context.data.client_id !== boundRequest.clientId
        || context.data.callback !== boundRequest.callback))
      || (resumeRedirect !== undefined && (context.data.status !== "approved"
        || !safeApprovalRedirect(resumeRedirect, context.data.callback)))) return null;
    if (resumeRedirect !== undefined) {
      // Narrow, explicitly enabled consent-host exception, not production MCP
      // API enablement: private context already checked the enabled allowlisted
      // resource, direct ownership, S256 and expiry. Never manufacture/reapprove
      // a grant or relay a code through the staging URL. Fresh live grant reads
      // are mandatory even when the provider remembers consent.
      const grants = await listConnectedGrants(client);
      const matching = grants.filter(grant => grant.client_id === context.data.client_id
        && grant.purpose === "MCP" && grant.resource === resource);
      if (matching.length !== 1 || matching[0].status !== "ACTIVE"
        || matching[0].revoked_at !== null || matching[0].account_id !== null) return null;
      // Recheck private authority after grant lookup; revocation/expiry or a
      // changed provider context during those reads must not release a code.
      const final = await client.rpc("get_integration_consent_request", { p_authorization_id: id.data });
      const finalContext = contextSchema.safeParse(final.data);
      if (final.error || !finalContext.success || finalContext.data.status !== "approved"
        || finalContext.data.client_id !== context.data.client_id
        || finalContext.data.resource !== resource || finalContext.data.callback !== context.data.callback) return null;
      const current = (await listConnectedGrants(client)).filter(grant => grant.client_id === context.data.client_id);
      if (current.length !== 1 || current[0].id !== matching[0].id || current[0].version !== matching[0].version
        || current[0].purpose !== "MCP" || current[0].resource !== resource
        || current[0].status !== "ACTIVE" || current[0].revoked_at !== null || current[0].account_id !== null) return null;
      return safeApprovalRedirect(resumeRedirect, finalContext.data.callback);
    }
    // New consent forwards only the opaque request ID to staging. No code,
    // cookie, identity or account selection crosses that handoff; staging repeats
    // identity, provider, resource, grant and enablement checks before approval.
    return `${target.origin}${consentPath(id.data)}`;
  } catch {
    return null;
  }
}
