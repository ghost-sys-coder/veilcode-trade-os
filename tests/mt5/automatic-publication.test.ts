import {describe,expect,it} from "vitest";
import {prepareAutomaticMt5Publication} from "@/domain/mt5/automatic-publication";
import {mt5StoredSourceSchema,type Mt5ConnectionView} from "@/domain/mt5/onboarding";
import {mt5ReviewRequestSchema} from "@/domain/mt5/review";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",instrument="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",manual="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const time="2026-10-01T12:00:00.000Z",identity=`${id}:100:1:BUY`;
const connection:Mt5ConnectionView={id,accountId:id,grantId:id,status:"ACTIVE",version:"1",attentionCode:null,onboardingApprovedAt:time,
  lastHeartbeatAt:time,lastSyncAt:time,captureCheckpoint:time,healthObservedAt:time,heartbeatStale:false,sourceFactCount:2,reviewCount:0,
  incompleteCollections:0,missingServerBatches:0,publishedTradeCount:0,identity:{server:"Demo",login:"1",terminalInstallationId:id,
    currencyCode:"USD",currencyPrecision:2,accountKind:"DEMO",positionMode:"NETTING"}};
const sources=["1","2"].map(ticket=>mt5StoredSourceSchema.parse({kind:"DEAL",sourceId:ticket,revisionId:ticket,observedAt:time,requiresReview:false,
  payload:{ticket,orderId:ticket,positionId:"100",symbol:"EURUSD",occurredAt:`2026-10-01T10:00:0${ticket}.000Z`,type:ticket==="1"?"BUY":"SELL",
    entry:ticket==="1"?"IN":"OUT",volume:"1",price:"1.1",profit:ticket==="1"?"0":"100",commission:ticket==="1"?"-2":"-3",swap:"0",fee:"0"}}));
const input={connection,sources,instruments:[{id:instrument,symbol:"EURUSD"}],existingTrades:[],startingBalance:"1000",ledgerBalance:"1000",
  snapshotToken:"a".repeat(64),ledgerToken:"b".repeat(64),publishedExecutions:[]};
const trade={id:manual,symbol:"EURUSD",direction:"BUY" as const,openedAt:"2026-10-01T09:00:00Z",closedAt:null,
  canonicalIdentity:null,closedNetPnl:null,reviewToken:"c".repeat(64)};
const distinct={canonicalIdentity:identity,tradeId:manual,tradeToken:trade.reviewToken,decision:"DISTINCT" as const,reason:"Verified separate positions",createdAt:time};

describe("unattended MT5 publication selection",()=>{
  it("publishes 95 final net PnL without inventing plans or asserting reconciliation",()=>{
    const proposal=prepareAutomaticMt5Publication(input,id)!;
    expect(proposal.episodes[0]).toMatchObject({finalNetPnl:"95.00",outcome:"WIN",commission:"5"});
    expect(proposal.episodes[0]).not.toHaveProperty("plannedRiskAmount");expect(proposal.reconciliationState).toBe("NOT_APPROVED");
  });
  it("does not manufacture another execution version for unchanged facts or JSON key ordering",()=>{
    const execution=prepareAutomaticMt5Publication(input,id)!.episodes[0];
    const reordered=Object.fromEntries(Object.entries(execution).reverse());
    expect(prepareAutomaticMt5Publication({...input,publishedExecutions:[{identity,execution:reordered}]},id)).toBeNull();
  });
  it("reconstructs changed accepted facts centrally, while unreviewed revisions remain held",()=>{
    const old=prepareAutomaticMt5Publication(input,id)!.episodes[0];
    const changed=input.sources.map(s=>s.sourceId==="2"?mt5StoredSourceSchema.parse({...s,revisionId:"3",payload:{...s.payload as object,profit:"120"}}):s);
    expect(prepareAutomaticMt5Publication({...input,sources:changed,publishedExecutions:[{identity,execution:old}]},id)?.episodes[0].finalNetPnl).toBe("115.00");
    expect(prepareAutomaticMt5Publication({...input,sources:changed.map(s=>({...s,requiresReview:true}))},id)).toBeNull();
  });
  it("holds unknown symbols, incomplete collections and ambiguous manual matches",()=>{
    expect(prepareAutomaticMt5Publication({...input,instruments:[]},id)).toBeNull();
    expect(prepareAutomaticMt5Publication({...input,connection:{...connection,incompleteCollections:1}},id)).toBeNull();
    expect(prepareAutomaticMt5Publication({...input,existingTrades:[trade]},id)).toBeNull();
  });
  it("accepts only a matching immutable distinct decision; manual edits invalidate it",()=>{
    expect(prepareAutomaticMt5Publication({...input,existingTrades:[trade],manualDecisions:[distinct]},id)?.episodes).toHaveLength(1);
    expect(prepareAutomaticMt5Publication({...input,existingTrades:[{...trade,reviewToken:"d".repeat(64)}],manualDecisions:[distinct]},id)).toBeNull();
  });
  it("withdrawing an erroneous distinct decision restores the review hold without deleting history",()=>{
    const decisions=[distinct,{...distinct,decision:"REOPEN" as const}];
    expect(prepareAutomaticMt5Publication({...input,existingTrades:[trade],manualDecisions:decisions},id)).toBeNull();
    expect(decisions).toHaveLength(2);
  });
  it("a positive partial exit on an OPEN trade does not create finalized net PnL or an outcome",()=>{
    const partial=input.sources.map(s=>s.sourceId==="2"?mt5StoredSourceSchema.parse({...s,payload:{...s.payload as object,volume:"0.5"}}):s);
    partial.push(mt5StoredSourceSchema.parse({kind:"POSITION",sourceId:"100",revisionId:"3",observedAt:time,requiresReview:false,
      payload:{ticket:"100",positionId:"100",symbol:"EURUSD",direction:"BUY",volume:"0.5",entryPrice:"1.1",
        currentStop:null,currentTarget:null,unrealizedPnl:"1",observedAt:time}}));
    const proposal=prepareAutomaticMt5Publication({...input,sources:partial},id)!;
    expect(proposal.episodes[0]).toMatchObject({status:"OPEN",finalNetPnl:null,outcome:null});
  });
  it("requires explicit boolean classification and rejects invented financial/owner fields",()=>{
    const base={connectionId:id,operationId:id,version:"1",snapshotToken:input.snapshotToken,ledgerToken:input.ledgerToken,
      reason:"Verified revised cash record",reviewKind:"CASH",sourceId:"50",sourceRevisionId:"3"};
    expect(mt5ReviewRequestSchema.safeParse(base).success).toBe(false);
    expect(mt5ReviewRequestSchema.safeParse({...base,isPerformanceNeutral:false}).success).toBe(true);
    expect(mt5ReviewRequestSchema.safeParse({...base,isPerformanceNeutral:true,userId:id,netPnl:"123"}).success).toBe(false);
  });
});
