import { describe, expect, it } from "vitest";

import { assessAuthenticationMetadata, oauthIssuerForProject } from "@/domain/integrations/oauth-preflight";

const projectUrl = "https://project.supabase.co";
const issuer = `${projectUrl}/auth/v1`;
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint: `${issuer}/oauth/token`,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
  grant_types_supported: ["authorization_code", "refresh_token"],
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
};
const jwks = { keys: [{ kid: "fixture", alg: "RS256", kty: "RSA", use: "sig", n: "fixture", e: "AQAB" }] };

function assess(overrides: Partial<Parameters<typeof assessAuthenticationMetadata>[0]> = {}) {
  return assessAuthenticationMetadata({ projectUrl, discoveryStatus: 200, metadata, jwksStatus: 200, jwks, ...overrides });
}

describe("integration authentication hard gate", () => {
  it("never treats successful discovery as authorization or persistence readiness", () => {
    const report = assess();
    expect(report.metadataReady).toBe(true);
    expect(report.readyForPersistence).toBe(false);
    expect(report.checks.filter((check) => check.status === "PENDING").map((check) => check.id)).toEqual([
      "consent_pkce_exchange", "refresh_rotation", "resource_binding", "revocation", "ownership_rls", "existing_login",
    ]);
  });

  it.each([0, 401, 404, 500])("fails unavailable discovery HTTP %s", (status) => {
    expect(assess({ discoveryStatus: status, metadata: { error: "disabled" } }).metadataReady).toBe(false);
  });

  it.each([null, [], "not metadata", 42])("fails malformed metadata %j", (value) => {
    expect(assess({ metadata: value }).metadataReady).toBe(false);
  });

  it("requires refresh, PKCE S256 and a public PKCE client", () => {
    for (const override of [
      { grant_types_supported: ["authorization_code"] },
      { response_types_supported: ["token"] },
      { code_challenge_methods_supported: ["plain"] },
      { token_endpoint_auth_methods_supported: ["client_secret_basic"] },
    ]) {
      expect(assess({ metadata: { ...metadata, ...override } }).metadataReady).toBe(false);
    }
  });

  it.each(["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"])("pins %s to the provider", (field) => {
    expect(assess({ metadata: { ...metadata, [field]: "https://attacker.example/endpoint" } }).metadataReady).toBe(false);
  });

  it.each([
    { kid: "symmetric", alg: "HS256", kty: "oct", k: "secret" },
    { ...jwks.keys[0], d: "private" },
    { ...jwks.keys[0], p: "private" },
    { ...jwks.keys[0], use: "enc" },
    { ...jwks.keys[0], n: "" },
  ])("rejects unsuitable signing material", (key) => {
    expect(assess({ jwks: { keys: [key] } }).metadataReady).toBe(false);
  });

  it("accepts public ES256 discovery but still leaves the real flow pending", () => {
    expect(assess({ jwks: { keys: [{ kid: "ec", alg: "ES256", kty: "EC", crv: "P-256", x: "x", y: "y" }] } }).metadataReady).toBe(true);
    expect(assess({ jwksStatus: 404 }).metadataReady).toBe(false);
  });

  it("never copies provider responses or secrets into a report", () => {
    const report = assess({ metadata: { ...metadata, error_description: "SENSITIVE_FIXTURE_VALUE", access_token: "SENSITIVE_FIXTURE_VALUE" }, jwks: { keys: [] } });
    expect(JSON.stringify(report)).not.toContain("SENSITIVE_FIXTURE_VALUE");
    expect(JSON.stringify(report)).not.toContain(projectUrl);
  });

  it("permits local development and rejects credential-bearing/untrusted origins", () => {
    expect(oauthIssuerForProject("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321/auth/v1");
    for (const value of ["http://remote.example", "https://user:secret@project.supabase.co", `${projectUrl}?key=secret`, `${projectUrl}/path`, `${projectUrl}#fragment`]) {
      expect(() => oauthIssuerForProject(value)).toThrow();
    }
  });
});
