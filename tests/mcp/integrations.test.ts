import {afterEach,describe,expect,it,vi} from "vitest";
import {mt5ConnectionsSchema,mt5GetSchema,mt5SourcesSchema,importListSchema,importRowsSchema} from "@/domain/integrations/commands";
import {mt5ReviewRequestSchema} from "@/domain/mt5/review";
import {decodeMt5Snapshot} from "@/domain/mt5/snapshot";
import {prepareMt5Review} from "@/domain/mt5/prepare-review";
import {listMt5,getMt5,listMt5Sources,listMt5Matches,listImports,getImport,listImportRows,previewMt5,reviewMt5} from "@/services/application/integrations";
import type {ApplicationContext} from "@/services/application/transaction";
const {transaction}=vi.hoisted(()=>({transaction:vi.fn()}));
vi.mock("@/services/application/transaction",async original=>({...await original<typeof import("@/services/application/transaction")>(),applicationTransaction:transaction}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",time="2026-10-01T12:00:00Z";
const context={actor:{purpose:"MCP"}} as unknown as ApplicationContext;
function fixture() {
  const identity={server:"Broker-Demo",login:"9007199254740993",terminalInstallationId:id,currencyCode:"USD",currencyPrecision:2,accountKind:"DEMO",positionMode:"HEDGING"};
  const events=["100","200"].flatMap((position,index)=>[0,1].map(exit=>({kind:"DEAL",sourceId:String(index*2+exit+1),revisionId:String(index*2+exit+1),observedAt:time,requiresReview:false,
    payload:{ticket:String(index*2+exit+1),positionId:position,orderId:String(index*2+exit+1),symbol:"EURUSD",type:exit?"SELL":"BUY",entry:exit?"OUT":"IN",
      volume:"1",price:exit?"1.2":"1.1",profit:exit?"100":"0",commission:exit?"-3":"-2",swap:"0",fee:"0",occurredAt:`2026-10-01T10:00:0${index*2+exit+1}.000Z`}})));
  return {connection:{id,accountId:id,grantId:id,identity,status:"PAUSED",version:"1",attentionCode:null,onboardingApprovedAt:null,
    lastHeartbeatAt:time,lastSyncAt:time,captureCheckpoint:time,healthObservedAt:time,heartbeatStale:false,sourceFactCount:4,reviewCount:0,incompleteCollections:0,missingServerBatches:0,publishedTradeCount:0},
    page:{connectionId:id,identity,version:"1",snapshotToken:"a".repeat(64),ledgerToken:"b".repeat(64),captureCheckpoint:time,
      account:{name:"Demo",currencyCode:"USD",currencyPrecision:2,startingBalance:"1000",ledgerBalance:"1000"},events,sourceFactCount:4,incompleteCollections:0,tradeCount:0,trades:[]},
    instruments:[{id:other,symbol:"EURUSD",display_name:"Euro / US Dollar",user_id:null}]};
}
const base={connectionId:id,operationId:other,version:"1",snapshotToken:"a".repeat(64),ledgerToken:"b".repeat(64),reason:"Verify corrected source evidence"};
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
describe("integration MCP contracts",()=>{
  it.each([{ownerId:id},{user_id:id},{limit:101},{limit:0},{limit:"50"},{afterId:"invalid"}])("rejects caller ownership and invalid paging %j",input=>expect(mt5ConnectionsSchema.safeParse(input).success).toBe(false));
  it("bounds defaults and keeps source identifiers as strings",()=>{
    expect(mt5ConnectionsSchema.parse({})).toEqual({limit:50});expect(importListSchema.parse({accountId:id})).toEqual({limit:50,accountId:id});
    expect(mt5SourcesSchema.parse({connectionId:id,sourceId:"9007199254740993",afterRevisionId:"9007199254740994"}).sourceId).toBe("9007199254740993");
    expect(mt5SourcesSchema.safeParse({connectionId:id,sourceId:9007199254740993}).success).toBe(false);
    expect(mt5GetSchema.safeParse({connectionId:id,grantId:id}).success).toBe(false);expect(importRowsSchema.safeParse({batchId:id,ownerId:id}).success).toBe(false);
  });
  it.each([{reason:""},{reason:"Short"},{sourceRevisionId:1},{netPnl:"999"},{actorUserId:id},{reviewKind:"POLICY",enabled:true}])("does not accept casual edits, finance or policy changes %j",change=>{
    expect(mt5ReviewRequestSchema.safeParse({...base,reviewKind:"SOURCE",sourceKind:"DEAL",sourceId:"1",sourceRevisionId:"1",...change}).success).toBe(false);
  });
  it("rejects incomplete snapshots and currency mismatches",()=>{
    const data=fixture();expect(()=>decodeMt5Snapshot({...data,page:{...data.page,events:[]}})).toThrow();
    expect(()=>decodeMt5Snapshot({...data,page:{...data.page,account:{...data.page.account,currencyPrecision:0}}})).toThrow();
    expect(()=>decodeMt5Snapshot({...data,page:{...data.page,identity:{...data.page.identity,login:"12345"}}})).toThrow();
    expect(decodeMt5Snapshot(data).connection.identity.login).toBe("9007199254740993");
  });
});
describe("verified application adapters",()=>{
  it("pages current match tokens and historical DISTINCT decisions without hiding REOPEN candidates",async()=>{
    const data=fixture(),canonicalIdentity=`${id}:100:1:BUY`;
    const trades=[other,"cccccccc-cccc-4ccc-8ccc-cccccccccccc"].map(id=>({id,symbol:"EURUSD",direction:"BUY",openedAt:"2026-10-01T10:00:01.000Z",closedAt:null,canonicalIdentity:null,closedNetPnl:null,reviewToken:"c".repeat(64)}));
    const decision={canonicalIdentity,tradeId:other,tradeToken:"c".repeat(64),decision:"DISTINCT",reason:"Verified a separate position",createdAt:time};
    transaction.mockResolvedValue({...data,page:{...data.page,trades,tradeCount:2,manualDecisions:[decision],manualDecisionCount:1}});
    const first=await listMt5Matches(context,{connectionId:id,canonicalIdentity,limit:1});
    expect(first.records[0]).toMatchObject({id:other,reviewToken:"c".repeat(64),decision});expect(first.nextCursor).toBe(other);
    const second=await listMt5Matches(context,{connectionId:id,canonicalIdentity,afterId:first.nextCursor!,limit:1});
    expect(second.records[0].id).toBe(trades[1].id);expect(second.nextCursor).toBeNull();
    await expect(listMt5Matches(context,{connectionId:id,canonicalIdentity:"unknown"})).rejects.toMatchObject({code:"NOT_FOUND"});
  });
  it("uses only fixed reads and passes the verified context unchanged",async()=>{
    const data=fixture();transaction.mockResolvedValueOnce({records:[data.connection],nextCursor:null}).mockResolvedValueOnce(data.connection);
    expect((await listMt5(context,{})).records).toHaveLength(1);expect((await getMt5(context,{connectionId:id})).id).toBe(id);
    expect(transaction).toHaveBeenNthCalledWith(1,context,"INTEGRATION_READ",{action:"MT5_LIST",limit:50});
    transaction.mockResolvedValue({records:[],nextCursor:null});
    await listMt5Sources(context,{connectionId:id});await listImports(context,{});await listImportRows(context,{batchId:id});
    transaction.mockResolvedValue({id});await getImport(context,{batchId:id});
    expect(transaction.mock.calls.map(call=>call[2].action)).toEqual(["MT5_LIST","MT5_GET","MT5_SOURCES","IMPORT_LIST","IMPORT_ROWS","IMPORT_GET"]);
  });
  it("calculates the entire bridge before paging, with no early profit or duplication",async()=>{
    transaction.mockImplementation(async()=>fixture());
    const first=await previewMt5(context,{connectionId:id,limit:1});expect(first.records).toHaveLength(1);expect(first.totalEpisodes).toBe(2);
    expect(first.summary.bridge).toMatchObject({ledgerBalance:"1000.00",proposedClosedPnlChange:"190.00"});
    expect(first.records[0].episode).toMatchObject({finalNetPnl:"95.00",outcome:"WIN"});
    const second=await previewMt5(context,{connectionId:id,limit:1,cursor:first.nextCursor});
    expect(second.records).toHaveLength(1);expect(second.records[0].episode.canonicalIdentity).not.toBe(first.records[0].episode.canonicalIdentity);
    expect(second.summary.bridge).toEqual(first.summary.bridge);expect(second.nextCursor).toBeNull();
  });
  it("rejects changed evidence and malformed/cross-connection cursors",async()=>{
    transaction.mockImplementation(async()=>fixture());const page=await previewMt5(context,{connectionId:id,limit:1});
    await expect(previewMt5(context,{connectionId:id,cursor:"bad"})).rejects.toMatchObject({code:"INVALID_REFERENCE"});
    const changed=fixture();changed.page.ledgerToken="c".repeat(64);transaction.mockResolvedValue(changed);
    await expect(previewMt5(context,{connectionId:id,cursor:page.nextCursor})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
    transaction.mockImplementation(async()=>{const data=fixture();data.connection.id=other;data.page.connectionId=other;return data;});
    await expect(previewMt5(context,{connectionId:other,cursor:page.nextCursor})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
  });
  it("does not write while MT5 is disabled",async()=>{
    vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");vi.stubEnv("TRADE_OS_MT5_ENABLED","false");
    await expect(reviewMt5(context,{})).rejects.toMatchObject({code:"ACCESS_DENIED"});expect(transaction).not.toHaveBeenCalled();
  });
  it("prepares a source decision centrally and returns the durable writer result",async()=>{
    vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");vi.stubEnv("TRADE_OS_MT5_ENABLED","true");
    const data=fixture();data.page.events[0].requiresReview=true;
    const request={...base,reviewKind:"SOURCE",sourceKind:"DEAL",sourceId:"1",sourceRevisionId:"1"};
    transaction.mockImplementation(async(_context,_action,_request,prepare)=>{expect(prepare(data)).toEqual({});return {connectionId:id,version:"2",reviewKind:"SOURCE"};});
    expect(await reviewMt5(context,request)).toMatchObject({version:"2"});
  });
});
describe("single shared review preparer",()=>{
  it("CASH revisions require prior classification and normalize centrally instead of guessing cash meaning",()=>{
    const snapshot=decodeMt5Snapshot(fixture());
    const event={kind:"DEAL" as const,sourceId:"99",observedAt:"2026-10-01T12:00:00.000Z",payload:{ticket:"99",positionId:null,orderId:null,symbol:null,type:"BALANCE",entry:null,
      volume:"0",price:"0",profit:"1.005",commission:"-0.1",swap:"0",fee:"0",occurredAt:"2026-10-01T12:00:00.000Z"}};
    snapshot.sources.push({kind:"DEAL",sourceId:"99",revisionId:"9",observedAt:event.observedAt,requiresReview:false,payload:event.payload,event});
    const request=mt5ReviewRequestSchema.parse({...base,reviewKind:"CASH",sourceId:"99",sourceRevisionId:"9",isPerformanceNeutral:true});
    expect(()=>prepareMt5Review(snapshot,request)).toThrow();
    snapshot.cashDecisions.push({sourceTicket:"99",sourceRevisionId:"8",disposition:"ADJUSTMENT",amount:"0.50",adjustmentId:other,reason:"Original explicit funding classification",createdAt:time});
    expect(prepareMt5Review(snapshot,request)).toEqual({amount:"0.91"});
    snapshot.sources.at(-1)!.requiresReview=true;expect(()=>prepareMt5Review(snapshot,request)).toThrow();
  });
  it("REOPEN requires an existing DISTINCT decision, not a fabricated withdrawal",()=>{
    const snapshot=decodeMt5Snapshot(fixture()),canonicalIdentity=`${id}:100:1:BUY`;
    const request=mt5ReviewRequestSchema.parse({...base,reviewKind:"REOPEN",canonicalIdentity,tradeId:other,tradeToken:"c".repeat(64)});
    expect(()=>prepareMt5Review(snapshot,request)).toThrow();
    snapshot.manualDecisions.push({canonicalIdentity,tradeId:other,tradeToken:"c".repeat(64),decision:"DISTINCT",reason:"Previously verified a separate position",createdAt:time});
    expect(prepareMt5Review(snapshot,request)).toMatchObject({episodes:[{canonicalIdentity}]});
  });
  it("requires actual pending source evidence and exact tokens",()=>{
    const data=fixture(),request=mt5ReviewRequestSchema.parse({...base,reviewKind:"SOURCE",sourceKind:"DEAL",sourceId:"1",sourceRevisionId:"1"});
    expect(()=>prepareMt5Review(decodeMt5Snapshot(data),request)).toThrow();data.page.events[0].requiresReview=true;
    expect(prepareMt5Review(decodeMt5Snapshot(data),request)).toEqual({});expect(()=>prepareMt5Review(decodeMt5Snapshot(data),{...request,version:"2"})).toThrow();
  });
  it("LINK reuses verified financial reconstruction and removes only the exact manual overlap",()=>{
    const data=fixture(),snapshot=decodeMt5Snapshot(data),trade={id:other,symbol:"EURUSD",direction:"BUY" as const,openedAt:"2026-10-01T10:00:01.000Z",closedAt:null,canonicalIdentity:null,closedNetPnl:null,reviewToken:"c".repeat(64)};
    snapshot.existingTrades=[trade];const request=mt5ReviewRequestSchema.parse({...base,reviewKind:"LINK",canonicalIdentity:`${id}:100:1:BUY`,tradeId:other,tradeToken:trade.reviewToken});
    expect(prepareMt5Review(snapshot,request)).toMatchObject({episodes:[{linkTradeId:other,finalNetPnl:"95.00",commission:"5",outcome:"WIN"}]});
    expect(()=>prepareMt5Review({...snapshot,existingTrades:[trade,{...trade,id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}]},request)).toThrow();
  });
});
