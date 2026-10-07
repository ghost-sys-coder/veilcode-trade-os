import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approveGrantConsent, loadGrantConsent } from "@/services/integrations/grant-consent";
import type { IntegrationDatabase } from "@/types/integration-database";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const accountId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const grantId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const resource = "https://trade.example/api/integrations/v1";
const callback = "http://127.0.0.1:9876/callback";
const redirectUrl = `${callback}?code=fixture&state=nonce`;
const context = { client_id: clientId, purpose: "MT5", resource, callback, status: "approved" };
const grant = { id: grantId, client_id: clientId, purpose: "MT5", resource, account_id: accountId,
  version: "2", status: "ACTIVE", revoked_at: null, created_at: "2026-10-06T00:00:00Z" };
const blocked = { view: { status: "BLOCKED" }, eligibility: null };

function fixture() {
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");
  vi.stubEnv("TRADE_OS_MT5_ENABLED","true");
  vi.stubEnv("TRADE_OS_MCP_ENABLED","false");
  const rpc = vi.fn(async (name: string): Promise<{ error: unknown; data: unknown }> => ({
    error: null, data: name === "get_integration_consent_request" ? context : [grant],
  }));
  const single = vi.fn(async (): Promise<{ error: unknown; data: unknown }> => ({ error: null, data: { id: accountId } }));
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const auth = {
    getClaims: vi.fn(async (): Promise<{ error: unknown; data: { claims: Record<string,unknown> } | null }> => ({ error: null, data: { claims: { sub: owner } } })),
    getUser: vi.fn(async (): Promise<{ error: unknown; data: { user: { id: string } | null } }> => ({ error: null, data: { user: { id: owner } } })),
    oauth: {
      getAuthorizationDetails: vi.fn(async (): Promise<{ error: unknown; data: unknown }> => ({ error: null, data: { redirect_url: redirectUrl } })),
      approveAuthorization: vi.fn(), revokeGrant: vi.fn(),
    },
  };
  return { rpc, single, eq, select, from, auth, client: { rpc, from, auth } as unknown as SupabaseClient<IntegrationDatabase> };
}
afterEach(() => vi.unstubAllEnvs());

describe("already-consented reconnect without permission mutation", () => {
  it("resumes the registered callback only after owned request, active grant and account checks", async () => {
    const f = fixture();
    expect(await loadGrantConsent(f.client,"request")).toEqual({ view: { status: "RESUMED", redirectUrl }, eligibility: null });
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["get_integration_consent_request","list_integration_grants"]);
    expect(f.rpc).toHaveBeenNthCalledWith(1,"get_integration_consent_request",{ p_authorization_id: "request" });
    expect(f.from).toHaveBeenCalledExactlyOnceWith("trading_accounts");
    expect(f.eq).toHaveBeenCalledExactlyOnceWith("id",accountId);
    expect(f.auth.oauth.approveAuthorization).not.toHaveBeenCalled();
    expect(f.auth.oauth.revokeGrant).not.toHaveBeenCalled();
  });
  it("does not allow a stale approval form to rebind the existing account", async () => {
    const f = fixture();
    expect(await approveGrantConsent(f.client,"request",{ accountId: owner })).toEqual({ status: "BLOCKED" });
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["get_integration_consent_request","list_integration_grants"]);
    expect(f.auth.oauth.approveAuthorization).not.toHaveBeenCalled();
  });
  it.each([[],null,[{...grant,status:"REVOKED"}],[{...grant,status:"PENDING"}],
    [{...grant,revoked_at:"2026-10-06T01:00:00Z"}],[{...grant,client_id:owner}],
    [{...grant,resource:"https://wrong.example/api"}],[{...grant,purpose:"MCP"}],
    [{...grant,account_id:null}],[grant,grant],
  ])("never resumes missing, revoked, malformed, foreign or ambiguous grants: %j", async grants => {
    const f = fixture();
    f.rpc.mockResolvedValueOnce({error:null,data:context}).mockResolvedValueOnce({error:null,data:grants});
    expect(await loadGrantConsent(f.client,"request")).toEqual(blocked);
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each([{...context,status:"pending"},{...context,resource:"https://wrong.example/api"},
    {...context,purpose:"MCP",resource:"https://trade.example/mcp"},null,
  ])("requires a fully validated approved and enabled request: %j", async request => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({error:null,data:request});
    expect(await loadGrantConsent(f.client,"request")).toEqual(blocked);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the database rejects expiry, ownership or S256", async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({error:{code:"42501"},data:null});
    expect(await loadGrantConsent(f.client,"request")).toEqual(blocked);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("checks the application flag even when provider consent remains approved", async () => {
    const f = fixture(); vi.stubEnv("TRADE_OS_MT5_ENABLED","false");
    expect(await loadGrantConsent(f.client,"request")).toEqual(blocked);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{error:null,data:null},{error:{code:"42501"},data:null},{error:null,data:{id:owner}}])(
    "requires the originally granted account to remain owned/readable: %j", async result => {
      const f = fixture(); f.single.mockResolvedValueOnce(result);
      expect(await loadGrantConsent(f.client,"request")).toEqual(blocked);
    });
  it.each(["https://attacker.example/callback?code=fixture",`${callback}/other?code=fixture`,
    `${callback}?error=access_denied`,`${callback}?code=fixture&code=second`,
    `${callback}?code=fixture&access_token=private`,`${callback}?code=fixture#fragment`,
    `${callback}?code=fixture&state=first&state=second`,null,{},"x".repeat(4097),
  ])("rejects unsafe or malformed provider callbacks: %j", async url => {
    const f = fixture(); f.auth.oauth.getAuthorizationDetails.mockResolvedValueOnce({error:null,data:{redirect_url:url}});
    expect(await loadGrantConsent(f.client,"request")).toEqual(blocked);
  });
  it("requires direct browser identity and never accepts an OAuth client as consent authority", async () => {
    const f = fixture(); f.auth.getClaims.mockResolvedValueOnce({error:null,data:{claims:{sub:owner,client_id:clientId}}});
    expect(await loadGrantConsent(f.client,"request")).toEqual(blocked);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing or changed browser identity without reading grants", async () => {
    const f = fixture(); f.auth.getClaims.mockResolvedValueOnce({error:null,data:null});
    expect(await loadGrantConsent(f.client,"request")).toEqual({view:{status:"SIGN_IN_REQUIRED"},eligibility:null});
    f.auth.getUser.mockResolvedValueOnce({error:null,data:{user:{id:clientId}}});
    expect(await loadGrantConsent(f.client,"request")).toEqual({view:{status:"SIGN_IN_REQUIRED"},eligibility:null});
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("suppresses private provider/database errors without forwarding a callback", async () => {
    const f = fixture(); f.rpc.mockRejectedValueOnce(new Error("PRIVATE_FIXTURE_VALUE"));
    expect(await loadGrantConsent(f.client,"request")).toEqual(blocked);
  });
  it("can resume a separately enabled accountless MCP grant without inventing an account", async () => {
    const f = fixture(); vi.stubEnv("TRADE_OS_MCP_ENABLED","true");
    const mcpResource="https://trade.example/mcp";
    f.rpc.mockResolvedValueOnce({error:null,data:{...context,purpose:"MCP",resource:mcpResource}})
      .mockResolvedValueOnce({error:null,data:[{...grant,purpose:"MCP",resource:mcpResource,account_id:null}]});
    expect(await loadGrantConsent(f.client,"request")).toEqual({view:{status:"RESUMED",redirectUrl},eligibility:null});
    expect(f.from).not.toHaveBeenCalled();
  });
});
