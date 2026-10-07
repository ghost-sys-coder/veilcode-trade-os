import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/config/env";
import { getIntegrationConfig } from "@/config/integrations";
import { integrationActorSchema, IntegrationAuthorizationError, IntegrationUnavailableError, type IntegrationActor } from "@/domain/integrations/actor";
import { integrationSigningKeys, verifyIntegrationToken } from "@/services/integrations/verify-token";
import type { IntegrationDatabase } from "@/types/integration-database";

const verifiedContext = Symbol("verified-integration-context");
const verifiedClaims = new WeakMap<object, Awaited<ReturnType<typeof verifyIntegrationToken>>>();
export type IntegrationContext = {
  actor: IntegrationActor;
  client: SupabaseClient<IntegrationDatabase>;
  readonly [verifiedContext]: true;
};

/** Never trusts submitted owner/account IDs, cookies, Origin or decoded-only JWTs. */
export async function getIntegrationContext(request: Request, purpose: IntegrationActor["purpose"]): Promise<IntegrationContext> {
  try {
    const configuration = getIntegrationConfig(purpose);
    if (!configuration.enabled) throw new IntegrationAuthorizationError();
    const match = /^Bearer ([A-Za-z0-9._-]+)$/i.exec(request.headers.get("authorization") ?? "");
    if (!match) throw new IntegrationAuthorizationError();
    const { url, publishableKey } = getSupabaseConfig();
    const issuer = `${url.replace(/\/$/, "")}/auth/v1`;
    const claims = await verifyIntegrationToken(match[1], {
      issuer, resource: configuration.resource, key: integrationSigningKeys(issuer),
    });
    const client = createClient<IntegrationDatabase>(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${match[1]}` } },
    });
    const response = await client.rpc("authorize_integration", { p_resource: configuration.resource, p_purpose: purpose });
    if (response.error) {
      if (response.status === 0 || response.status >= 500) throw new IntegrationUnavailableError();
      throw new IntegrationAuthorizationError();
    }
    const actor = integrationActorSchema.parse(response.data);
    if (actor.user_id !== claims.sub || actor.client_id !== claims.client_id || actor.grant_id !== claims.trade_os_grant_id
      || actor.grant_version !== claims.trade_os_grant_version || actor.purpose !== purpose || actor.resource !== configuration.resource) {
      throw new IntegrationAuthorizationError();
    }
    if (Array.isArray(claims.aud)) Object.freeze(claims.aud);
    const context: IntegrationContext = Object.freeze({ actor:Object.freeze(actor), client, [verifiedContext]: true as const });
    verifiedClaims.set(context, Object.freeze(claims));
    return context;
  } catch (error) {
    if (error instanceof IntegrationUnavailableError || error instanceof TypeError
      || (error instanceof Error && ["TimeoutError","AbortError"].includes(error.name))
      || (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_JWKS_TIMEOUT")) {
      throw new IntegrationUnavailableError();
    }
    throw new IntegrationAuthorizationError();
  }
}

/** Only the exact context produced by signature/live-grant verification is usable. */
export function verifiedIntegrationClaims(context: IntegrationContext) {
  const claims = verifiedClaims.get(context);
  if (!claims || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new IntegrationAuthorizationError();
  return claims;
}
