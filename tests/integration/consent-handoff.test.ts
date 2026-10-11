import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { mcpConsentHandoff } from "@/services/integrations/consent-handoff";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const stage = "https://mcp-preview.example.test";
function fixture() {
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN", "https://production.example.test");
  vi.stubEnv("TRADE_OS_MCP_ENABLED", "false");
  vi.stubEnv("TRADE_OS_MCP_CONSENT_HANDOFF_ORIGIN", stage);
  const context = { client_id: clientId, purpose: "MCP", resource: `${stage}/mcp`,
    callback: "http://127.0.0.1:9878/callback", status: "pending" };
  const rpc = vi.fn(async () => ({ data: context as unknown, error: null as unknown }));
  const getClaims = vi.fn(async () => ({ data: { claims: { sub: owner } as Record<string, unknown> } as { claims: Record<string, unknown> } | null, error: null as unknown }));
  const getUser = vi.fn(async () => ({ data: { user: { id: owner } as { id: string } | null }, error: null as unknown }));
  const getAuthorizationDetails = vi.fn();
  const approveAuthorization = vi.fn();
  const client = { rpc, auth: { getClaims, getUser, oauth: { getAuthorizationDetails, approveAuthorization } } } as unknown as SupabaseClient<IntegrationDatabase>;
  return { client, rpc, context, getClaims, getUser, getAuthorizationDetails, approveAuthorization };
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
  it("routes an independently verified owned resume using only the request ID, never its code", async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    f.rpc.mockResolvedValueOnce({ data: { ...f.context, status: "approved" }, error: null });
    f.getAuthorizationDetails.mockResolvedValueOnce({ data: { redirect_url: `${f.context.callback}?code=private-fixture&state=nonce` }, error: null });
    expect(await mcpConsentHandoff(f.client, "request")).toBe(`${stage}/oauth/consent?authorization_id=request`);
    expect(f.approveAuthorization).not.toHaveBeenCalled();
  });
});
