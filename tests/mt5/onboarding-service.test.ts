import { afterEach,describe,expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { controlMt5Connection,getMt5OnboardingPreview,registerMt5Connection } from "@/services/mt5/onboarding";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const checkpoint = "2026-10-01T12:00:00+00:00";
const identity = { server: "Broker-Demo",login: "123",terminalInstallationId: id,currencyCode: "USD",currencyPrecision: 2,accountKind: "DEMO",positionMode: "NETTING" };
const connection = { id,accountId: id,grantId: id,status: "ONBOARDING",version: "1",attentionCode: null,
  onboardingApprovedAt: null,lastHeartbeatAt: checkpoint,lastSyncAt: checkpoint,captureCheckpoint: checkpoint,
  healthObservedAt: checkpoint,heartbeatStale: false,
  sourceFactCount: 1001,reviewCount: 0,incompleteCollections: 0,missingServerBatches: 0,publishedTradeCount: 0,identity };
function source(index: number) {
  const ticket = String(index+1);
  return { kind: "ORDER",sourceId: ticket,revisionId: ticket,observedAt: checkpoint,requiresReview: false,payload: {
    ticket,positionId: null,positionById: null,symbol: "EURUSD",type: "BUY_LIMIT",state: "CANCELED",initialVolume: "1",remainingVolume: "1",
    price: "1.1",stopLoss: null,takeProfit: null,setupAt: "2026-10-01T11:00:00.000Z",doneAt: "2026-10-01T12:00:00.000Z" } };
}
function fixture() {
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example"); vi.stubEnv("TRADE_OS_MT5_ENABLED","true");
  const page = { connectionId: id,snapshotToken: "a".repeat(64),ledgerToken: "b".repeat(64),version: "1",identity,captureCheckpoint: checkpoint,
    account: { name: "Demo account",currencyCode: "USD",currencyPrecision: 2,startingBalance: "1000",ledgerBalance: "1000.01" },
    sourceFactCount: 1001,incompleteCollections: 0,tradeCount: 0,trades: [] };
  const rpc = vi.fn(async (name: string,args?: { p_offset?: number; p_limit?: number }): Promise<{ error: null | { code: string }; data: unknown }> => ({ error: null,data:
    name === "mt5_list_connections" ? [connection] : name === "mt5_browser_source_page" ? { ...page,events:
      Array.from({ length: Math.min(args?.p_limit ?? 1000,1001-(args?.p_offset ?? 0)) },(_,i) => source(i+(args?.p_offset ?? 0))) }
      : { connectionId: id,version: "2",status: "PAUSED" } }));
  const auth = { getClaims: vi.fn(async () => ({ error: null,data: { claims: { sub: id,client_id: null as string | null } } })),
    getUser: vi.fn(async () => ({ error: null,data: { user: { id } } })) };
  const range = vi.fn(async () => ({ error: null,data: [{ id,symbol: "EURUSD" }] }));
  const from = vi.fn(() => ({ select: () => ({ order: () => ({ range }) }) }));
  return { rpc,auth,from,client: { rpc,auth,from } as unknown as SupabaseClient<IntegrationDatabase> };
}
afterEach(() => vi.unstubAllEnvs());
describe("verified MT5 onboarding services", () => {
  it("reads all source pages, checks a final snapshot and preserves decimal money", async () => {
    const f = fixture(); const result = await getMt5OnboardingPreview(f.client,id);
    expect(result.preview.bridge.ledgerBalance).toBe("1000.01");
    expect(f.rpc.mock.calls.filter(([name]) => name === "mt5_browser_source_page").map(([,args]) => args?.p_offset)).toEqual([0,1000,0]);
    expect(f.from).toHaveBeenCalledTimes(1); expect(f.from).toHaveBeenCalledWith("instruments");
  });
  it("rejects a changed source revision between pages", async () => {
    const f = fixture(); const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name,args) => { const response = await original(name,args);
      return name === "mt5_browser_source_page" && args?.p_offset === 1000 ? { ...response,data: { ...response.data as object,snapshotToken: "c".repeat(64) } } : response; });
    await expect(getMt5OnboardingPreview(f.client,id)).rejects.toThrow("CHANGED");
  });
  it("rejects a changed ledger while reading source pages", async () => {
    const f = fixture(); const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name,args) => { const response = await original(name,args);
      return name === "mt5_browser_source_page" && args?.p_offset === 1000 ? { ...response,data: { ...response.data as object,ledgerToken: "c".repeat(64) } } : response; });
    await expect(getMt5OnboardingPreview(f.client,id)).rejects.toThrow("CHANGED");
  });
  it("cannot use an OAuth client as browser consent or controls", async () => {
    const f = fixture(); f.auth.getClaims.mockResolvedValueOnce({ error: null,data: { claims: { sub: id,client_id: id } } });
    await expect(controlMt5Connection(f.client,{ connectionId: id,version: "1",operationId: id,action: "PAUSE",reason: "Review this account" })).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("checks the runtime flag for writes while allowing preserved data to be read", async () => {
    const f = fixture(); vi.stubEnv("TRADE_OS_MT5_ENABLED","false");
    await expect(controlMt5Connection(f.client,{ connectionId: id,version: "1",operationId: id,action: "PAUSE",reason: "Review this account" })).rejects.toThrow("UNAVAILABLE");
    expect(f.rpc).not.toHaveBeenCalled();
    expect((await getMt5OnboardingPreview(f.client,id)).accountName).toBe("Demo account");
  });
  it("rejects live identity and missing reasons before calling a mutation RPC", async () => {
    const f = fixture();
    await expect(registerMt5Connection(f.client,{ grantId: id,operationId: id,identity: { ...identity,accountKind: "LIVE" } })).rejects.toThrow("INVALID");
    await expect(controlMt5Connection(f.client,{ connectionId: id,version: "1",operationId: id,action: "PAUSE",reason: "" })).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("reports concurrency conflicts without leaking SQL errors", async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ data: null as never,error: { code: "40001" } });
    await expect(controlMt5Connection(f.client,{ connectionId: id,version: "1",operationId: id,action: "PAUSE",reason: "Review this account" })).rejects.toThrow("CONFLICT");
  });
});
