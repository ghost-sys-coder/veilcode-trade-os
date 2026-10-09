import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import type pg from "pg";
import type {Client} from "@modelcontextprotocol/client";

/** Disposable loopback fixture, called only after the parent validates DB/API URLs. */
export async function verifyIntegrationAccess(database:pg.Client,client:Client,userId:string,instrumentId:string,
  passed:(message:string)=>void,setStage:(message:string)=>void) {
  const collector=randomUUID(),collectorGrant=randomUUID();let connectionId:string=randomUUID();
  const previous=(await database.query("select * from private.integration_resources where purpose='MT5'")).rows[0];
  async function call(name:string,args:Record<string,unknown>={}) {
    setStage(`MCP integration access: ${name}`);
    const result=await client.callTool({name,arguments:args});
    assert(!result.isError,`Integration fixture tool failed: ${name}`);
    assert(result.structuredContent);return result.structuredContent as Record<string,unknown>;
  }
  const preview=()=>call("tradeos_mt5_preview",{connectionId,limit:1});
  async function decision(extra:Record<string,unknown>={}) {
    const current=await preview(),connection=current.connection as Record<string,unknown>;
    return {connectionId,operationId:randomUUID(),version:connection.version,snapshotToken:current.snapshotToken,
      ledgerToken:current.ledgerToken,reason:"Verify exact local broker evidence",...extra};
  }
  async function review(kind:string,extra:Record<string,unknown>) {return {...await decision(),reviewKind:kind,...extra};}
  try {
    setStage("MCP MT5 fixture provisioning");
    const account=(await call("tradeos_accounts_create",{operationId:randomUUID(),values:{name:"MCP broker review fixture",
      account_type:"DEMO",broker_name:"Fixture broker",platform:"MT5",currency_code:"USD",currency_precision:2,
      starting_balance:"1000",started_at:"2026-10-01",status:"ACTIVE",leverage:null,notes:null}})).record as Record<string,unknown>;
    const trade=(await call("tradeos_trades_create",{operationId:randomUUID(),values:{account_id:account.id,instrument_id:instrumentId,
      direction:"BUY",status:"OPEN",opened_at:"2026-10-01T10:00:00.000Z",actual_entry:"1.1",actual_lot_size:"1",
      thesis:"Original manual decision remains evidence",planned_risk_amount:"10"}})).record as Record<string,unknown>;
    await database.query("insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method) values($1,'manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none')",[collector]);
    await database.query("insert into private.integration_resources(purpose,resource,enabled) values('MT5','http://127.0.0.1:3100/api/integrations/v1',true) on conflict(purpose) do update set resource=excluded.resource,enabled=true");
    await database.query("insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status) values($1,$2,$3,'MT5',$4,'http://127.0.0.1:3100/api/integrations/v1','local-mcp-fixture','ACTIVE')",[collectorGrant,userId,collector,account.id]);
    const grants=await call("tradeos_mt5_grants",{accountId:account.id,limit:1});assert.equal((grants.records as Array<Record<string,unknown>>)[0].id,collectorGrant);
    const mapRequest={grantId:collectorGrant,operationId:randomUUID(),identity:{server:"Broker-Demo",login:"9007199254740993",terminalInstallationId:randomUUID(),currencyCode:"USD",currencyPrecision:2,accountKind:"DEMO",positionMode:"HEDGING"}};
    const mapped=await call("tradeos_mt5_map_account",mapRequest);connectionId=mapped.connectionId as string;
    assert.deepEqual(await call("tradeos_mt5_map_account",mapRequest),mapped);
    await call("tradeos_mt5_control",{connectionId,operationId:randomUUID(),version:mapped.version,action:"PAUSE",reason:"Keep disposable collector paused"});
    await database.query("update private.mt5_connections set capture_checkpoint='2026-10-03T00:00:00Z' where id=$1",[connectionId]);
    passed("MCP discovers already-approved grants, maps exact demo identity once and pauses without starting a worker");
    const observedAt="2026-10-03T00:00:00.000Z";
    async function source(kind:string,sourceId:string,payload:object,current:boolean,held=false) {
      const result=await database.query("insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id) values($1,$2,$3,$4,$5,$6,1,$7) returning id::text",[connectionId,kind,sourceId,observedAt,payload,createHash("sha256").update(JSON.stringify(payload)).digest("hex"),randomUUID()]);
      const revision=result.rows[0].id;
      if(current)await database.query("insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at,requires_review) values($1,$2,$3,$4,$5,$6) on conflict(connection_id,kind,source_id) do update set current_revision_id=excluded.current_revision_id,last_observed_at=excluded.last_observed_at,requires_review=excluded.requires_review",[connectionId,kind,sourceId,revision,observedAt,held]);
      return revision as string;
    }
    const deal={positionId:"100",symbol:"EURUSDm",volume:"1",swap:"0",fee:"0"};
    await source("DEAL","10",{...deal,ticket:"10",orderId:"10",type:"BUY",entry:"IN",price:"1.1",profit:"0",commission:"-2",occurredAt:"2026-10-01T10:00:00.000Z"},true);
    const exit={...deal,ticket:"11",orderId:"11",type:"SELL",entry:"OUT",price:"1.2",profit:"100",commission:"-3",occurredAt:"2026-10-02T10:00:00.000Z"};
    await source("DEAL","11",{...exit,price:"1.19"},false);
    const exitRevision=await source("DEAL","11",exit,true,true);
    await source("ACCOUNT","ACCOUNT",{balance:"1095",equity:"1095",unrealizedPnl:"0",observedAt},true);
    setStage("MCP MT5 read/history isolation");
    const listed=await call("tradeos_mt5_list",{accountId:account.id,limit:1});
    assert.equal((listed.records as Array<Record<string,unknown>>)[0].id,connectionId);
    const connection=await call("tradeos_mt5_get",{connectionId});assert.equal((connection.identity as Record<string,unknown>).login,"9007199254740993");
    assert.equal(connection.status,"PAUSED");assert.equal(connection.reviewCount,1);
    const history=await call("tradeos_mt5_sources",{connectionId,kind:"DEAL",sourceId:"11",limit:1});
    const older=(history.records as Array<Record<string,unknown>>)[0];assert.equal(older.isCurrent,false);assert.equal((older.payload as Record<string,unknown>).price,"1.19");
    const latest=await call("tradeos_mt5_sources",{connectionId,kind:"DEAL",sourceId:"11",limit:1,afterRevisionId:history.nextCursor});
    const current=(latest.records as Array<Record<string,unknown>>)[0];assert.equal(current.isCurrent,true);assert.equal(current.revisionId,exitRevision);assert.equal(current.requiresReview,true);
    passed("MCP reads paused demo health and pages immutable broker revisions with exact string identities");
    const {ledgerToken:unusedLedger,...symbolDecision}=await decision();void unusedLedger;
    await call("tradeos_mt5_symbol_map",{...symbolDecision,brokerSymbol:"EURUSDm",instrumentId});
    passed("MCP maps an observed broker alias explicitly before reconstruction/publication");
    setStage("MCP SOURCE review/retry");
    const sourceReview=await review("SOURCE",{sourceKind:"DEAL",sourceId:"11",sourceRevisionId:exitRevision});
    const reviewed=await call("tradeos_mt5_review",sourceReview);assert.equal(reviewed.reviewKind,"SOURCE");
    assert.deepEqual(await call("tradeos_mt5_review",sourceReview),reviewed);
    assert.equal((await call("tradeos_operation_status",{operationId:sourceReview.operationId})).status,"COMMITTED");
    const conflict=await client.callTool({name:"tradeos_mt5_review",arguments:{...sourceReview,reason:"Changed retry must be rejected"}});
    assert(conflict.isError && JSON.stringify(conflict.content).includes("OPERATION_CONFLICT"));
    const before=await preview();assert.equal(before.totalEpisodes,1);
    assert.equal((before.summary as {bridge:{ledgerBalance:string}}).bridge.ledgerBalance,"1000.00");
    assert.equal((before.records as Array<{episode:{finalNetPnl:string}}>)[0].episode.finalNetPnl,"95.00");
    assert.equal((await call("tradeos_accounts_get",{id:account.id})).derived_balance,"1000.00");
    passed("SOURCE review is retry-safe/audited, never publishes early, and preview computes 100 - 2 - 3 = 95 USD");
    const canonicalIdentity=`${connectionId}:100:10:BUY`;
    async function match() {const result=await call("tradeos_mt5_matches",{connectionId,canonicalIdentity,limit:1});return (result.records as Array<Record<string,unknown>>)[0];}
    setStage("MCP manual DISTINCT/REOPEN decisions");
    let candidate=await match();assert.equal(candidate.id,trade.id);assert.match(candidate.reviewToken as string,/^[a-f0-9]{64}$/);
    await call("tradeos_mt5_review",await review("DISTINCT",{canonicalIdentity,tradeId:trade.id,tradeToken:candidate.reviewToken}));
    candidate=await match();assert.equal((candidate.decision as {decision:string}).decision,"DISTINCT");
    await call("tradeos_mt5_review",await review("REOPEN",{canonicalIdentity,tradeId:trade.id,tradeToken:candidate.reviewToken}));
    candidate=await match();assert.equal((candidate.decision as {decision:string}).decision,"REOPEN");
    passed("MCP gets exact match fingerprints and appends DISTINCT then REOPEN without erasing evidence");
    setStage("MCP verified manual LINK publication");
    const link=await review("LINK",{canonicalIdentity,tradeId:trade.id,tradeToken:candidate.reviewToken});
    const linked=await call("tradeos_mt5_review",link);assert.deepEqual(await call("tradeos_mt5_review",link),linked);
    const aggregate=await call("tradeos_trades_get",{id:trade.id}),final=aggregate.trade as Record<string,unknown>;
    assert.equal(final.id,trade.id);assert.equal(final.source_type,"MT5");assert.equal(final.status,"CLOSED");assert.equal(final.net_pnl,"95.00");
    assert.equal(final.outcome,"WIN");assert.equal(final.thesis,"Original manual decision remains evidence");assert.equal(final.planned_risk_amount,trade.planned_risk_amount);
    assert.equal((await call("tradeos_accounts_get",{id:account.id})).derived_balance,"1095.00");
    assert.equal((await database.query("select count(*)::integer as n from public.trades where account_id=$1",[account.id])).rows[0].n,1);
    assert.equal((await database.query("select count(*)::integer as n from private.mt5_execution_versions where connection_id=$1",[connectionId])).rows[0].n,1);
    assert.equal((await database.query("select count(*)::integer as n from private.integration_mutation_audits where owner_id=$1 and changes->>'actorType'='MCP'",[userId])).rows[0].n,8);
    passed("explicit MCP LINK uses the existing canonical writer: one trade, 95 USD final PnL, original plan and recoverable MCP audits");
    setStage("MCP import-history paging");
    const batches=await call("tradeos_imports_list",{accountId:account.id,limit:1});const batch=(batches.records as Array<Record<string,unknown>>)[0];
    assert(batch);assert.equal((await call("tradeos_imports_get",{batchId:batch.id})).id,batch.id);
    const rows=await call("tradeos_import_rows",{batchId:batch.id,limit:1});assert(Array.isArray(rows.records));
    assert.equal((await call("tradeos_mt5_get",{connectionId})).status,"PAUSED");
    passed("MCP exposes canonical publication import history without activating a collector or enabling policy");
    setStage("MCP reviewed cash-revision reconciliation");
    const cashPayload={ticket:"99",positionId:null,orderId:null,symbol:null,type:"BALANCE",entry:null,volume:"0",price:"0",
      profit:"10",commission:"0",swap:"0",fee:"0",occurredAt:"2026-10-02T12:00:00.000Z"};
    await source("DEAL","99",cashPayload,true);
    const originalCashCommand=await decision({sourceTicket:"99",sourceRevisionId:(await database.query("select current_revision_id::text from private.mt5_source_facts where connection_id=$1 and source_id='99'",[connectionId])).rows[0].current_revision_id,
      disposition:"ADJUSTMENT",adjustmentType:"DEPOSIT",isPerformanceNeutral:true,existingAdjustmentId:null});
    const classified=await call("tradeos_mt5_cash_classify",originalCashCommand);assert.deepEqual(await call("tradeos_mt5_cash_classify",originalCashCommand),classified);
    const cashRevision=await source("DEAL","99",{...cashPayload,profit:"12.005"},true,true);
    await call("tradeos_mt5_review",await review("SOURCE",{sourceKind:"DEAL",sourceId:"99",sourceRevisionId:cashRevision}));
    const cashCommand=await review("CASH",{sourceId:"99",sourceRevisionId:cashRevision,isPerformanceNeutral:true});
    const cashResult=await call("tradeos_mt5_review",cashCommand);assert.deepEqual(await call("tradeos_mt5_review",cashCommand),cashResult);
    assert.equal((await call("tradeos_accounts_get",{id:account.id})).derived_balance,"1107.01");
    assert.equal((await database.query("select amount::text from public.account_adjustments where account_id=$1 and type='OTHER'",[account.id])).rows[0].amount,"2.01");
    assert.equal((await database.query("select amount::text from private.mt5_cash_decisions where connection_id=$1",[connectionId])).rows[0].amount,"10.00");
    passed("MCP CASH reconciliation preserves original funding and appends only 12.01 - 10.00 = 2.01 USD once");
    await source("DEAL","20",{...deal,positionId:"200",ticket:"20",orderId:"20",type:"BUY",entry:"IN",price:"1.1",profit:"0",commission:"-2",occurredAt:"2026-10-02T10:00:00.000Z"},true);
    await source("DEAL","21",{...deal,positionId:"200",ticket:"21",orderId:"21",type:"SELL",entry:"OUT",price:"1.2",profit:"20",commission:"-3",occurredAt:"2026-10-02T11:00:00.000Z"},true);
    const publication=await decision({openingBaseline:"1000",episodeIdentities:[`${connectionId}:200:20:BUY`]});
    const published=await call("tradeos_mt5_publish",publication);assert.deepEqual(await call("tradeos_mt5_publish",publication),published);
    assert.equal(published.reconciliationState,"NOT_APPROVED");
    const secondTrade=(await call("tradeos_trades_get",{id:(published.tradeIds as string[])[0]})).trade as Record<string,unknown>;
    assert.equal(secondTrade.net_pnl,"15.00");assert.equal(secondTrade.planned_risk_amount,null);
    assert.equal((await call("tradeos_accounts_get",{id:account.id})).derived_balance,"1122.01");
    const premature=await client.callTool({name:"tradeos_mt5_publication_policy",arguments:await decision({enabled:true})});assert(premature.isError);
    await source("ACCOUNT","ACCOUNT",{balance:"1122.01",equity:"1122.01",unrealizedPnl:"0",observedAt},true);
    const approval=await decision({openingBaseline:"1000",availableHistoryConfirmed:true});
    const approved=await call("tradeos_mt5_onboarding_approve",approval);assert.equal(approved.reconciliationState,"APPROVED_SNAPSHOT");
    assert.deepEqual(await call("tradeos_mt5_onboarding_approve",approval),approved);
    const policy=await decision({enabled:true});const enabled=await call("tradeos_mt5_publication_policy",policy);
    assert.deepEqual(await call("tradeos_mt5_publication_policy",policy),enabled);
    passed("MCP selects a new unknown-plan 15 USD execution once, approves only the reconciled 1122.01 snapshot, then enables policy without resuming");
    const state=await call("tradeos_mt5_get",{connectionId});assert.equal(state.status,"PAUSED");
    await database.query("update private.mt5_connections set worker_id=$2,lease_expires_at=clock_timestamp()+interval '1 minute' where id=$1",[connectionId,randomUUID()]);
    const oldFence=(await database.query("select fencing_token::text from private.mt5_connections where id=$1",[connectionId])).rows[0].fencing_token;
    const resume={connectionId,operationId:randomUUID(),version:state.version,action:"RESUME",reason:"Verify server control and fencing"};
    const resumed=await call("tradeos_mt5_control",resume);assert.equal(resumed.status,"ACTIVE");assert.deepEqual(await call("tradeos_mt5_control",resume),resumed);
    const fenced=(await database.query("select fencing_token::text,worker_id from private.mt5_connections where id=$1",[connectionId])).rows[0];
    assert.equal(BigInt(fenced.fencing_token),BigInt(oldFence)+BigInt(1));assert.equal(fenced.worker_id,null);
    await call("tradeos_mt5_control",{...resume,operationId:randomUUID(),version:resumed.version,action:"PAUSE"});
    await call("tradeos_mt5_publication_policy",await decision({enabled:false}));
    passed("MCP controls fence old ownership once, preserve reconciled records and finish paused with policy disabled");
    setStage("MCP collector revocation blocks review");
    await database.query("update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id=$1",[collectorGrant]);
    const denied=await client.callTool({name:"tradeos_mt5_review",arguments:await review("SOURCE",{sourceKind:"DEAL",sourceId:"11",sourceRevisionId:exitRevision})});
    assert(denied.isError && JSON.stringify(denied.content).includes("ACCESS_DENIED"));
    passed("MCP read access cannot bypass a revoked account-bound MT5 grant for mutation");
  } finally {
    // Exact disposable owner/connection only; immutable evidence is never deleted
    // through application workflows. This fixture is local and isolated.
    await database.query("begin");
    try {
      await database.query("set local session_replication_role=replica");
      for(const table of ["mt5_execution_sources","mt5_execution_versions","mt5_review_events","mt5_publication_approvals","mt5_onboarding_approvals","mt5_cash_decisions","mt5_symbol_mapping_events","mt5_symbol_mappings","mt5_source_facts","mt5_source_revisions"])
        await database.query(`delete from private.${table} where connection_id=$1`,[connectionId]);
      await database.query("delete from private.integration_mutation_audits where owner_id=$1",[userId]);
      await database.query("delete from private.integration_operations where owner_id=$1",[userId]);
      // Production correctly rejects broker-trade deletion. Remove this exact
      // disposable fixture under transaction-local replica mode before Auth's
      // parent cleanup; never rewrite the checked episode identity to null.
      await database.query("delete from public.trades where mt5_connection_id=$1",[connectionId]);
      await database.query("delete from private.mt5_connections where id=$1",[connectionId]);
      await database.query("delete from private.integration_grant_events where grant_id=$1",[collectorGrant]);
      await database.query("delete from private.integration_grants where id=$1",[collectorGrant]);
      await database.query("delete from auth.oauth_clients where id=$1",[collector]);
      if(previous)await database.query("update private.integration_resources set resource=$1,enabled=$2 where purpose='MT5'",[previous.resource,previous.enabled]);
      else await database.query("delete from private.integration_resources where purpose='MT5'");
      await database.query("commit");
    } catch(error) {await database.query("rollback");throw error;}
  }
}
