import { z } from "zod";

// Provider identifiers are opaque, bounded path segments, never caller URLs.
export const authorizationIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

const requestSchema = z.object({
  authorization_id: authorizationIdSchema,
  redirect_uri: z.string().max(2048),
  client: z.object({ id: z.string().min(1).max(128), name: z.string().max(200).nullable().optional() }),
  user: z.object({ id: z.string().uuid() }),
  scope: z.string().max(1024),
});

function callbackUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local))) return null;
    return url;
  } catch {
    return null;
  }
}

/** Only provider-returned, ownership-checked fields are exposed to the page. */
export function parseConsentRequest(value: unknown, authorizationId: string, userId: string) {
  const result = requestSchema.safeParse(value);
  if (!result.success || result.data.authorization_id !== authorizationId || result.data.user.id !== userId) return null;
  const callback = callbackUrl(result.data.redirect_uri);
  if (!callback) return null;
  const scopes = [...new Set(result.data.scope.split(/\s+/).filter(Boolean))];
  // These describe OIDC profile access, not application/database permissions.
  if (scopes.some((scope) => !["openid", "email", "profile", "phone"].includes(scope))) return null;
  return {
    authorizationId,
    clientId: result.data.client.id,
    clientName: result.data.client.name?.trim() || "Unnamed OAuth client",
    callback: callback.href,
    scopes,
  };
}

/** Denial can return an error, never an authorization code or token. */
export function safeDenialRedirect(value: unknown, registeredCallback: string): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  const url = callbackUrl(value);
  const base = callbackUrl(registeredCallback);
  if (!url || !base || url.origin !== base.origin || url.pathname !== base.pathname ||
    url.searchParams.getAll("error").length !== 1 || url.searchParams.get("error") !== "access_denied") return null;
  const allowed = new Set([...base.searchParams.keys(), "error", "error_description", "error_uri", "state"]);
  for (const name of url.searchParams.keys()) {
    if (!allowed.has(name) || ["code", "access_token", "id_token", "refresh_token"].includes(name)) return null;
  }
  for (const name of new Set(base.searchParams.keys())) {
    const expected = base.searchParams.getAll(name);
    const actual = url.searchParams.getAll(name);
    if (expected.length !== actual.length || expected.some((item, index) => item !== actual[index])) return null;
  }
  return url.href;
}

export function consentPath(authorizationId: string): string {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationIdSchema.parse(authorizationId))}`;
}

/** Approval carries only a provider code to the exact registered callback. */
export function safeApprovalRedirect(value: unknown, registeredCallback: string): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  const url = callbackUrl(value);
  const base = callbackUrl(registeredCallback);
  if (!url || !base || url.origin !== base.origin || url.pathname !== base.pathname
    || url.searchParams.getAll("code").length !== 1 || !url.searchParams.get("code")) return null;
  if (url.searchParams.getAll("state").length > 1) return null;
  const allowed = new Set([...base.searchParams.keys(), "code", "state"]);
  for (const name of url.searchParams.keys()) if (!allowed.has(name)) return null;
  for (const name of new Set(base.searchParams.keys())) {
    const expected = base.searchParams.getAll(name);
    const actual = url.searchParams.getAll(name);
    if (expected.length !== actual.length || expected.some((item, index) => item !== actual[index])) return null;
  }
  return url.href;
}
