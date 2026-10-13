import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { getSupabaseConfig } from "@/config/env";
import { getIntegrationConfig } from "@/config/integrations";
import { mt5PairingApprovalSchema, mt5PairingViewSchema, pairingManifest } from "@/domain/integrations/mt5-pairing";
import { IntegrationSetupError, integrationSetupAvailability, listSetupProfiles } from "./setup-profiles";
import { getVerifiedBrowserContext } from "./browser-context";
import { verifiedIntegrationClaims, type IntegrationContext } from "./actor-context";
import { IntegrationAuthorizationError } from "@/domain/integrations/actor";

type Client = SupabaseClient<IntegrationDatabase>;
function enabled() {
  if (!integrationSetupAvailability("MT5").enabled) throw new IntegrationSetupError("DISABLED");
}
function failure(code?: string): never { throw new IntegrationSetupError(code === "PT409" || code === "23505" ? "CONFLICT" : "UNAVAILABLE"); }
export async function approveMt5SetupPairing(client: Client, input: unknown) {
  enabled(); await getVerifiedBrowserContext(client);
  const data = mt5PairingApprovalSchema.parse(input);
  const result = await client.rpc("approve_mt5_setup_pairing", {p_request: data});
  if (result.error) failure(result.error.code);
  return mt5PairingViewSchema.parse(result.data);
}
export async function getBrowserMt5Pairing(client: Client, profileId: string) {
  enabled(); await getVerifiedBrowserContext(client); z.string().uuid().parse(profileId);
  const result = await client.rpc("get_mt5_setup_pairing", {p_profile_id: profileId, p_resource: null});
  if (result.error) failure(result.error.code);
  return result.data === null ? null : mt5PairingViewSchema.parse(result.data);
}
export async function getCollectorMt5Pairing(context: IntegrationContext, profileId: unknown) {
  enabled(); verifiedIntegrationClaims(context);
  if (context.actor.purpose !== "MT5") throw new IntegrationAuthorizationError();
  const result = await context.client.rpc("get_mt5_setup_pairing", {p_profile_id: z.string().uuid().parse(profileId), p_resource: context.actor.resource});
  if (result.error || result.data === null) throw new IntegrationAuthorizationError();
  return mt5PairingViewSchema.parse(result.data);
}
export async function downloadMt5Pairing(client: Client, profileId: string) {
  const approved = await getBrowserMt5Pairing(client, profileId);
  const profile = (await listSetupProfiles(client)).find(row => row.id === profileId);
  if (!approved || !profile || profile.status !== "READY" || profile.purpose !== "MT5"
    || profile.resource !== getIntegrationConfig("MT5").resource || profile.clientId !== approved.proposal.clientId)
    throw new IntegrationSetupError("NOT_READY");
  return pairingManifest(approved.proposal, approved.connectionId, {
    issuer: getSupabaseConfig().url.replace(/\/$/, "") + "/auth/v1", applicationOrigin: new URL(profile.resource).origin,
    clientId: profile.clientId, allowLocalHttp: process.env.TRADE_OS_LOCAL_TEST_APP === "true",
  });
}
