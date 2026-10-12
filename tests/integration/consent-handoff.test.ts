import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { mcpConsentHandoff } from "@/services/integrations/consent-handoff";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const grantId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const stage = "https://mcp-preview.example.test";
function fixture() {
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN", "https://production.example.test");
  vi.stubEnv("TRADE_OS_MCP_ENABLED", "false");
  vi.stubEnv("TRADE_OS_MCP_CONSENT_HANDOFF_ORIGIN", stage);
  const context = { client_id: clientId, purpose: "MCP", resource: `${stage}/mcp`,
    callback: "http://127.0.0.1:9878/callback", status: "pending" };
  const rpc = vi.fn(async (name: string, args?: unknown) => { void name; void args; return { data: context as unknown, error: null as unknown }; });
  const grant = { id: grantId, client_id: clientId, purpose: "MCP", resource: `${stage}/mcp`, account_id: null,
    version: "1", status: "ACTIVE", revoked_at: null, created_at: "2026-10-01T00:00:00Z" };
  const grants = vi.fn(async () => [grant] as unknown[]);
  const getClaims = vi.fn(async () => ({ data: { claims: { sub: owner } as Record<string, unknown> } as { claims: Record<string, unknown> } | null, error: null as unknown }));
  const getUser = vi.fn(async () => ({ data: { user: { id: owner } as { id: string } | null }, error: null as unknown }));
  const getAuthorizationDetails = vi.fn();
  const approveAuthorization = vi.fn();
  const clientRpc = vi.fn(async (name: string, args?: unknown) => name === "list_integration_grants"
    ? { data: await grants(), error: null } : rpc(name,args));
  const client = { rpc: clientRpc, auth: { getClaims, getUser, oauth: { getAuthorizationDetails, approveAuthorization } } } as unknown as SupabaseClient<IntegrationDatabase>;
  return { client, rpc, clientRpc, grant, grants, context, getClaims, getUser, getAuthorizationDetails, approveAuthorization };
}
afterEach(() => vi.unstubAllEnvs());

describe("explicit staging MCP consent handoff", () => {
  it.each(["pending", "approved"])("routes an owned %s request without enabling production or retrieving codes", async (status) => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: { ...f.context, status }, error: null });
    expect(await mcpConsentHandoff(f.client, "opaque-request_1")).toBe(`${stage}/oauth/consent?authorization_id=opaque-request_1`);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("get_integration_consent_request", { p_authorization_id: "opaque-request_1" });
    expect(f.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(f.approveAuthorization).not.toHaveBeenCalled();
    expect(process.env.TRADE_OS_MCP_ENABLED).toBe("false");
  });
  it("is inert without explicit routing configuration", async () => {
    const f = fixture(); vi.stubEnv("TRADE_OS_MCP_CONSENT_HANDOFF_ORIGIN", "");
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull();
    expect(f.getClaims).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("does not loop when running at the destination", async () => {
    const f = fixture(); vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN", stage);
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(["http://stage.example.test", "https://user:secret@stage.example.test", `${stage}/path`, `${stage}?next=bad`, `${stage}#fragment`, "//attacker.test", "https://localhost", ` ${stage}`, `${stage}/${"x".repeat(2048)}`])("rejects unsafe routing configuration %s", async (origin) => {
    const f = fixture(); vi.stubEnv("TRADE_OS_MCP_CONSENT_HANDOFF_ORIGIN", origin);
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([undefined, ["request", "other"], "../request", "request?next=attacker", "x".repeat(129)])("rejects invalid request IDs", async (id) => {
    const f = fixture(); expect(await mcpConsentHandoff(f.client, id)).toBeNull(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([{ sub: owner, client_id: clientId }, {}, { sub: "other-user" }])("requires a matching direct browser identity", async (claims) => {
    const f = fixture(); f.getClaims.mockResolvedValueOnce({ data: { claims }, error: null });
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("fails closed when user lookup is unavailable", async () => {
    const f = fixture(); f.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("private") });
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([{ purpose: "MT5" }, { resource: "https://attacker.test/mcp" }, { resource: `${stage}/mcp?next=bad` }, { status: "denied" }, { client_id: "invalid" }])("does not route mismatched or invalid database context", async (patch) => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: { ...f.context, ...patch }, error: null });
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull();
  });
  it("fails closed on private ownership, resource, expiry or PKCE rejection", async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: f.context, error: { code: "42501" } });
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull();
  });
  it("does not expose errors or mutate grants after an uncertain RPC", async () => {
    const f = fixture(); f.rpc.mockRejectedValueOnce(new Error("PRIVATE_VALUE"));
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull(); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("binds a fresh pending request through the provider, then repeats private authority", async () => {
    const f = fixture();
    f.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    f.getAuthorizationDetails.mockResolvedValueOnce({ data: { authorization_id: "request", user: { id: owner },
      client: { id: clientId, name: "Staging client" }, redirect_uri: f.context.callback, scope: "email" }, error: null });
    expect(await mcpConsentHandoff(f.client, "request")).toBe(`${stage}/oauth/consent?authorization_id=request`);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.getAuthorizationDetails).toHaveBeenCalledExactlyOnceWith("request");
    expect(f.approveAuthorization).not.toHaveBeenCalled();
  });
  it.each([
    { authorization_id: "other" }, { user: { id: clientId } }, { redirect_uri: "https://attacker.test/callback" },
    { client: { id: owner, name: "Other client" } },
  ])("rejects mismatches after provider binding", async (patch) => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    f.getAuthorizationDetails.mockResolvedValueOnce({ data: { authorization_id: "request", user: { id: owner },
      client: { id: clientId, name: "Staging client" }, redirect_uri: f.context.callback, scope: "email", ...patch }, error: null });
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull();
  });
  it.each([
    { data: { redirect_url: "https://client.test/callback?code=must-not-forward" }, error: null },
    { data: { redirect_url: null }, error: null },
    { data: { redirect_url: undefined }, error: null },
    { data: { redirect_url: "" }, error: null },
    { data: null, error: { code: "request_expired" } },
  ])("never forwards provider resume codes or failed details on binding fallback", async (details) => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    f.getAuthorizationDetails.mockResolvedValueOnce(details);
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull();
    const validatesResume = !details.error && typeof details.data?.redirect_url === "string" && details.data.redirect_url.length > 0;
    expect(f.rpc).toHaveBeenCalledTimes(validatesResume ? 2 : 1);
    expect(f.approveAuthorization).not.toHaveBeenCalled();
  });
  it("still rejects private resource/PKCE/ownership failures after a valid provider bind", async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    f.getAuthorizationDetails.mockResolvedValueOnce({ data: { authorization_id: "request", user: { id: owner },
      client: { id: clientId, name: "Staging client" }, redirect_uri: f.context.callback, scope: "email" }, error: null });
    expect(await mcpConsentHandoff(f.client, "request")).toBeNull(); expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it("returns an existing-consent code directly to the exact callback only after independent active-grant checks", async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    f.rpc.mockResolvedValue({ data: { ...f.context, status: "approved" }, error: null });
    f.getAuthorizationDetails.mockResolvedValueOnce({ data: { redirect_url: `${f.context.callback}?code=private-fixture&state=nonce` }, error: null });
    expect(await mcpConsentHandoff(f.client, "request")).toBe(`${f.context.callback}?code=private-fixture&state=nonce`);
    expect(f.grants).toHaveBeenCalledTimes(2);
    expect(f.rpc).toHaveBeenCalledTimes(3);
    expect(f.approveAuthorization).not.toHaveBeenCalled();
    expect(process.env.TRADE_OS_MCP_ENABLED).toBe("false");
  });
  it.each([
    [], [{ status: "REVOKED", revoked_at: "2026-10-01T00:00:00Z" }], [{ status: "PENDING" }],
    [{ client_id: owner }], [{ resource: "https://other.example.test/mcp" }], [{ purpose: "MT5", account_id: owner }],
    [{ account_id: owner }], [{}, {}], [{ version: "0" }],
  ].map(patches=>({patches})))("never resumes without exactly one valid active account-free matching grant (%#)", async ({patches}) => {
    const f=fixture();f.rpc.mockResolvedValue({data:{...f.context,status:"approved"},error:null});
    f.rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}});
    f.getAuthorizationDetails.mockResolvedValueOnce({data:{redirect_url:`${f.context.callback}?code=private-fixture&state=nonce`},error:null});
    f.grants.mockResolvedValueOnce(patches.map(p=>({...f.grant,...p})));
    expect(await mcpConsentHandoff(f.client,"request")).toBeNull();
    expect(f.approveAuthorization).not.toHaveBeenCalled();
    expect(f.clientRpc.mock.calls.every(([name])=>["get_integration_consent_request","list_integration_grants"].includes(name))).toBe(true);
  });
  it("rejects an unavailable grant read instead of trusting provider auto-consent", async()=>{
    const f=fixture();f.rpc.mockResolvedValue({data:{...f.context,status:"approved"},error:null});
    f.rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}});
    f.getAuthorizationDetails.mockResolvedValueOnce({data:{redirect_url:`${f.context.callback}?code=private-fixture`},error:null});
    f.grants.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_VALUE"));
    expect(await mcpConsentHandoff(f.client,"request")).toBeNull();
  });
  it.each([{status:"REVOKED"},{version:"2"},{id:owner},{account_id:owner},{resource:"https://other.example.test/mcp"},
    {purpose:"MT5"},{revoked_at:"2026-10-01T00:00:00Z"}])("rejects grant changes during reconnect validation (%#)",async patch=>{
      const f=fixture();f.rpc.mockResolvedValue({data:{...f.context,status:"approved"},error:null});
      f.rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}});
      f.getAuthorizationDetails.mockResolvedValueOnce({data:{redirect_url:`${f.context.callback}?code=private-fixture`},error:null});
      f.grants.mockResolvedValueOnce([f.grant]);f.grants.mockResolvedValueOnce([{...f.grant,...patch}]);
      expect(await mcpConsentHandoff(f.client,"request")).toBeNull();expect(f.approveAuthorization).not.toHaveBeenCalled();
    });
  it.each([{status:"pending"},{callback:"https://different.example.test/callback"},{client_id:owner},{resource:"https://other.example.test/mcp"}])
    ("rejects changed private context immediately before releasing a reconnect code (%#)",async patch=>{
      const f=fixture();f.rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}});
      f.rpc.mockResolvedValueOnce({data:{...f.context,status:"approved"},error:null});
      f.rpc.mockResolvedValueOnce({data:{...f.context,status:"approved",...patch},error:null});
      f.getAuthorizationDetails.mockResolvedValueOnce({data:{redirect_url:`${f.context.callback}?code=private-fixture`},error:null});
      expect(await mcpConsentHandoff(f.client,"request")).toBeNull();
    });
});
