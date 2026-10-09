import {afterEach,describe,expect,it,vi} from "vitest";
import {mt5WorkflowRequestSchema,prepareMt5Workflow,mt5GrantListSchema} from "@/domain/mt5/workflow-commands";
import {listMt5Grants,writeMt5Workflow} from "@/services/application/integrations";
import type {ApplicationContext} from "@/services/application/transaction";
const {transaction,decode,publish,approve,cash}=vi.hoisted(()=>({transaction:vi.fn(),decode:vi.fn(),publish:vi.fn(),approve:vi.fn(),cash:vi.fn()}));
vi.mock("@/services/application/transaction",async original=>({...await original<typeof import("@/services/application/transaction")>(),applicationTransaction:transaction}));
vi.mock("@/domain/mt5/snapshot",()=>({decodeMt5Snapshot:decode}));
vi.mock("@/domain/mt5/publication",async original=>({...await original<typeof import("@/domain/mt5/publication")>(),prepareMt5Publication:publish}));
vi.mock("@/domain/mt5/onboarding-approval",async original=>({...await original<typeof import("@/domain/mt5/onboarding-approval")>(),prepareMt5OnboardingApproval:approve}));
vi.mock("@/domain/mt5/cash",async original=>({...await original<typeof import("@/domain/mt5/cash")>(),prepareMt5CashDecision:cash}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",operationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const base={connectionId:id,operationId,version:"1",snapshotToken:"a".repeat(64),ledgerToken:"b".repeat(64),reason:"Verify exact deterministic evidence"};
const identity={server:"Broker-Demo",login:"9007199254740993",terminalInstallationId:id,currencyCode:"USD",currencyPrecision:2,accountKind:"DEMO",positionMode:"HEDGING"};
const context={actor:{purpose:"MCP"}} as unknown as ApplicationContext;
const commands={
  REGISTER:{grantId:id,operationId,identity},CONTROL:{connectionId:id,operationId,version:"1",action:"PAUSE",reason:base.reason},
  SYMBOL_MAPPING:{connectionId:id,operationId,version:"1",snapshotToken:base.snapshotToken,brokerSymbol:"EURUSDm",instrumentId:id,reason:base.reason},
  CASH:{...base,sourceTicket:"99",sourceRevisionId:"1",disposition:"BASELINE_FUNDING",adjustmentType:null,isPerformanceNeutral:null,existingAdjustmentId:null},
  ONBOARDING:{...base,openingBaseline:"1000",availableHistoryConfirmed:true},
  PUBLICATION:{...base,openingBaseline:"1000",episodeIdentities:["episode-b","episode-a","episode-a"]},POLICY:{...base,enabled:true},
};
const results={REGISTER:{connectionId:id,version:"2",status:"ONBOARDING"},CONTROL:{connectionId:id,version:"2",status:"PAUSED"},
  SYMBOL_MAPPING:{connectionId:id,version:"2",brokerSymbol:"EURUSDm",instrumentId:id,mappingVersion:"1"},
  CASH:{connectionId:id,version:"2",sourceTicket:"99",adjustmentId:null},ONBOARDING:{connectionId:id,version:"2",approvalId:id,reconciliationState:"APPROVED_SNAPSHOT"},
  PUBLICATION:{connectionId:id,version:"2",tradeIds:[id],importBatchId:id,reconciliationState:"NOT_APPROVED"},POLICY:{connectionId:id,version:"2",reviewKind:"POLICY"}};
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
describe("explicit MT5 workflow schemas",()=>{
  it.each(Object.entries(commands))("validates %s and rejects invented ownership/financial facts",(kind,command)=>{
    expect(mt5WorkflowRequestSchema.safeParse({kind,command}).success).toBe(true);
    expect(mt5WorkflowRequestSchema.safeParse({kind,command:{...command,ownerId:id}}).success).toBe(false);
    expect(mt5WorkflowRequestSchema.safeParse({kind,command:{...command,netPnl:"999"}}).success).toBe(false);
  });
  it("preserves string IDs and prohibits live mapping",()=>{
    const request=mt5WorkflowRequestSchema.parse({kind:"REGISTER",command:commands.REGISTER});
    expect(request.command).toMatchObject({identity:{login:"9007199254740993"}});
    expect(mt5WorkflowRequestSchema.safeParse({kind:"REGISTER",command:{...commands.REGISTER,identity:{...identity,accountKind:"LIVE"}}}).success).toBe(false);
    expect(mt5WorkflowRequestSchema.safeParse({kind:"REGISTER",command:{...commands.REGISTER,identity:{...identity,login:123}}}).success).toBe(false);
  });
  it.each(["CONTROL","SYMBOL_MAPPING","CASH","ONBOARDING","PUBLICATION","POLICY"] as const)("requires a meaningful %s reason",kind=>{
    expect(mt5WorkflowRequestSchema.safeParse({kind,command:{...commands[kind],reason:"short"}}).success).toBe(false);
  });
  it("requires explicit complete-history confirmation and boolean policy",()=>{
    expect(mt5WorkflowRequestSchema.safeParse({kind:"ONBOARDING",command:{...commands.ONBOARDING,availableHistoryConfirmed:false}}).success).toBe(false);
    expect(mt5WorkflowRequestSchema.safeParse({kind:"POLICY",command:{...commands.POLICY,enabled:"true"}}).success).toBe(false);
    expect(mt5WorkflowRequestSchema.safeParse({kind:"POLICY",command:{...commands.POLICY,reviewKind:"LINK"}}).success).toBe(false);
  });
  it("deduplicates selected identities deterministically",()=>expect(mt5WorkflowRequestSchema.parse({kind:"PUBLICATION",command:commands.PUBLICATION}).command).toMatchObject({episodeIdentities:["episode-a","episode-b"]}));
  it("bounds grant discovery and rejects grant creation or owner overrides",()=>{
    expect(mt5GrantListSchema.parse({})).toEqual({limit:50});
    for(const input of [{limit:101},{limit:0},{ownerId:id},{clientId:id},{create:true}])expect(mt5GrantListSchema.safeParse(input).success).toBe(false);
  });
});
describe("verified workflow services",()=>{
  it("uses fixed private reads with the verified context",async()=>{
    transaction.mockResolvedValue({records:[],nextCursor:null});expect(await listMt5Grants(context,{})).toEqual({records:[],nextCursor:null});
    expect(transaction).toHaveBeenCalledWith(context,"MT5_GRANTS_READ",{limit:50});
  });
  it.each(Object.entries(commands))("passes verified %s command to the atomic preparation/writer",async(kind,command)=>{
    vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");vi.stubEnv("TRADE_OS_MT5_ENABLED","true");
    transaction.mockResolvedValue(results[kind as keyof typeof results]);
    await writeMt5Workflow(context,kind as keyof typeof commands,command);
    expect(transaction).toHaveBeenCalledWith(context,"MT5_WORKFLOW_WRITE",expect.objectContaining({kind}),expect.any(Function));
  });
  it("does not write when MT5 is disabled",async()=>{
    vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");vi.stubEnv("TRADE_OS_MT5_ENABLED","false");
    await expect(writeMt5Workflow(context,"CONTROL",commands.CONTROL)).rejects.toMatchObject({code:"ACCESS_DENIED"});expect(transaction).not.toHaveBeenCalled();
  });
});
describe("central preparation only",()=>{
  it.each(["REGISTER","CONTROL","SYMBOL_MAPPING","POLICY"] as const)("does not invent calculations for %s",kind=>{
    expect(prepareMt5Workflow(mt5WorkflowRequestSchema.parse({kind,command:commands[kind]}),{})).toEqual({});expect(decode).not.toHaveBeenCalled();
  });
  it.each(["CASH","PUBLICATION","ONBOARDING"] as const)("uses the original %s domain algorithm with full decoded evidence",kind=>{
    const snapshot={account:{startingBalance:"1000.00",ledgerBalance:"1000.00",currencyPrecision:2},sources:["all validated source facts"],instruments:["all instruments"]};
    decode.mockReturnValue(snapshot);cash.mockReturnValue({amount:"1000.00"});publish.mockReturnValue({episodes:["canonical"]});approve.mockReturnValue({bridge:{unexplainedDifference:"0.00"}});
    const request=mt5WorkflowRequestSchema.parse({kind,command:commands[kind]});prepareMt5Workflow(request,{raw:"entire snapshot"});
    expect(decode).toHaveBeenCalledWith({raw:"entire snapshot"});
    if(kind==="CASH")expect(cash).toHaveBeenCalledWith(snapshot.sources,request.command,2);
    else expect(kind==="PUBLICATION"?publish:approve).toHaveBeenCalledWith({...snapshot,startingBalance:"1000.00",ledgerBalance:"1000.00"},request.command);
  });
  it("does not fabricate a proposal on domain rejection",()=>{
    decode.mockReturnValue({account:{startingBalance:"1000",ledgerBalance:"1000"}});publish.mockImplementation(()=>{throw new Error("unsupported source");});
    expect(()=>prepareMt5Workflow(mt5WorkflowRequestSchema.parse({kind:"PUBLICATION",command:commands.PUBLICATION}),{})).toThrow(RangeError);
  });
});
