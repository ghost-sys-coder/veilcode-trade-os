export type AuthenticationCheckStatus = "PASSED" | "FAILED" | "PENDING";

export interface AuthenticationCheck {
  id: string;
  status: AuthenticationCheckStatus;
  detail: string;
}

export interface AuthenticationPreflight {
  metadataReady: boolean;
  readyForPersistence: false;
  checks: AuthenticationCheck[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function contains(value: unknown, item: string): boolean {
  return Array.isArray(value) && value.includes(item);
}

/** Pin discovery to the configured provider, never to caller-supplied URLs. */
export function oauthIssuerForProject(projectUrl: string): string {
  const url = new URL(projectUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("Configure a credential-free HTTPS Supabase project origin (HTTP is local-only).");
  }
  return `${url.origin}/auth/v1`;
}

function endpointMatches(value: unknown, expected: string): boolean {
  // Exact matching also rejects credentials, fragments, unexpected queries,
  // lookalike hosts and insecure remote endpoints.
  return typeof value === "string" && value === expected;
}

function publicSigningKey(value: unknown): boolean {
  const key = record(value);
  if (typeof key.kid !== "string" || !key.kid || (key.use && key.use !== "sig")) return false;
  if (["d", "k", "p", "q", "dp", "dq", "qi", "oth"].some((field) => key[field] !== undefined)) return false;
  if (key.alg === "RS256" && key.kty === "RSA") {
    return typeof key.n === "string" && key.n.length > 0 && typeof key.e === "string" && key.e.length > 0;
  }
  return key.alg === "ES256" && key.kty === "EC" && key.crv === "P-256"
    && typeof key.x === "string" && key.x.length > 0
    && typeof key.y === "string" && key.y.length > 0;
}

/** Discovery is evidence of capabilities, not proof of an authorized flow. */
export function assessAuthenticationMetadata(input: {
  projectUrl: string;
  discoveryStatus: number;
  metadata: unknown;
  jwksStatus: number;
  jwks: unknown;
}): AuthenticationPreflight {
  const issuer = oauthIssuerForProject(input.projectUrl);
  const metadata = record(input.metadata);
  const jwks = record(input.jwks);
  const checks: AuthenticationCheck[] = [];
  const add = (id: string, passed: boolean, detail: string) => {
    checks.push({ id, status: passed ? "PASSED" : "FAILED", detail });
  };

  add("discovery", input.discoveryStatus === 200 && typeof metadata.issuer === "string",
    `OAuth discovery HTTP status: ${input.discoveryStatus || "unavailable"}.`);
  add("issuer", metadata.issuer === issuer, "Issuer must exactly match the configured Supabase Auth provider.");
  add("authorization_endpoint", endpointMatches(metadata.authorization_endpoint, `${issuer}/oauth/authorize`),
    "Authorization endpoint must belong to the configured provider.");
  add("token_endpoint", endpointMatches(metadata.token_endpoint, `${issuer}/oauth/token`),
    "Token exchange must stay at the configured provider.");
  add("pkce_s256", contains(metadata.code_challenge_methods_supported, "S256"),
    "Discovery must advertise PKCE S256.");
  add("authorization_code", contains(metadata.grant_types_supported, "authorization_code"),
    "Discovery must advertise authorization-code grants.");
  add("code_response", contains(metadata.response_types_supported, "code"),
    "Discovery must advertise authorization-code responses.");
  add("refresh_token", contains(metadata.grant_types_supported, "refresh_token"),
    "Discovery must advertise renewable refresh-token grants.");
  add("public_client", contains(metadata.token_endpoint_auth_methods_supported, "none"),
    "The collector needs a pre-registered public PKCE client, without an embedded client secret.");
  add("jwks_endpoint", endpointMatches(metadata.jwks_uri, `${issuer}/.well-known/jwks.json`),
    "Public-key discovery must remain at the configured provider.");
  add("asymmetric_signing", input.jwksStatus === 200 && Array.isArray(jwks.keys) && jwks.keys.some(publicSigningKey),
    "Verify public RS256/ES256 keys; never accept symmetric or private signing material.");

  const metadataReady = checks.every((check) => check.status === "PASSED");
  for (const [id, detail] of [
    ["consent_pkce_exchange", "Complete browser consent and PKCE exchange; test wrong-verifier rejection."],
    ["refresh_rotation", "Refresh and persist rotated credentials; test expired/reused credentials."],
    ["resource_binding", "Reject tokens for another resource; a generic authenticated audience is insufficient."],
    ["revocation", "Revoke the grant and reject an already-issued access token immediately."],
    ["ownership_rls", "Verify account-scoped grants, owner isolation and denied direct writes."],
    ["existing_login", "Verify existing login, logout, callback and public calculator behavior."],
  ]) {
    checks.push({ id, status: "PENDING", detail });
  }
  return { metadataReady, readyForPersistence: false, checks };
}
