import { authorizationIdSchema, parseConsentRequest, safeDenialRedirect } from "@/domain/integrations/oauth-consent";

// Structural adapter contract lets tests use deterministic provider fixtures.
// Production receives the cookie-backed Supabase client, never a submitted owner ID.
interface ConsentProvider {
  auth: {
    getClaims(): PromiseLike<{ data: { claims: Record<string, unknown> } | null; error: unknown }>;
    getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
    oauth: {
      getAuthorizationDetails(id: string): PromiseLike<{ data: unknown; error: unknown }>;
      denyAuthorization(id: string, options: { skipBrowserRedirect: true }): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}

type ConsentRequest = NonNullable<ReturnType<typeof parseConsentRequest>>;
export type ConsentView =
  | { status: "SIGN_IN_REQUIRED" | "INVALID_REQUEST" | "UNAVAILABLE" | "BLOCKED" }
  | { status: "REQUEST"; request: ConsentRequest };

export async function loadOAuthConsent(provider: ConsentProvider, input: unknown): Promise<ConsentView> {
  const id = authorizationIdSchema.safeParse(input);
  if (!id.success) return { status: "INVALID_REQUEST" };
  try {
    const claims = await provider.auth.getClaims();
    if (claims.error) return { status: "UNAVAILABLE" };
    if (!claims.data?.claims.sub) return { status: "SIGN_IN_REQUIRED" };
    // OAuth clients must never impersonate a direct browser user for consent.
    if (claims.data.claims.client_id !== undefined && claims.data.claims.client_id !== null) return { status: "BLOCKED" };
    const user = await provider.auth.getUser();
    if (user.error) return { status: "UNAVAILABLE" };
    if (!user.data.user || user.data.user.id !== claims.data.claims.sub) return { status: "SIGN_IN_REQUIRED" };
    const details = await provider.auth.oauth.getAuthorizationDetails(id.data);
    if (details.error || !details.data) return { status: "INVALID_REQUEST" };
    // Already-consented redirects can carry codes without a new account selection.
    // Never let Supabase auto-consent bypass application grant validation.
    if (typeof details.data === "object" && "redirect_url" in details.data) return { status: "BLOCKED" };
    const request = parseConsentRequest(details.data, id.data, user.data.user.id);
    return request ? { status: "REQUEST", request } : { status: "INVALID_REQUEST" };
  } catch {
    return { status: "UNAVAILABLE" };
  }
}

/** Denial adapter; approvals use the separate, account-bound grant workflow. */
export async function decideOAuthConsent(provider: ConsentProvider, input: unknown, decision: unknown): Promise<
  { status: "DENIED"; redirectUrl: string } | { status: "SIGN_IN_REQUIRED" | "INVALID_REQUEST" | "UNAVAILABLE" | "BLOCKED" }
> {
  if (decision !== "deny") return { status: "BLOCKED" };
  // Re-read identity and provider request at action time; hidden fields aren't authority.
  const view = await loadOAuthConsent(provider, input);
  if (view.status !== "REQUEST") return view;
  try {
    const result = await provider.auth.oauth.denyAuthorization(view.request.authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data || typeof result.data !== "object" || !("redirect_url" in result.data)) return { status: "UNAVAILABLE" };
    const redirectUrl = safeDenialRedirect(result.data.redirect_url, view.request.callback);
    return redirectUrl ? { status: "DENIED", redirectUrl } : { status: "BLOCKED" };
  } catch {
    return { status: "UNAVAILABLE" };
  }
}
