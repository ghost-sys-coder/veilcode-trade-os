import { describe, expect, it } from "vitest";
import { parseDecimal, sumDecimals } from "@/domain/money/decimal";
import { reconstructMt5Deals } from "@/domain/mt5/reconstruct";
import { assertMt5Identity, mt5DealSchema, type Mt5Deal, type Mt5Identity } from "@/domain/mt5/source";
import { calculateNetPnl } from "@/domain/trades/financials";

const connection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondConnection = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function deal(ticket: string, fields: Partial<Mt5Deal> = {}): Mt5Deal {
  return { ticket, orderId: ticket, positionId: "100", symbol: "EURUSD", type: "BUY", entry: "IN",
    occurredAt: `2026-10-01T10:00:${ticket.padStart(2,"0")}.000Z`, volume: "1", price: "1.1",
    profit: "0", commission: "0", swap: "0", fee: "0", ...fields };
}
function reconstruct(deals: unknown, currencyPrecision = 2, positionMode: "NETTING" | "HEDGING" = "NETTING", connectionId = connection) {
  return reconstructMt5Deals({ connectionId, currencyPrecision, positionMode, deals });
}
const identity: Mt5Identity = { login: "12345", server: "Broker-Demo", terminalInstallationId: connection,
  currencyCode: "USD", currencyPrecision: 2, accountKind: "DEMO", positionMode: "NETTING" };

describe("MT5 account isolation", () => {
  it("accepts only the exact explicitly mapped demo identity", () => { expect(assertMt5Identity(identity,identity)).toEqual(identity); });
  it.each([
    { login: "12346" }, { server: "Different-Demo" }, { terminalInstallationId: secondConnection },
    { currencyCode: "GBP" }, { currencyPrecision: 3 }, { positionMode: "HEDGING" },
  ])("pauses instead of redirecting data when account identity changes: %j", change => {
    expect(() => assertMt5Identity(identity,{ ...identity,...change })).toThrow("MT5_ACCOUNT_IDENTITY_MISMATCH");
  });
  it("does not allow live activation by changing both sides of the mapping", () => {
    expect(() => assertMt5Identity({ ...identity,accountKind: "LIVE" },{ ...identity,accountKind: "LIVE" })).toThrow("DEMO_ACCOUNT_REQUIRED");
  });
  it("reused broker IDs across connections produce different canonical identities", () => {
    const facts = [deal("1"),deal("2",{ type: "SELL",entry: "OUT",profit: "10" })];
    expect(reconstruct(facts).episodes[0].canonicalIdentity).not.toEqual(reconstruct(facts,2,"NETTING",secondConnection).episodes[0].canonicalIdentity);
  });
});

describe("MT5 directional episodes and financial attribution", () => {
  it("closes a simple position with non-negative costs and broker trading credits", () => {
    const result = reconstruct([deal("1",{ commission: "-2" }),deal("2",{ type: "SELL",entry: "OUT",profit: "100",commission: "-3",swap: "1.5",fee: "-0.5" })]);
    expect(result.issues).toEqual([]);
    expect(result.episodes[0]).toMatchObject({ status: "CLOSED",grossPnl: "100",commission: "5",swap: "0",otherFees: "0.5",tradingCredits: "1.5",finalNetPnl: "96.00",outcome: "WIN" });
  });
  it("retains scale-ins and partial exits in one trade until complete closure", () => {
    const result = reconstruct([deal("1",{ commission: "-1" }),deal("2",{ price: "1.2",commission: "-1" }),
      deal("3",{ type: "SELL",entry: "OUT",volume: "0.5",price: "1.3",profit: "20",commission: "-1" })]);
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0]).toMatchObject({ status: "OPEN",entryPrice: "1.15",openedVolume: "2",remainingVolume: "1.5",finalNetPnl: null,outcome: null,recognizedCash: "17.00",usedPartialExits: true });
  });
  it("a profitable partial exit does not override a losing complete trade", () => {
    const result = reconstruct([deal("1"),deal("2",{ type: "SELL",entry: "OUT",volume: "0.4",profit: "20" }),
      deal("3",{ type: "SELL",entry: "OUT",volume: "0.6",profit: "-25" })]);
    expect(result.episodes[0]).toMatchObject({ finalNetPnl: "-5.00",outcome: "PARTIAL_LOSS",remainingVolume: "0",closedAt: "2026-10-01T10:00:03.000Z" });
  });
  it.each([["25","PARTIAL_WIN","45.00"],["-20","BREAK_EVEN","0.00"]])("classifies the complete partial-managed position: %s", (profit,outcome,finalNetPnl) => {
    expect(reconstruct([deal("1"),deal("2",{ type: "SELL",entry: "OUT",volume: "0.5",profit: "20" }),
      deal("3",{ type: "SELL",entry: "OUT",volume: "0.5",profit })]).episodes[0]).toMatchObject({ outcome,finalNetPnl });
  });
  it("a netting reversal splits identity, closing profit/swap and proportional transaction costs", () => {
    const result = reconstruct([deal("1",{ commission: "-2" }),
      deal("2",{ type: "SELL",entry: "INOUT",volume: "3",profit: "90",swap: "-3",commission: "-9",fee: "-3" }),
      deal("3",{ type: "BUY",entry: "OUT",volume: "2",profit: "-10",commission: "-2" })]);
    expect(result.issues).toEqual([]);
    expect(result.episodes).toHaveLength(2);
    expect(result.episodes[0]).toMatchObject({ openingDealTicket: "1",direction: "BUY",grossPnl: "90",commission: "5",swap: "3",otherFees: "1",finalNetPnl: "81.00",outcome: "WIN" });
    expect(result.episodes[1]).toMatchObject({ openingDealTicket: "2",direction: "SELL",grossPnl: "-10",commission: "8",swap: "0",otherFees: "2",finalNetPnl: "-20.00",outcome: "LOSS" });
    expect(result.episodes[0].canonicalIdentity).not.toBe(result.episodes[1].canonicalIdentity);
    expect(result.episodes[0].allocations[1].convention).toBe("PROPORTIONAL_VOLUME");
    // Total cash: 90 - 10 - (2 + 9 + 2) - 3 - 3 = 61.
    expect(sumDecimals(result.episodes.map(episode => episode.finalNetPnl!)).toString()).toBe("61");
  });
  it("uses explicit broker reversal allocations in preference to proportional inference", () => {
    const result = reconstruct([deal("1"),deal("2",{ type: "SELL",entry: "INOUT",volume: "3",profit: "10",commission: "-9",fee: "-3",
      reversalAllocation: { closingCommission: "-8",openingCommission: "-1",closingFee: "-3",openingFee: "0" } })]);
    expect(result.episodes[0]).toMatchObject({ commission: "8",otherFees: "3",finalNetPnl: "-1.00" });
    expect(result.episodes[1]).toMatchObject({ status: "OPEN",commission: "1",recognizedCash: "-1.00",finalNetPnl: null });
    expect(result.episodes[0].allocations[1].convention).toBe("EXPLICIT_BROKER_ALLOCATION");
  });
  it("does not repeatedly round the allocated reversal fees", () => {
    const result = reconstruct([deal("1"),deal("2",{ type: "SELL",entry: "INOUT",volume: "3",commission: "-1",fee: "-0.1" })]);
    const allocations = result.episodes.flatMap(episode => episode.allocations).filter(row => row.dealTicket === "2");
    expect(sumDecimals(allocations.map(row => row.commission)).eq("-1")).toBe(true);
    expect(sumDecimals(allocations.map(row => row.fee)).eq("-0.1")).toBe(true);
    expect(allocations[0].commission.length).toBeGreaterThan(20);
  });
  it("starts a distinct episode after flattening even when position and order IDs repeat", () => {
    const result = reconstruct([deal("1"),deal("2",{ type: "SELL",entry: "OUT" }),deal("3",{ orderId: "1" }),deal("4",{ type: "SELL",entry: "OUT" })]);
    expect(result.episodes).toHaveLength(2);
    expect(new Set(result.episodes.map(episode => episode.canonicalIdentity)).size).toBe(2);
  });
  it("handles hedging close-by using each position's actual deal facts, not invented opposing PnL", () => {
    const result = reconstruct([deal("1"),deal("2",{ type: "SELL",positionId: "200" }),
      deal("3",{ type: "SELL",entry: "OUT_BY",profit: "50" }),deal("4",{ type: "BUY",positionId: "200",entry: "OUT_BY",profit: "0" })],2,"HEDGING");
    expect(result.issues).toEqual([]);
    expect(result.episodes.map(episode => episode.finalNetPnl)).toEqual(["50.00","0.00"]);
  });
  it.each([[0,"0.5","1","WIN"],[2,"0.01","0.01","WIN"],[2,"-0.01","-0.01","LOSS"],
    [3,"0.001","0.001","WIN"],[3,"-0.001","-0.001","LOSS"],[3,"0.0004","0.000","BREAK_EVEN"]] as const)
  ("uses currency precision %s only at final money boundaries", (precision,profit,net,outcome) => {
    expect(reconstruct([deal("1",{ volume: "0.00123",price: "1.123456789" }),deal("2",{ type: "SELL",entry: "OUT",volume: "0.00123",profit })],precision).episodes[0])
      .toMatchObject({ finalNetPnl: net,outcome,entryPrice: "1.123456789",openedVolume: "0.00123" });
  });
  it("replays and reorders identical facts deterministically", () => {
    const entry = deal("1"), exit = deal("2",{ type: "SELL",entry: "OUT",profit: "0.1" });
    expect(reconstruct([exit,entry,exit,entry])).toEqual(reconstruct([entry,exit]));
  });
  it("sorts same-millisecond tickets as integer strings beyond JavaScript safe integers", () => {
    const timestamp = "2026-10-01T10:00:00.000Z";
    const entry = deal("9007199254740993",{ occurredAt: timestamp }), exit = deal("9007199254740994",{ occurredAt: timestamp,type: "SELL",entry: "OUT",profit: "1" });
    expect(reconstruct([exit,entry]).episodes[0].outcome).toBe("WIN");
  });
  it("repeated tiny executions accumulate without floating-point drift", () => {
    const entries = Array.from({ length: 100 }, (_,i) => deal(String(i + 1),{ occurredAt: "2026-10-01T10:00:00.000Z",volume: "0.01",commission: "-0.001" }));
    const result = reconstruct([...entries,deal("101",{ occurredAt: "2026-10-01T11:00:00.000Z",type: "SELL",entry: "OUT",profit: "0.11" })]);
    expect(result.episodes[0]).toMatchObject({ openedVolume: "1",commission: "0.1",finalNetPnl: "0.01",outcome: "WIN" });
  });
});

describe("MT5 uncertain and unsupported facts remain staged", () => {
  it.each([
    ["MISSING_ENTRY_HISTORY",[deal("1",{ type: "SELL",entry: "OUT" })]],
    ["INCONSISTENT_EXECUTION",[deal("1"),deal("2",{ entry: "OUT" })]],
    ["INCONSISTENT_EXECUTION",[deal("1"),deal("2",{ type: "SELL",entry: "OUT",volume: "2" })]],
    ["INCONSISTENT_EXECUTION",[deal("1"),deal("2",{ type: "SELL",entry: "INOUT",volume: "0.5" })]],
    ["UNSUPPORTED_EVENT",[deal("1"),deal("2",{ type: "BUY_CANCELED" })]],
    ["UNSUPPORTED_EVENT",[deal("1",{ profit: "1" })]],
    ["INCONSISTENT_EXECUTION",[deal("1"),deal("2",{ symbol: "GBPUSD" })]],
    ["INVALID_REVERSAL_ALLOCATION",[deal("1"),deal("2",{ type: "SELL",entry: "INOUT",volume: "2",commission: "-1",
      reversalAllocation: { closingCommission: "-1",openingCommission: "-1",closingFee: "0",openingFee: "0" } })]],
  ] as const)("requires review for %s without publishing partial reconstructed history", (code,facts) => {
    const result = reconstruct(facts);
    expect(result.episodes).toEqual([]);
    expect(result.issues[0].code).toBe(code);
  });
  it("a canceled later event suppresses even an earlier closed episode in the affected position", () => {
    expect(reconstruct([deal("1"),deal("2",{ type: "SELL",entry: "OUT",profit: "10" }),deal("3",{ type: "BUY_CANCELED" })]).episodes).toEqual([]);
  });
  it("conflicting source revisions are not resolved by which upload arrived last", () => {
    const first = deal("1"), corrected = deal("1",{ volume: "2" });
    const result = reconstruct([first,corrected]);
    expect(result.episodes).toEqual([]);
    expect(result.issues[0].code).toBe("CONFLICTING_SOURCE_REVISION");
  });
  it("does not combine an unsafe position with an independent safe one", () => {
    const result = reconstruct([deal("1",{ type: "SELL",entry: "OUT" }),deal("2",{ positionId: "200" })]);
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0].positionId).toBe("200");
    expect(result.issues).toHaveLength(1);
  });
  it("broker credit facilities and balance operations do not become trade profit", () => {
    const facts = [deal("1",{ type: "CREDIT",positionId: null,symbol: null,entry: null,volume: "0",profit: "500" }),
      deal("2",{ type: "BALANCE",positionId: null,symbol: null,entry: null,volume: "0",profit: "10000" })];
    expect(reconstruct(facts)).toEqual({ episodes: [],issues: [],cashMovements: facts });
  });
  it("rejects netting reversal events in a mapped hedging account", () => {
    expect(reconstruct([deal("1"),deal("2",{ type: "SELL",entry: "INOUT",volume: "2" })],2,"HEDGING").issues[0].code).toBe("INCONSISTENT_EXECUTION");
  });
  it.each([{ ticket: 123 },{ profit: 0.1 },{ volume: "NaN" },{ price: "1e-5" },{ occurredAt: "2026-10-01T10:00:00+03:00" },{ ticket: "18446744073709551616" }])
  ("rejects unsafe source boundary values: %j", fields => { expect(() => mt5DealSchema.parse({ ...deal("1"),...fields })).toThrow(); });
  it("never fabricates planned stops, risk or completed reviews", () => {
    expect(Object.keys(reconstruct([deal("1")]).episodes[0]).some(key => /plan|risk|review/i.test(key))).toBe(false);
  });
  it("central financial utility rejects negative cost/credit values instead of reversing their meaning", () => {
    expect(() => calculateNetPnl({ grossPnl: "10",commission: "-1",swap: "0",otherFees: "0",currencyPrecision: 2 })).toThrow(RangeError);
    expect(() => calculateNetPnl({ grossPnl: "10",commission: "0",swap: "0",otherFees: "0",tradingCredits: "-1",currencyPrecision: 2 })).toThrow(RangeError);
    expect(parseDecimal("0.1").plus("0.2").toString()).toBe("0.3");
  });
});
