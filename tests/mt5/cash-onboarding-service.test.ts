import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { classifyMt5Cash,approveMt5Onboarding } from "@/services/mt5/cash-onboarding";
const boundary=vi.hoisted(()=>({context:vi.fn(),cash:vi.fn(),onboarding:vi.fn(),snapshot:vi.fn(),prepareCash:vi.fn(),prepareOnboarding:vi.fn()}));
vi.mock("@/services/integrations/browser-context",()=>({getVerifiedBrowserContext:boundary.context}));
vi.mock("@/services/integrations/publication-database",()=>({mt5CashTransaction:boundary.cash,mt5OnboardingTransaction:boundary.onboarding}));
vi.mock("@/services/mt5/onboarding",()=>({getMt5OnboardingSnapshot:boundary.snapshot}));
vi.mock("@/domain/mt5/cash",async original=>({...await original<object>(),prepareMt5CashDecision:boundary.prepareCash}));
vi.mock("@/domain/mt5/onboarding-approval",async original=>({...await original<object>(),prepareMt5OnboardingApproval:boundary.prepareOnboarding}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",client={} as SupabaseClient<IntegrationDatabase>;
const common={connectionId:id,operationId:id,version:"1",snapshotToken:"a".repeat(64),ledgerToken:"b".repeat(64),reason:"Explicit captured evidence review"};
const cash={...common,sourceTicket:"100",sourceRevisionId:"1",disposition:"ADJUSTMENT",adjustmentType:"OTHER",isPerformanceNeutral:false,existingAdjustmentId:null};
const onboarding={...common,openingBaseline:"1000",availableHistoryConfirmed:true};
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");vi.stubEnv("TRADE_OS_MT5_ENABLED","true");
  boundary.context.mockResolvedValue({verified:true});
  boundary.cash.mockResolvedValue({connectionId:id,version:"2",sourceTicket:"100",adjustmentId:id});
  boundary.onboarding.mockResolvedValue({connectionId:id,version:"2",approvalId:id,reconciliationState:"APPROVED_SNAPSHOT"});
  boundary.snapshot.mockResolvedValue({connection:{version:"1"},snapshotToken:common.snapshotToken,ledgerToken:common.ledgerToken,sources:[],account:{currencyPrecision:20,startingBalance:"1000",ledgerBalance:"1000"}});
});
afterEach(()=>vi.unstubAllEnvs());
describe("MT5 cash/onboarding application adapters",()=>{
  it.each(["cash","onboarding"] as const)("looks up durable %s receipts before loading a changed snapshot",async(kind)=>{
    await (kind==="cash"?classifyMt5Cash(client,cash):approveMt5Onboarding(client,onboarding));
    expect(boundary.snapshot).not.toHaveBeenCalled();
    expect((kind==="cash"?boundary.cash:boundary.onboarding)).toHaveBeenCalledWith({verified:true},kind==="cash"?cash:onboarding);
  });
  it("calculates cash only from captured source strings and configured precision",async()=>{
    boundary.cash.mockResolvedValueOnce(null);boundary.prepareCash.mockReturnValue({amount:"-0.00000000000000000100",occurredAt:"2026-01-01T00:00:00.000Z"});
    await classifyMt5Cash(client,cash);
    expect(boundary.prepareCash).toHaveBeenCalledWith([],cash,20);
    expect(boundary.cash).toHaveBeenLastCalledWith({verified:true},cash,boundary.prepareCash.mock.results[0].value);
  });
  it("prepares onboarding from the authoritative ledger and source dataset",async()=>{
    boundary.onboarding.mockResolvedValueOnce(null);boundary.prepareOnboarding.mockReturnValue({episodes:[],bridge:{unexplainedDifference:"0"}});
    await approveMt5Onboarding(client,onboarding);
    expect(boundary.prepareOnboarding).toHaveBeenCalledWith(expect.objectContaining({startingBalance:"1000",ledgerBalance:"1000"}),onboarding);
    expect(boundary.onboarding).toHaveBeenLastCalledWith({verified:true},onboarding,boundary.prepareOnboarding.mock.results[0].value);
  });
  it("rejects changed cash snapshots before authoritative calculation",async()=>{
    boundary.cash.mockResolvedValueOnce(null);boundary.snapshot.mockResolvedValueOnce({connection:{version:"2"}});
    await expect(classifyMt5Cash(client,cash)).rejects.toThrow("REVIEW_REQUIRED");expect(boundary.prepareCash).not.toHaveBeenCalled();
  });
  it("rejects owner/finance injection and missing explicit confirmation before privileged work",async()=>{
    await expect(classifyMt5Cash(client,{...cash,amount:"999"})).rejects.toThrow();
    await expect(classifyMt5Cash(client,{...cash,ownerId:id})).rejects.toThrow();
    await expect(approveMt5Onboarding(client,{...onboarding,availableHistoryConfirmed:false})).rejects.toThrow();
    expect(boundary.context).not.toHaveBeenCalled();
  });
  it("requires enabled integration and verified browser, and rejects malformed receipts",async()=>{
    vi.stubEnv("TRADE_OS_MT5_ENABLED","false");await expect(classifyMt5Cash(client,cash)).rejects.toThrow("UNAVAILABLE");
    vi.stubEnv("TRADE_OS_MT5_ENABLED","true");boundary.context.mockRejectedValueOnce(new Error("Unverified browser"));
    await expect(approveMt5Onboarding(client,onboarding)).rejects.toThrow();expect(boundary.onboarding).not.toHaveBeenCalled();
    boundary.cash.mockResolvedValueOnce({connectionId:id,version:2});await expect(classifyMt5Cash(client,cash)).rejects.toThrow();
  });
});
