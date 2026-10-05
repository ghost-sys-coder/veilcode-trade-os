import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { IntegrationAuthorizationError } from "../../domain/integrations/actor.ts";

const claimsSchema = z.object({
  sub: z.string().uuid(), client_id: z.string().uuid(), session_id: z.string().uuid(),
  role: z.literal("authenticated"), exp: z.number().int(), iat: z.number().int(),
  trade_os_grant_id: z.string().uuid(), trade_os_grant_version: z.string().regex(/^[1-9][0-9]*$/),
  trade_os_resource: z.string().url(),
});

/** Cryptographic validation is separate from the mandatory live database grant check. */
export async function verifyIntegrationToken(token: string, options: {
  issuer: string; resource: string; key: JWTVerifyGetKey; now?: Date;
}) {
  try {
    if (token.length > 16_384 || !token.length) throw new IntegrationAuthorizationError();
    const { payload } = await jwtVerify(token, options.key, {
      issuer: options.issuer, audience: options.resource, algorithms: ["ES256", "RS256"],
      requiredClaims: ["exp", "iat", "sub", "session_id", "client_id"],
      currentDate: options.now, clockTolerance: 0,
    });
    const claims = claimsSchema.parse(payload);
    if (claims.trade_os_resource !== options.resource || claims.iat > Math.floor((options.now?.getTime() ?? Date.now()) / 1000)) {
      throw new IntegrationAuthorizationError();
    }
    return claims;
  } catch { throw new IntegrationAuthorizationError(); }
}

export function integrationSigningKeys(issuer: string) {
  const url = new URL(`${issuer}/.well-known/jwks.json`);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new IntegrationAuthorizationError();
  }
  return createRemoteJWKSet(url, { timeoutDuration: 5_000, cooldownDuration: 10_000 });
}
