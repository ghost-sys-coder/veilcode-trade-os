import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { IntegrationAuthorizationError } from "@/domain/integrations/actor";
import type { IntegrationDatabase } from "@/types/integration-database";

const grantViewSchema = z.object({
  id: z.string().uuid(), client_id: z.string().uuid(), purpose: z.enum(["MT5","MCP"]),
  account_id: z.string().uuid().nullable(), resource: z.string().url(), version: z.string().regex(/^[1-9][0-9]*$/),
  status: z.enum(["PENDING","ACTIVE","REVOKED"]), created_at: z.string(), revoked_at: z.string().nullable(),
});
export type ConnectedGrant = z.infer<typeof grantViewSchema>;

export async function verifyDirectBrowser(client: SupabaseClient<IntegrationDatabase>) {
  const claims = await client.auth.getClaims();
  if (claims.error || !claims.data?.claims.sub || claims.data.claims.client_id != null) throw new IntegrationAuthorizationError();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user || user.data.user.id !== claims.data.claims.sub) throw new IntegrationAuthorizationError();
}

export async function listConnectedGrants(client: SupabaseClient<IntegrationDatabase>): Promise<ConnectedGrant[]> {
  try {
    await verifyDirectBrowser(client);
    const response = await client.rpc("list_integration_grants");
    if (response.error) throw new IntegrationAuthorizationError();
    return z.array(grantViewSchema).parse(response.data);
  } catch { throw new IntegrationAuthorizationError(); }
}

export async function revokeConnectedGrant(client: SupabaseClient<IntegrationDatabase>, input: unknown) {
  const parsed = z.object({ id: z.string().uuid(), version: z.string().regex(/^[1-9][0-9]*$/) }).safeParse(input);
  if (!parsed.success) throw new IntegrationAuthorizationError();
  try {
    await verifyDirectBrowser(client);
    const result = await client.rpc("revoke_integration_grant", { p_grant_id: parsed.data.id, p_expected_version: parsed.data.version });
    if (result.error) throw new IntegrationAuthorizationError();
    const revoked = z.object({ id: z.string().uuid(), revoked: z.literal(true), client_id: z.string().uuid() }).parse(result.data);
    let providerRevocationPending = false;
    try {
      const provider = await client.auth.oauth.revokeGrant({ clientId: revoked.client_id });
      providerRevocationPending = Boolean(provider.error);
    } catch { providerRevocationPending = true; }
    return { revoked: true as const, providerRevocationPending };
  } catch { throw new IntegrationAuthorizationError(); }
}
