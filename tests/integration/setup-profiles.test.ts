import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
const { factory } = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: factory }));
import { createSetupProfile, listSetupProfiles, downloadSetupConfiguration, reconcileSetupProfile } from "@/services/integrations/setup-profiles";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clientId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const accountId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const operationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const base = { id, purpose: "MCP", clientKind: "CODEX", accountId: null, resource: "https://app.example/mcp",
  callbackUri: "http://127.0.0.1:9878/callback", clientId: null, status: "REGISTERING", version: "1",
  createdAt: "2026-10-12T15:00:00Z", updatedAt: "2026-10-12T15:00:00Z" };
function fixture() {
  vi.stubEnv("TRADE_OS_INTEGRATION_SETUP_ENABLED", "true");
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN", "https://app.example");
  vi.stubEnv("TRADE_OS_MCP_ENABLED", "true"); vi.stubEnv("TRADE_OS_MT5_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture_publishable_1234567890");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_fixture_never_a_real_secret");
  let registered = false, reservations = 0;
  let profile: typeof base = { ...base };
  const view = () => registered ? { ...profile, clientId, status: "READY", version: "2" } : { ...profile };
  const create = vi.fn(async () => { registered = true; return { error: null, data: {
    client_id: clientId, client_name: `Trade OS ${profile.clientKind} setup ${id}`, client_type: "public",
    registration_type: "manual", token_endpoint_auth_method: "none", redirect_uris: [profile.callbackUri],
  } }; });
  factory.mockReturnValue({ auth: { admin: { oauth: { createClient: create } } } });
  const rpc = vi.fn(async (name: string) => ({ error: null as null | { code: string }, data: name === "list_integration_setups"
    ? { profiles: [view()], databaseEnabled: { MT5: true, MCP: true } }
    : name === "reserve_integration_setup" ? { ...view(), createAllowed: reservations++ === 0 } : view() }));
  const auth = {
    getClaims: vi.fn(async () => ({ error: null as null | Error, data: { claims: { sub: owner,
      session_id: operationId, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 } } })),
    getUser: vi.fn(async () => ({ error: null, data: { user: { id: owner } } })),
  };
  const single = vi.fn(async () => ({ error: null, data: { id: accountId, name: "USD demo", currency_code: "USD", currency_precision: 2 } }));
  const chain = { eq: vi.fn(), single };
  chain.eq.mockReturnValue(chain);
  const from = vi.fn(() => ({ select: vi.fn(() => chain) }));
  return { rpc, auth, create, single, chain, from, client: { rpc, auth, from } as unknown as SupabaseClient<IntegrationDatabase>,
    register: () => { registered = true; }, setProfile: (value: typeof base) => { profile = value; } };
}
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const request = { operationId, clientKind: "CODEX", accountId: null };
describe("owned setup services", () => {
  it("reserves before exactly one public provider registration and verifies stored metadata", async () => {
    const f = fixture(); const result = await createSetupProfile(f.client, request);
    expect(result.status).toBe("READY");
    expect(f.rpc.mock.calls[0]).toEqual(["reserve_integration_setup", { p_operation_id: operationId,
      p_client_kind: "CODEX", p_account_id: null, p_resource: "https://app.example/mcp" }]);
    expect(f.create).toHaveBeenCalledExactlyOnceWith({ client_name: `Trade OS CODEX setup ${id}`,
      redirect_uris: ["http://127.0.0.1:9878/callback"], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    expect(result).not.toHaveProperty("client_secret");
  });
  it("identical sequential retries do not create another provider client", async () => {
    const f = fixture(); await createSetupProfile(f.client, request); await createSetupProfile(f.client, request);
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("concurrent reservation results permit one creator only", async () => {
    const f = fixture(); await Promise.all([createSetupProfile(f.client, request), createSetupProfile(f.client, request)]);
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("recovers a simultaneous completion version conflict without another provider create", async () => {
    const f = fixture();
    const normal = f.rpc.getMockImplementation()!;
    let conflict = true;
    f.rpc.mockImplementation(async name => {
      if (name === "reconcile_integration_setup" && conflict) {
        conflict = false; return { error: { code: "PT409" }, data: null } as never;
      }
      return normal(name);
    });
    expect((await createSetupProfile(f.client, request)).status).toBe("READY");
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.rpc.mock.calls.filter(([name]) => name === "reconcile_integration_setup")).toHaveLength(2);
  });
  it("an uncertain response remains held and retry does not replay creation", async () => {
    const f = fixture(); f.create.mockRejectedValueOnce(new TypeError("private provider details"));
    expect((await createSetupProfile(f.client, request)).status).toBe("REGISTERING");
    expect((await createSetupProfile(f.client, request)).status).toBe("REGISTERING");
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("recovery can discover a late provider commit without creation", async () => {
    const f = fixture(); f.register();
    expect((await reconcileSetupProfile(f.client, { id, version: "1" })).status).toBe("READY");
    expect(f.create).not.toHaveBeenCalled();
  });
  it("missing secret rejects before reservation", async () => {
    const f = fixture(); vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await expect(createSetupProfile(f.client, request)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(f.rpc).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled();
  });
  it.each(["TRADE_OS_INTEGRATION_SETUP_ENABLED", "TRADE_OS_MCP_ENABLED"])("disabled %s blocks all registration", async flag => {
    const f = fixture(); vi.stubEnv(flag, "false");
    await expect(createSetupProfile(f.client, request)).rejects.toMatchObject({ code: "DISABLED" });
    expect(f.create).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("disabled feature does not query missing migrations", async () => {
    const f = fixture(); vi.stubEnv("TRADE_OS_INTEGRATION_SETUP_ENABLED", "false");
    expect(await listSetupProfiles(f.client)).toEqual([]); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("OAuth actors cannot provision clients", async () => {
    const f = fixture(); f.auth.getClaims.mockResolvedValueOnce({ error: null, data: { claims: {
      sub: owner, session_id: operationId, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600,
      client_id: clientId,
    } } } as never);
    await expect(createSetupProfile(f.client, request)).rejects.toThrow();
    expect(factory).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("mismatched verified browser owner rejects before privileged requests", async () => {
    const f = fixture(); f.auth.getUser.mockResolvedValueOnce({ error: null, data: { user: { id: clientId } } });
    await expect(createSetupProfile(f.client, request)).rejects.toThrow(); expect(factory).not.toHaveBeenCalled();
  });
  it("does not accept a submitted destination or owner", async () => {
    const f = fixture(); await expect(createSetupProfile(f.client, { ...request, ownerId: owner, resource: "https://evil.example/mcp" })).rejects.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
  it.each(["client_type", "token_endpoint_auth_method", "redirect_uris", "client_secret"])("holds invalid provider %s without exposing it", async field => {
    const f = fixture(); const response = await f.create(); f.create.mockClear();
    f.create.mockResolvedValueOnce({ ...response, data: { ...response.data, [field]: "private-untrusted-value" } } as never);
    f.setProfile({ ...base });
    // A fresh reservation remains REGISTERING until the response itself is validated.
    f.rpc.mockResolvedValueOnce({ error: null, data: { ...base, createAllowed: true } });
    const result = await createSetupProfile(f.client, request);
    expect(result.status).toBe("REGISTERING"); expect(JSON.stringify(result)).not.toContain("private-untrusted-value");
  });
  it("maps request conflicts without leaking database errors", async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ error: { code: "PT409" }, data: null } as never);
    await expect(createSetupProfile(f.client, request)).rejects.toMatchObject({ code: "CONFLICT" }); expect(factory).not.toHaveBeenCalled();
  });
  it("download is owner-scoped and rechecks provider readiness", async () => {
    const f = fixture(); f.register();
    const file = await downloadSetupConfiguration(f.client, id);
    expect(file.configuration).toMatchObject({ version: 1, clientId, resource: base.resource, redirectUri: base.callbackUri });
    expect(f.rpc.mock.calls.some(([name]) => name === "reconcile_integration_setup")).toBe(true);
    await expect(downloadSetupConfiguration(f.client, operationId)).rejects.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
  it("unregistered downloads are rejected", async () => {
    const f = fixture(); await expect(downloadSetupConfiguration(f.client, id)).rejects.toMatchObject({ code: "NOT_READY" });
  });
  it("MT5 bootstrap preserves currency precision without fabricating a terminal or connection", async () => {
    const f = fixture(); f.setProfile({ ...base, purpose: "MT5", clientKind: "MT5_WINDOWS", accountId,
      resource: "https://app.example/api/integrations/v1", callbackUri: "http://127.0.0.1:9876/callback" } as never); f.register();
    const file = await downloadSetupConfiguration(f.client, id);
    expect(file.configuration).toMatchObject({ format: "trade-os-setup", ownerId: owner, account: { id: accountId, currencyPrecision: 2 } });
    expect(file.configuration).not.toHaveProperty("terminal"); expect(file.configuration).not.toHaveProperty("connectionId");
    expect(f.chain.eq).toHaveBeenCalledWith("user_id", owner);
  });
});
