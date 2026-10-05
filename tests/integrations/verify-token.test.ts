import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { verifyIntegrationToken } from "@/services/integrations/verify-token";

const issuer = "https://provider.example/auth/v1";
const resource = "https://trade.example/api/integrations/v1";
const ids = { sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  session_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", trade_os_grant_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
let key: JWTVerifyGetKey;
let privateKey: CryptoKey;
const now = new Date("2026-10-05T00:00:00Z");
const seconds = Math.floor(now.getTime() / 1000);
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ ...ids, role: "authenticated", trade_os_grant_version: "1", trade_os_resource: resource,
    iss: issuer, aud: ["authenticated", resource], iat: seconds, exp: seconds + 60, ...overrides })
    .setProtectedHeader({ alg: "ES256", kid: "fixture" }).sign(privateKey);
}
beforeAll(async () => {
  const pair = await generateKeyPair("ES256"); privateKey = pair.privateKey;
  key = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "fixture", alg: "ES256" }] });
});
describe("resource-bound integration signatures", () => {
  it("accepts a signed resource-bound OAuth token", async () => {
    expect((await verifyIntegrationToken(await token(), { issuer, resource, key, now })).sub).toBe(ids.sub);
  });
  it.each([{ aud: "authenticated" }, { iss: "https://attacker.example" }, { exp: seconds },
    { iat: seconds + 1 }, { client_id: undefined }, { session_id: undefined },
    { trade_os_resource: "https://other.example" }, { trade_os_grant_version: "0" }, { role: "service_role" }])(
    "rejects incompatible claims %j", async (overrides) => {
      await expect(verifyIntegrationToken(await token(overrides), { issuer, resource, key, now })).rejects.toThrow("Integration access denied");
    });
  it("rejects tampering without exposing tokens", async () => {
    const signed = await token();
    await expect(verifyIntegrationToken(`${signed.slice(0, -8)}aaaaaaaa`, { issuer, resource, key, now })).rejects.toThrow("Integration access denied");
  });
});
