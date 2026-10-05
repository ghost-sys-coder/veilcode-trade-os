import { describe,expect,it } from "vitest";
import { mt5PublicationRequestSchema,prepareMt5Publication } from "@/domain/mt5/publication";
import { mt5StoredSourceSchema,type Mt5ConnectionView } from "@/domain/mt5/onboarding";
import { publicationDatabaseConfig } from "@/services/integrations/publication-database-config";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", instrumentId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const checkpoint="2026-10-01T12:00:00.000Z";
const connection: Mt5ConnectionView={ id,accountId:id,grantId:id,status:"ONBOARDING",version:"1",attentionCode:null,
  onboardingApprovedAt:null,lastHeartbeatAt:checkpoint,lastSyncAt:checkpoint,captureCheckpoint:checkpoint,
  healthObservedAt:checkpoint,heartbeatStale:false,sourceFactCount:2,reviewCount:0,incompleteCollections:0,missingServerBatches:0,publishedTradeCount:0,
  identity:{server:"Broker-Demo",login:"123",terminalInstallationId:id,currencyCode:"USD",currencyPrecision:2,accountKind:"DEMO",positionMode:"NETTING"} };
const sources=["1","2"].map(ticket=>mt5StoredSourceSchema.parse({ kind:"DEAL",sourceId:ticket,revisionId:ticket,observedAt:checkpoint,requiresReview:false,
  payload:{ ticket,orderId:ticket,positionId:"100",symbol:"EURUSD",occurredAt:`2026-10-01T10:00:0${ticket}.000Z`,
    type:ticket==="1"?"BUY":"SELL",entry:ticket==="1"?"IN":"OUT",volume:"1",price:"1.1",profit:ticket==="1"?"0":"100",
    commission:ticket==="1"?"-2":"-3",swap:"0",fee:"0" } }));
const request=mt5PublicationRequestSchema.parse({ connectionId:id,operationId:id,version:"1",snapshotToken:"a".repeat(64),ledgerToken:"b".repeat(64),
  openingBaseline:"1000",reason:"Approve captured execution history",episodeIdentities:[`${id}:100:1:BUY`] });
const snapshot={ connection,sources,instruments:[{id:instrumentId,symbol:"EURUSD"}],existingTrades:[],startingBalance:"1000",ledgerBalance:"1000",
  snapshotToken:request.snapshotToken,ledgerToken:request.ledgerToken };

describe("source-authoritative MT5 publication preparation",()=>{
  it("calculates final 95 PnL from broker facts, retaining revision attribution and no fabricated plan",()=>{
    const result=prepareMt5Publication(snapshot,request);
    expect(result.episodes[0]).toMatchObject({finalNetPnl:"95.00",outcome:"WIN",commission:"5",instrumentId,
      sourceRevisions:[{sourceId:"1",revisionId:"1"},{sourceId:"2",revisionId:"2"}]});
    expect(result.episodes[0]).not.toHaveProperty("plannedRiskAmount");
    expect(result.reconciliationState).toBe("NOT_APPROVED");
  });
  it.each([{version:"2"},{snapshotToken:"c".repeat(64)},{ledgerToken:"c".repeat(64)},{openingBaseline:"999"},
    {episodeIdentities:[`${id}:100:9:BUY`]}])("rejects changed approval or unknown selection %j",change=>{
    expect(()=>prepareMt5Publication(snapshot,{...request,...change})).toThrow("REVIEW_REQUIRED");
  });
  it("can manually approve a frozen PAUSED connection without resuming collection",()=>{
    const paused={...connection,status:"PAUSED" as const};
    expect(prepareMt5Publication({...snapshot,connection:paused},request).episodes).toHaveLength(1);
    expect(paused.status).toBe("PAUSED");
  });
  it.each(["ATTENTION"] as const)("cannot publish a %s connection",status=>{
    expect(()=>prepareMt5Publication({...snapshot,connection:{...connection,status}},request)).toThrow();
  });
  it("rejects incomplete capture and source revisions awaiting review",()=>{
    expect(()=>prepareMt5Publication({...snapshot,connection:{...connection,incompleteCollections:1}},request)).toThrow();
    expect(()=>prepareMt5Publication({...snapshot,sources:sources.map(s=>({...s,requiresReview:true}))},request)).toThrow();
  });
  it("holds overlapping manual trades without silent matching or duplicate publication",()=>{
    expect(()=>prepareMt5Publication({...snapshot,existingTrades:[{id,symbol:"EURUSD",direction:"BUY",openedAt:checkpoint.replace("12:","09:"),
      closedAt:null,canonicalIdentity:null,closedNetPnl:null}]},request)).toThrow();
  });
  it("does not mistake a known own-connection directional episode for a manual match",()=>{
    expect(prepareMt5Publication({...snapshot,existingTrades:[{id,symbol:"EURUSD",direction:"BUY",openedAt:"2026-10-01T09:00:00Z",
      closedAt:"2026-10-01T10:00:01.000Z",canonicalIdentity:`${id}:100:0:BUY`,closedNetPnl:"1"}]},request).episodes).toHaveLength(1);
  });
  it("rejects submitted finance and binary monetary values at the browser boundary",()=>{
    expect(mt5PublicationRequestSchema.safeParse({...request,netPnl:"9999"}).success).toBe(false);
    expect(mt5PublicationRequestSchema.safeParse({...request,openingBaseline:1000}).success).toBe(false);
  });
  it("canonicalizes duplicate selections for equivalent operation retries",()=>{
    expect(mt5PublicationRequestSchema.parse({...request,episodeIdentities:[...request.episodeIdentities,...request.episodeIdentities]})).toEqual(request);
  });
});

describe("private publication database configuration",()=>{
  const local="postgresql://postgres:fixture@127.0.0.1:54322/postgres";
  it("uses only the explicit local database in local verification",()=>{
    expect(publicationDatabaseConfig({TRADE_OS_LOCAL_TEST_APP:"true",TRADE_OS_LOCAL_DATABASE_URL:local,SUPABASE_DIRECT_CONNECTION_URL:"invalid"}).ssl).toBe(false);
  });
  it("never falls back from a missing local database to the hosted credential",()=>{
    expect(()=>publicationDatabaseConfig({TRADE_OS_LOCAL_TEST_APP:"true",SUPABASE_DIRECT_CONNECTION_URL:local})).toThrow("UNAVAILABLE");
  });
  it.each(["postgresql://postgres:fixture@remote.example:54322/postgres",local+"?host=remote.example",local+"?sslmode=disable",
    local.replace("54322","5432"),local.replace(/postgres$/,"production")])("rejects unsafe local routing %s",value=>{
    expect(()=>publicationDatabaseConfig({TRADE_OS_LOCAL_TEST_APP:"true",TRADE_OS_LOCAL_DATABASE_URL:value})).toThrow();
  });
  it("requires verified TLS in remote mode",()=>{
    expect(publicationDatabaseConfig({SUPABASE_DIRECT_CONNECTION_URL:"postgresql://postgres:fixture@db.example:5432/postgres"}).ssl).toEqual({rejectUnauthorized:true});
    expect(()=>publicationDatabaseConfig({SUPABASE_DIRECT_CONNECTION_URL:local})).toThrow();
  });
});
