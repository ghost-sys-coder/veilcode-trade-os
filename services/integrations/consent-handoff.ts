import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getIntegrationConfig } from "@/config/integrations";
import { authorizationIdSchema, consentPath } from "@/domain/integrations/oauth-consent";
import type { IntegrationDatabase } from "@/types/integration-database";

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
    const result = await client.rpc("get_integration_consent_request", { p_authorization_id: id.data });
    if (result.error) return null;
    const context = contextSchema.safeParse(result.data);
    if (!context.success || context.data.resource !== resource) return null;
    // Only the opaque request identifier crosses origins. No provider detail call,
    // approval, code, token, cookie, user identity or account selection is forwarded.
    // Destination repeats identity, provider, resource, grant and enablement checks.
    return `${target.origin}${consentPath(id.data)}`;
  } catch {
    return null;
  }
}
