import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { IntegrationAuthorizationError } from "@/domain/integrations/actor";
import type { IntegrationDatabase } from "@/types/integration-database";

const browserClaims = z.object({ sub: z.string().uuid(),session_id: z.string().uuid(),role: z.literal("authenticated"),
  exp: z.number().int().positive(),client_id: z.null().optional() });
const verifiedBrowsers = new WeakMap<object,z.infer<typeof browserClaims>>();
declare const browserBrand: unique symbol;
export type VerifiedBrowserContext = { readonly userId: string; readonly [browserBrand]: true };

/** Runtime provenance cannot be forged by JSON, a cast, or cloning a valid context. */
export async function getVerifiedBrowserContext(client: SupabaseClient<IntegrationDatabase>): Promise<VerifiedBrowserContext> {
  const response = await client.auth.getClaims();
  const parsed = browserClaims.safeParse(response.data?.claims);
  if (response.error || !parsed.success || parsed.data.exp <= Math.floor(Date.now()/1000)) throw new IntegrationAuthorizationError();
  const user = await client.auth.getUser();
  if (user.error || user.data.user?.id !== parsed.data.sub) throw new IntegrationAuthorizationError();
  const context = Object.freeze({ userId: parsed.data.sub }) as VerifiedBrowserContext;
  verifiedBrowsers.set(context,Object.freeze(parsed.data));
  return context;
}

export function verifiedBrowserClaims(context: VerifiedBrowserContext) {
  const claims = verifiedBrowsers.get(context);
  if (!claims || claims.exp <= Math.floor(Date.now()/1000)) throw new IntegrationAuthorizationError();
  return claims;
}
