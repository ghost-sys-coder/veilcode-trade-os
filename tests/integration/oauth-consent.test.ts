import { describe, expect, it, vi } from "vitest";

import { decideOAuthConsent, loadOAuthConsent } from "@/services/integrations/oauth-consent";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = "fixture-id";
const details = {
  authorization_id: id, client: { id: "client-id", name: "Demo collector" },
  user: { id: userId }, redirect_uri: "https://client.example/callback", scope: "email",
};

function provider() {
  return {
    auth: {
      getClaims: vi.fn(async (): Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }> => ({ data: { claims: { sub: userId } }, error: null })),
      getUser: vi.fn(async (): Promise<{ data: { user: { id: string } | null }; error: unknown }> => ({ data: { user: { id: userId } }, error: null })),
      oauth: {
        getAuthorizationDetails: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: details, error: null })),
        denyAuthorization: vi.fn<(id: string, options: { skipBrowserRedirect: true }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: { redirect_url: "https://client.example/callback?error=access_denied&state=fixture" }, error: null })),
        approveAuthorization: vi.fn(),
      },
    },
  };
}

describe("consent workflow with provider fixtures (not a live OAuth exchange)", () => {
  it("validates input before accessing identity/provider data", async () => {
    const client = provider();
    expect(await loadOAuthConsent(client, [id])).toEqual({ status: "INVALID_REQUEST" });
    expect(client.auth.getClaims).not.toHaveBeenCalled();
  });

  it("requires login and revalidates the direct user's server identity", async () => {
    const client = provider();
    client.auth.getClaims.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadOAuthConsent(client, id)).toEqual({ status: "SIGN_IN_REQUIRED" });
    expect(client.auth.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    expect((await loadOAuthConsent(client, id)).status).toBe("REQUEST");
    expect(client.auth.getUser).toHaveBeenCalledOnce();
  });

  it("rejects OAuth sessions masquerading as browser consent", async () => {
    const client = provider();
    client.auth.getClaims.mockResolvedValue({ data: { claims: { sub: userId, client_id: "assistant" } }, error: null });
    expect(await loadOAuthConsent(client, id)).toEqual({ status: "BLOCKED" });
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.auth.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it("refuses mismatched/revoked identities and foreign authorization requests", async () => {
    const client = provider();
    client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } }, error: null });
    expect(await loadOAuthConsent(client, id)).toEqual({ status: "SIGN_IN_REQUIRED" });
    client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("revoked") });
    expect(await loadOAuthConsent(client, id)).toEqual({ status: "UNAVAILABLE" });
    client.auth.oauth.getAuthorizationDetails.mockResolvedValueOnce({ data: { ...details, authorization_id: "foreign-request" }, error: null });
    expect(await loadOAuthConsent(client, id)).toEqual({ status: "INVALID_REQUEST" });
  });

  it("never forwards already-consented codes before application grant validation exists", async () => {
    const client = provider();
    client.auth.oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: "https://client.example/callback?code=secret" }, error: null });
    expect(await loadOAuthConsent(client, id)).toEqual({ status: "BLOCKED" });
  });

  it.each(["approve", null, "anything"])("blocks forged decision %j without invoking approval", async (decision) => {
    const client = provider();
    expect(await decideOAuthConsent(client, id, decision)).toEqual({ status: "BLOCKED" });
    expect(client.auth.oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(client.auth.oauth.denyAuthorization).not.toHaveBeenCalled();
  });

  it("rejects explicitly only after action-time identity and request checks", async () => {
    const client = provider();
    expect(await decideOAuthConsent(client, id, "deny")).toEqual({ status: "DENIED", redirectUrl: "https://client.example/callback?error=access_denied&state=fixture" });
    expect(client.auth.getUser).toHaveBeenCalledOnce();
    expect(client.auth.oauth.denyAuthorization).toHaveBeenCalledWith(id, { skipBrowserRedirect: true });
    expect(client.auth.oauth.approveAuthorization).not.toHaveBeenCalled();
  });

  it("doesn't trust stale render-time authentication during rejection", async () => {
    const client = provider();
    expect((await loadOAuthConsent(client, id)).status).toBe("REQUEST");
    client.auth.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await decideOAuthConsent(client, id, "deny")).toEqual({ status: "SIGN_IN_REQUIRED" });
    expect(client.auth.oauth.denyAuthorization).not.toHaveBeenCalled();
  });

  it("sanitizes network/provider failures, including a lost rejection acknowledgement", async () => {
    const client = provider();
    client.auth.oauth.getAuthorizationDetails.mockRejectedValueOnce(new Error("SENSITIVE_FIXTURE_VALUE"));
    expect(await loadOAuthConsent(client, id)).toEqual({ status: "UNAVAILABLE" });
    client.auth.oauth.denyAuthorization.mockRejectedValueOnce(new Error("SENSITIVE_FIXTURE_VALUE"));
    expect(await decideOAuthConsent(client, id, "deny")).toEqual({ status: "UNAVAILABLE" });
  });

  it("refuses a provider denial that returns an unsafe URL/code", async () => {
    const client = provider();
    client.auth.oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: "https://client.example/callback?error=access_denied&code=secret" }, error: null });
    expect(await decideOAuthConsent(client, id, "deny")).toEqual({ status: "BLOCKED" });
  });
});
