import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { approveGrantConsent } from "@/services/integrations/grant-consent";
import { revokeConnectedGrant } from "@/services/integrations/grant-management";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const account = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const grantId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const resource = "https://trade.example/api/integrations/v1";
function provider() {
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example"); vi.stubEnv("TRADE_OS_MT5_ENABLED","true");
  const rpc = vi.fn(async (name: string) => ({ error: null as unknown, data: name === "get_integration_consent_request"
    ? { client_id: clientId, purpose: "MT5", resource, callback: "https://client.example/callback", status: "pending" }
    : name === "revoke_integration_grant" ? { id: grantId, client_id: clientId, revoked: true }
      : name === "activate_integration_grant" ? { id: grantId, version: "1", status: "ACTIVE" }
      : { id: grantId, version: "1", client_id: clientId, purpose: "MT5", account_id: account, resource } }));
  const auth = {
    getClaims: vi.fn(async () => ({ data: { claims: { sub: owner } }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: owner } }, error: null })),
    oauth: {
      getAuthorizationDetails: vi.fn(async () => ({ data: { authorization_id: "request", user: { id: owner }, client: { id: clientId, name: "Collector" },
        redirect_uri: "https://client.example/callback", scope: "email" }, error: null })),
      approveAuthorization: vi.fn(async () => ({ data: { redirect_url: "https://client.example/callback?code=fixture&state=nonce" }, error: null })),
      revokeGrant: vi.fn(async () => ({ error: null as unknown })),
    },
  };
  return { rpc, auth, client: { rpc, auth } as unknown as SupabaseClient<IntegrationDatabase> };
}
afterEach(() => vi.unstubAllEnvs());
describe("application consent and revocation adapters", () => {
  it("approves only after grant persistence, provider approval and activation", async () => {
    const fixture = provider();
    expect(await approveGrantConsent(fixture.client,"request",{ accountId: account })).toEqual({ status: "APPROVED", redirectUrl: "https://client.example/callback?code=fixture&state=nonce" });
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual(["get_integration_consent_request","approve_integration_grant","activate_integration_grant"]);
  });
  it("checks the application flag at action time", async () => {
    const fixture = provider(); vi.stubEnv("TRADE_OS_MT5_ENABLED","false");
    expect(await approveGrantConsent(fixture.client,"request",{ accountId: account })).toEqual({ status: "BLOCKED" });
    expect(fixture.auth.oauth.approveAuthorization).not.toHaveBeenCalled();
  });
  it("requires a deliberate account selection", async () => {
    const fixture = provider();
    expect(await approveGrantConsent(fixture.client,"request",{ accountId: null })).toEqual({ status: "BLOCKED" });
    expect(fixture.auth.oauth.approveAuthorization).not.toHaveBeenCalled();
  });
  it("does not invoke provider approval when database scope validation fails", async () => {
    const fixture = provider(); fixture.rpc.mockResolvedValueOnce({ data: { client_id: clientId, purpose: "MT5", resource, callback: "https://client.example/callback", status: "pending" }, error: null });
    fixture.rpc.mockResolvedValueOnce({ data: null as never, error: { code: "42501" } });
    expect(await approveGrantConsent(fixture.client,"request",{ accountId: account })).toEqual({ status: "BLOCKED" });
    expect(fixture.auth.oauth.approveAuthorization).not.toHaveBeenCalled();
  });
  it("revokes both sides after an uncertain provider acknowledgement", async () => {
    const fixture = provider(); fixture.auth.oauth.approveAuthorization.mockRejectedValueOnce(new Error("PRIVATE_FIXTURE_VALUE"));
    expect(await approveGrantConsent(fixture.client,"request",{ accountId: account })).toEqual({ status: "UNAVAILABLE" });
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toContain("revoke_integration_grant");
    expect(fixture.auth.oauth.revokeGrant).toHaveBeenCalledWith({ clientId });
    expect(fixture.rpc.mock.calls.map(([name]) => name)).not.toContain("activate_integration_grant");
  });
  it("cannot deliver a code to a changed destination", async () => {
    const fixture = provider(); fixture.auth.oauth.approveAuthorization.mockResolvedValueOnce({ data: { redirect_url: "https://attacker.example?code=fixture" }, error: null });
    expect(await approveGrantConsent(fixture.client,"request",{ accountId: account })).toEqual({ status: "UNAVAILABLE" });
    expect(fixture.rpc.mock.calls.map(([name]) => name)).not.toContain("activate_integration_grant");
  });
  it("reports provider revocation failures without undoing immediate application revocation", async () => {
    const fixture = provider(); fixture.auth.oauth.revokeGrant.mockResolvedValueOnce({ error: new Error("PRIVATE_FIXTURE_VALUE") });
    expect(await revokeConnectedGrant(fixture.client,{ id: grantId, version: "1" })).toEqual({ revoked: true, providerRevocationPending: true });
  });
  it.each([
    { id: grantId, version: "1", status: "PENDING" },
    { id: grantId, version: "2", status: "ACTIVE" },
    { id: account, version: "1", status: "ACTIVE" },
    null,
  ])("never forwards a code after an invalid activation acknowledgement", async (activation) => {
    const fixture = provider();
    const ordinary = fixture.rpc.getMockImplementation()!;
    fixture.rpc.mockImplementation(async (name) => name === "activate_integration_grant"
      ? { data: activation as never, error: null } : ordinary(name));
    expect(await approveGrantConsent(fixture.client,"request",{ accountId: account })).toEqual({ status: "UNAVAILABLE" });
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toContain("revoke_integration_grant");
    expect(fixture.auth.oauth.revokeGrant).toHaveBeenCalledWith({ clientId });
  });
});
