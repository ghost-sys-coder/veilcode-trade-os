import "server-only";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseConfig } from "@/config/env";
import { getIntegrationConfig } from "@/config/integrations";
import { setupClientName, setupProfileSchema, setupRequestSchema, mcpSetupConfiguration, type SetupProfile } from "@/domain/integrations/setup";
import { getVerifiedBrowserContext, verifiedBrowserClaims } from "@/services/integrations/browser-context";
import type { IntegrationDatabase } from "@/types/integration-database";
import { claudeDesktopDistribution } from "@/domain/integrations/claude-desktop-distribution";

type Client = SupabaseClient<IntegrationDatabase>;
export class IntegrationSetupError extends Error {
  constructor(readonly code: "DISABLED" | "NOT_CONFIGURED" | "UNAVAILABLE" | "CONFLICT" | "LIMIT" | "NOT_READY" = "UNAVAILABLE") {
    super(`INTEGRATION_SETUP_${code}`);
  }
}
export function integrationSetupAvailability(purpose: "MT5" | "MCP") {
  try {
    if (process.env.TRADE_OS_INTEGRATION_SETUP_ENABLED !== "true" || !getIntegrationConfig(purpose).enabled)
      return { enabled: false, provisioning: false };
    const key = process.env.SUPABASE_SECRET_KEY;
    const target = new URL(getSupabaseConfig().url);
    const local = process.env.TRADE_OS_LOCAL_TEST_APP === "true" && target.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
    return { enabled: true, provisioning: Boolean(key && key.length >= 20 && ((key.startsWith("sb_secret_") && target.protocol === "https:") || local)) };
  } catch { return { enabled: false, provisioning: false }; }
}
function configured(purpose: "MT5" | "MCP") {
  if (!integrationSetupAvailability(purpose).enabled) throw new IntegrationSetupError("DISABLED");
  return getIntegrationConfig(purpose);
}
function databaseFailure(code: string | undefined): never {
  throw new IntegrationSetupError(code === "PT409" ? "CONFLICT" : code === "54000" ? "LIMIT" : "UNAVAILABLE");
}
export async function readSetupState(client: Client) {
  if (process.env.TRADE_OS_INTEGRATION_SETUP_ENABLED !== "true") return { profiles: [], databaseEnabled: { MT5: false, MCP: false }, desktopEnabled: false };
  await getVerifiedBrowserContext(client);
  const desktop = process.env.TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED === "true";
  const response = await client.rpc(desktop ? "list_integration_setups_v2" : "list_integration_setups");
  if (response.error) databaseFailure(response.error.code);
  const schema = z.object({ profiles: z.array(setupProfileSchema).max(20), databaseEnabled: z.object({ MT5: z.boolean(), MCP: z.boolean() }).strict() });
  if (desktop) return schema.extend({ desktopEnabled: z.boolean() }).strict().parse(response.data);
  return { ...schema.strict().parse(response.data), desktopEnabled: false };
}
export async function listSetupProfiles(client: Client): Promise<SetupProfile[]> {
  return (await readSetupState(client)).profiles;
}
export async function reconcileSetupProfile(client: Client, input: unknown): Promise<SetupProfile> {
  const data = z.object({ id: z.string().uuid(), version: z.string().regex(/^[1-9][0-9]*$/) }).strict().parse(input);
  const profile = (await listSetupProfiles(client)).find(row => row.id === data.id);
  if (!profile) throw new IntegrationSetupError();
  const configuration = configured(profile.purpose);
  if (configuration.resource !== profile.resource) throw new IntegrationSetupError("CONFLICT");
  const response = await client.rpc("reconcile_integration_setup", { p_profile_id: data.id, p_expected_version: data.version });
  if (response.error) databaseFailure(response.error.code);
  return setupProfileSchema.parse(response.data);
}

function provider() {
  const { url } = getSupabaseConfig();
  const key = process.env.SUPABASE_SECRET_KEY!;
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
      const reader = response.body?.getReader();
      if (!reader) throw new IntegrationSetupError();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 65_536) { await reader.cancel(); throw new IntegrationSetupError(); }
        chunks.push(part.value);
      }
      const text = Buffer.concat(chunks, size).toString("utf8");
      return new Response(text, { status: response.status, headers: { "Content-Type": "application/json" } });
    } },
  });
}
/** One reservation permits one external POST; recovery only inspects provider facts. */
export async function createSetupProfile(client: Client, input: unknown): Promise<SetupProfile> {
  const data = setupRequestSchema.parse(input);
  const purpose = data.clientKind === "MT5_WINDOWS" ? "MT5" : "MCP";
  const configuration = configured(purpose);
  if (data.clientKind === "CLAUDE_DESKTOP" && (!claudeDesktopDistribution(process.env)
    || !(await readSetupState(client)).desktopEnabled)) throw new IntegrationSetupError("DISABLED");
  const context = await getVerifiedBrowserContext(client);
  if (!integrationSetupAvailability(purpose).provisioning) throw new IntegrationSetupError("NOT_CONFIGURED");
  const response = await client.rpc("reserve_integration_setup", { p_operation_id: data.operationId,
    p_client_kind: data.clientKind, p_account_id: data.accountId, p_resource: configuration.resource });
  if (response.error) databaseFailure(response.error.code);
  const reserved = z.object({ createAllowed: z.boolean() }).passthrough().parse(response.data);
  const { createAllowed, ...fields } = reserved;
  const profile = setupProfileSchema.parse(fields);
  if (profile.clientKind !== data.clientKind || profile.accountId !== data.accountId || profile.resource !== configuration.resource)
    throw new IntegrationSetupError();
  if (createAllowed) {
    if (profile.status !== "REGISTERING" || profile.version !== "1") throw new IntegrationSetupError();
    // Recheck actor provenance before invoking the lazy privileged provider.
    verifiedBrowserClaims(context);
    try {
      const result = await provider().auth.admin.oauth.createClient({ client_name: setupClientName(profile),
        redirect_uris: [profile.callbackUri], token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
      if (result.error || !result.data) return profile;
      const publicClient = z.object({ client_id: z.string().uuid(), client_type: z.literal("public"),
        client_name: z.literal(setupClientName(profile)), registration_type: z.literal("manual"),
        token_endpoint_auth_method: z.literal("none"), redirect_uris: z.tuple([z.literal(profile.callbackUri)]),
        client_secret: z.null().optional() }).safeParse(result.data);
      if (!publicClient.success) return profile;
    } catch { return profile; } // Never repeat an uncertain provider create.
  }
  if (profile.status === "READY") return profile;
  try { return await reconcileSetupProfile(client, { id: profile.id, version: profile.version }); }
  catch (error) {
    // A simultaneous identical retry may have completed this same reservation.
    // Only re-read the owned, unchanged binding and reverify its provider record.
    if (!(error instanceof IntegrationSetupError) || error.code !== "CONFLICT") throw error;
    const current = (await listSetupProfiles(client)).find(row => row.id === profile.id);
    if (!current || current.status !== "READY" || current.clientKind !== profile.clientKind
      || current.accountId !== profile.accountId || current.resource !== profile.resource) throw error;
    return reconcileSetupProfile(client, { id: current.id, version: current.version });
  }
}

export async function downloadSetupConfiguration(client: Client, profileId: unknown) {
  const id = z.string().uuid().parse(profileId);
  const context = await getVerifiedBrowserContext(client);
  const profile = (await listSetupProfiles(client)).find(row => row.id === id);
  if (!profile) throw new IntegrationSetupError();
  const configuredResource = configured(profile.purpose).resource;
  if (profile.resource !== configuredResource) throw new IntegrationSetupError("CONFLICT");
  if (profile.status !== "READY" || !profile.clientId) throw new IntegrationSetupError("NOT_READY");
  await reconcileSetupProfile(client, { id: profile.id, version: profile.version });
  const { url } = getSupabaseConfig();
  const issuer = `${url.replace(/\/$/, "")}/auth/v1`;
  const local = process.env.TRADE_OS_LOCAL_TEST_APP === "true";
  if (profile.purpose === "MCP") return { filename: `tradeos-${profile.clientKind.toLowerCase()}-${profile.id}.json`,
    configuration: mcpSetupConfiguration(profile, issuer, local) };
  const account = await client.from("trading_accounts").select("id,name,currency_code,currency_precision")
    .eq("id", profile.accountId!).eq("user_id", context.userId).single();
  if (account.error || !account.data) throw new IntegrationSetupError();
  const owned = z.object({ id: z.string().uuid(), name: z.string(), currency_code: z.string().regex(/^[A-Z]{3}$/),
    currency_precision: z.number().int().min(0).max(20) }).parse(account.data);
  // Explicit bootstrap format, NOT a mapped/runnable collector connection.json.
  return { filename: `tradeos-mt5-${profile.id}.tradeos-setup.json`, configuration: {
    format: "trade-os-setup", version: 1, purpose: "MT5", profileId: profile.id,
    ownerId: verifiedBrowserClaims(context).sub, account: { id: owned.id, name: owned.name,
      currencyCode: owned.currency_code, currencyPrecision: owned.currency_precision },
    oauth: { issuer, applicationOrigin: new URL(profile.resource).origin,
      clientId: profile.clientId, callbackUri: profile.callbackUri, allowLocalHttp: local },
  } };
}
