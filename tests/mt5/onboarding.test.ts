import { describe,expect,it } from "vitest";
import { buildMt5OnboardingPreview, mt5StoredSourceSchema, type Mt5ConnectionView, type Mt5StoredSource } from "@/domain/mt5/onboarding";
import type { Mt5Deal, Mt5SourceEvent } from "@/domain/mt5/source";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const instrumentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const checkpoint = "2026-10-01T12:00:00.000Z";
const connection: Mt5ConnectionView = { id,accountId: id,grantId: id,status: "ONBOARDING",version: "1",attentionCode: null,
  onboardingApprovedAt: null,lastHeartbeatAt: checkpoint,lastSyncAt: checkpoint,captureCheckpoint: checkpoint,
  healthObservedAt: checkpoint,heartbeatStale: false,
  sourceFactCount: 0,reviewCount: 0,incompleteCollections: 0,missingServerBatches: 0,publishedTradeCount: 0,
  identity: { server: "Broker-Demo",login: "123",terminalInstallationId: id,currencyCode: "USD",currencyPrecision: 2,
    accountKind: "DEMO",positionMode: "NETTING" } };
const deal = (ticket: string,override: Partial<Mt5Deal> = {}): Mt5Deal => ({ ticket,orderId: ticket,positionId: "100",symbol: "EURUSD",
  occurredAt: `2026-10-01T10:00:0${ticket}.000Z`,type: "BUY",entry: "IN",volume: "1",price: "1.1",
  profit: "0",commission: "0",swap: "0",fee: "0",...override });
function stored(event: Mt5SourceEvent,requiresReview = false): Mt5StoredSource {
  return mt5StoredSourceSchema.parse({ kind: event.kind,sourceId: event.sourceId,observedAt: event.observedAt,
    revisionId: "1",requiresReview,payload: event.payload });
}
const dealSource = (payload: Mt5Deal,review = false) => stored({ kind: "DEAL",sourceId: payload.ticket,observedAt: checkpoint,payload },review);
const observation = (balance = "1000",observedAt = checkpoint) => stored({ kind: "ACCOUNT",sourceId: "ACCOUNT",observedAt,
  payload: { balance,equity: "1001",unrealizedPnl: "1",observedAt } });
const position = () => stored({ kind: "POSITION",sourceId: "100",observedAt: checkpoint,
  payload: { positionId: "100",ticket: "100",symbol: "EURUSD",direction: "BUY",volume: "0.5",
    entryPrice: "1.1",currentStop: null,currentTarget: null,unrealizedPnl: "1",observedAt: checkpoint } });
function preview(sources: Mt5StoredSource[],override: Partial<Parameters<typeof buildMt5OnboardingPreview>[0]> = {}) {
  return buildMt5OnboardingPreview({ connection,sources,instruments: [{ id: instrumentId,symbol: "EURUSD" }],
    existingTrades: [],startingBalance: "1000",ledgerBalance: "1000",...override });
}
const closed = [dealSource(deal("1",{ commission: "-2" })),dealSource(deal("2",{ type: "SELL",entry: "OUT",profit: "100",commission: "-3" })),observation("1095")];

describe("MT5 import onboarding preview", () => {
  it("bridges 1000 baseline + 95 closed net to 1095 broker balance without approving it", () => {
    const result = preview(closed);
    expect(result.bridge).toMatchObject({ ledgerBalance: "1000.00",proposedClosedPnlChange: "95.00",brokerBalance: "1095.00",unexplainedDifference: "0.00" });
    expect(result.reconciliationState).toBe("NOT_APPROVED"); expect(result.episodes[0].publishable).toBe(true);
  });
  it("does not double count an already published closed episode", () => {
    const result = preview(closed,{ ledgerBalance: "1095",existingTrades: [{ id,symbol: "EURUSD",direction: "BUY",openedAt: closed[0].event.kind === "DEAL" ? closed[0].event.payload.occurredAt : null,
      closedAt: "2026-10-01T10:00:02.000Z",canonicalIdentity: `${id}:100:1:BUY`,closedNetPnl: "95" }] });
    expect(result.bridge.proposedClosedPnlChange).toBe("0.00"); expect(result.bridge.unexplainedDifference).toBe("0.00");
  });
  it("keeps partial-exit cash out of closed-trade performance", () => {
    const result = preview([dealSource(deal("1",{ commission: "-1" })),dealSource(deal("2",{ type: "SELL",entry: "OUT",volume: "0.5",profit: "20",commission: "-1" })),position(),observation("1018")]);
    expect(result.bridge).toMatchObject({ proposedClosedPnlChange: "0.00",openTradeRecognizedCash: "18.00",unexplainedDifference: "0.00" });
    expect(result.episodes[0].episode.finalNetPnl).toBeNull(); expect(result.episodes[0].episode.outcome).toBeNull();
  });
  it("holds a manually recorded overlapping trade instead of duplicating it", () => {
    const result = preview(closed,{ existingTrades: [{ id,symbol: "EURUSD",direction: "BUY",openedAt: "2026-10-01T09:00:00Z",closedAt: null,canonicalIdentity: null,closedNetPnl: null }] });
    expect(result.episodes[0].matchingTradeIds).toEqual([id]); expect(result.episodes[0].publishable).toBe(false);
    expect(result.bridge.proposedClosedPnlChange).toBe("0.00");
  });
  it("holds changed broker financial facts for explicit review", () => {
    const revised = { ...closed[0],requiresReview: true };
    const result = preview([revised,...closed.slice(1)]);
    expect(result.episodes[0].publishable).toBe(false); expect(result.problems.map(item => item.code)).toContain("SOURCE_REVISION_REVIEW");
  });
  it("does not guess instrument suffix mappings", () => {
    const result = preview(closed,{ instruments: [{ id: instrumentId,symbol: "EURUSD.a" }] });
    expect(result.episodes[0].instrumentId).toBeNull(); expect(result.episodes[0].publishable).toBe(false);
  });
  it("uses explicit mappings without changing raw broker symbols or financial values",()=>{
    const alias=closed.map(source=>source.event.kind==="DEAL"?dealSource({...source.event.payload,symbol:"EURUSD.m"}):source);
    const mappings=[{brokerSymbol:"EURUSD.m",instrumentId,version:"1",reason:"Broker alias confirmed",updatedAt:checkpoint}];
    const result=preview(alias,{symbolMappings:mappings});
    expect(result.episodes[0]).toMatchObject({instrumentId,publishable:true});
    expect(result.episodes[0].episode.symbol).toBe("EURUSD.m");
    expect(result.bridge.proposedClosedPnlChange).toBe("95.00");
    const conflict=preview(alias,{symbolMappings:mappings,existingTrades:[{id,symbol:"EURUSD",direction:"BUY",openedAt:"2026-10-01T09:00:00Z",closedAt:null,canonicalIdentity:null,closedNetPnl:null}]});
    expect(conflict.episodes[0]).toMatchObject({publishable:false,matchingTradeIds:[id]});
  });
  it("does not fall back to guessed exact symbols when an approved instrument is unavailable",()=>{
    expect(preview(closed,{symbolMappings:[{brokerSymbol:"EURUSD",instrumentId:id,version:"1",reason:"Selected custom instrument",updatedAt:checkpoint}]}).episodes[0].publishable).toBe(false);
  });
  it("does not choose silently between ambiguous exact symbols", () => {
    expect(preview(closed,{ instruments: [{ id,symbol: "EURUSD" },{ id: instrumentId,symbol: "EURUSD" }] }).episodes[0].publishable).toBe(false);
  });
  it("holds incomplete batch collections despite individually valid executions", () => {
    const result = preview(closed,{ connection: { ...connection,incompleteCollections: 1 } });
    expect(result.episodes[0].publishable).toBe(false); expect(result.problems.map(item => item.code)).toContain("INCOMPLETE_CAPTURE");
  });
  it("stages opening funding/credit facilities instead of inventing deposits", () => {
    const result = preview([...closed,dealSource(deal("3",{ positionId: null,symbol: null,entry: null,type: "CREDIT",volume: "0",profit: "500" }))]);
    expect(result.cashMovements).toHaveLength(1); expect(result.problems.map(item => item.code)).toContain("CASH_CLASSIFICATION_REQUIRED");
    expect(result.bridge.proposedClosedPnlChange).toBe("95.00");
  });
  it("does not infer closure from missing position observations", () => {
    const result = preview([dealSource(deal("1")),observation()]);
    expect(result.episodes[0].episode.status).toBe("OPEN"); expect(result.episodes[0].publishable).toBe(false);
    expect(result.problems.map(item => item.code)).toContain("OPEN_POSITION_UNCONFIRMED");
  });
  it("detects missing entry history for observed current positions", () => {
    expect(preview([position(),observation()]).problems.map(item => item.code)).toContain("OPEN_POSITION_MISMATCH");
  });
  it("requires a positive baseline and preserves unknown plans/R", () => {
    const result = preview(closed,{ startingBalance: "0" }); expect(result.episodes[0].publishable).toBe(false);
    expect(result.episodes[0].episode).not.toHaveProperty("plannedStopLoss"); expect(result.episodes[0].episode).not.toHaveProperty("actualR");
  });
  it("normalizes different currency precisions centrally", () => {
    expect(preview(closed,{ connection: { ...connection,identity: { ...connection.identity,currencyCode: "JPY",currencyPrecision: 0 } } }).bridge.proposedClosedPnlChange).toBe("95");
  });
  it("flags stale account observations and doesn't call a missing balance zero", () => {
    expect(preview(closed.slice(0,2)).bridge.brokerBalance).toBeNull();
    expect(preview([...closed.slice(0,2),observation("1095","2026-10-01T11:00:00.000Z")]).problems.map(item => item.code)).toContain("STALE_BALANCE_OBSERVATION");
  });
  it("rejects invalid durable payloads and binary financial numbers", () => {
    expect(() => mt5StoredSourceSchema.parse({ kind: "ACCOUNT",sourceId: "ACCOUNT",observedAt: checkpoint,revisionId: "1",requiresReview: false,
      payload: { balance: 1000,equity: "1000",unrealizedPnl: "0",observedAt: checkpoint } })).toThrow();
  });
});
