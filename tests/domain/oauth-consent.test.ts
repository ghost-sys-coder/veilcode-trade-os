import { describe, expect, it } from "vitest";

import { authorizationIdSchema, consentPath, parseConsentRequest, safeDenialRedirect } from "@/domain/integrations/oauth-consent";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const authorizationId = "fixture-id";
const details = {
  authorization_id: authorizationId,
  client: { id: "client-id", name: "Demo collector" },
  user: { id: userId, email: "private@example.test" },
  redirect_uri: "http://127.0.0.1:8787/callback",
  scope: "openid email email",
  access_token: "SENSITIVE_FIXTURE_VALUE",
};

describe("OAuth consent boundaries", () => {
  it("exposes only validated consent display fields, not raw provider data", () => {
    const request = parseConsentRequest(details, authorizationId, userId);
    expect(request?.scopes).toEqual(["openid", "email"]);
    expect(JSON.stringify(request)).not.toContain("SENSITIVE_FIXTURE_VALUE");
    expect(JSON.stringify(request)).not.toContain("private@example.test");
  });

  it.each([undefined, [authorizationId], "../request", "a/b", "a?b", "a%2fb", "a".repeat(129)])("rejects invalid identifiers %j", (value) => {
    expect(authorizationIdSchema.safeParse(value).success).toBe(false);
  });

  it("preserves a bounded opaque request ID across login", () => {
    expect(consentPath(authorizationId)).toBe("/oauth/consent?authorization_id=fixture-id");
  });

  it("rejects a mismatched request, owner and unsupported scopes", () => {
    expect(parseConsentRequest(details, "other-request", userId)).toBeNull();
    expect(parseConsentRequest(details, authorizationId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
    expect(parseConsentRequest({ ...details, scope: "database:write" }, authorizationId, userId)).toBeNull();
  });

  it.each(["https://user:password@client.example/callback", "http://remote.example/callback", "javascript:alert(1)", "//client.example/callback", "https://client.example/callback#token"])("rejects unsafe callback %s", (redirect_uri) => {
    expect(parseConsentRequest({ ...details, redirect_uri }, authorizationId, userId)).toBeNull();
  });

  it("accepts HTTPS and IPv6 loopback callbacks", () => {
    for (const redirect_uri of ["https://client.example/callback", "http://[::1]:8787/callback"]) {
      expect(parseConsentRequest({ ...details, redirect_uri }, authorizationId, userId)).not.toBeNull();
    }
  });

  it("only forwards a denial to the exact registered callback, preserving registered query values", () => {
    const base = "https://client.example/callback?environment=demo";
    const denied = `${base}&error=access_denied&state=fixture`;
    expect(safeDenialRedirect(denied, base)).toBe(denied);
    expect(safeDenialRedirect("https://client.example/callback?error=access_denied", base)).toBeNull();
    expect(safeDenialRedirect(`${base}&environment=live&error=access_denied`, base)).toBeNull();
  });

  it.each([
    "https://attacker.example/callback?error=access_denied",
    "https://client.example/other?error=access_denied",
    "https://client.example/callback?error=access_denied&code=secret",
    "https://client.example/callback?error=access_denied&access_token=secret",
    "https://client.example/callback?error=access_denied&unexpected=secret",
    "https://client.example/callback?error=access_denied&error=other",
    "https://client.example/callback?code=secret",
    "https://client.example/callback?error=access_denied#access_token=secret",
  ])("never forwards codes, tokens or changed denial destinations: %s", (value) => {
    expect(safeDenialRedirect(value, "https://client.example/callback")).toBeNull();
  });
});
