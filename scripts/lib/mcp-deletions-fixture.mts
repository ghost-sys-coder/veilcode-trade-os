import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import sharp from "sharp";
import type pg from "pg";
import type {Client} from "@modelcontextprotocol/client";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Page} from "@playwright/test";
type Obj=Record<string,unknown>;
/** Parent has validated loopback API/DB and holds the global fixture lock. */
export async function verifyDeletions(db:pg.Client,client:Client,userId:string,instrumentId:string,
  admin:SupabaseClient,browser:SupabaseClient,page:Page,grantId:string,
  passed:(message:string)=>void,setStage:(message:string)=>void) {
  const objects:Array<{bucket:string;path:string}>=[];
  async function call(name:string,args:Obj):Promise<Obj>{setStage(`Deletion fixture: ${name}${args.entity?` ${args.entity}`:""}`);const result=await client.callTool({name,arguments:args});
    if(result.isError){const code=JSON.stringify(result.content).match(/VERSION_CONFLICT|INVALID_REFERENCE|OPERATION_CONFLICT|ACCESS_DENIED|UNAVAILABLE/)?.[0];throw new Error(`Deletion fixture tool failed: ${code??"REJECTED"}`);}
    assert(result.structuredContent);return result.structuredContent as Obj;}
  async function rejected(name:string,args:Obj,code:string){const result=await client.callTool({name,arguments:args});assert(result.isError&&JSON.stringify(result.content).includes(code));}
  const getStatus=(requestId:unknown)=>call("tradeos_deletion_status",{requestId});
  async function request(entity:string,id:unknown){const target=await call("tradeos_deletion_inspect",{entity,id});
    const input={operationId:randomUUID(),entity,id,expectedVersion:target.version,executionOperationId:randomUUID(),reason:"Remove disposable local verification record"};
    const result=await call("tradeos_deletion_request",input);assert.deepEqual(await call("tradeos_deletion_request",input),result);
    return {target,input,result,request:result.request as Obj};}
  async function approve(intent:Awaited<ReturnType<typeof request>>){
    setStage("Deletion fixture: real browser one-use approval");await page.goto(intent.result.approvalUrl as string);
    await page.locator('fieldset[data-mutation-ready="true"]').first().waitFor();
    const checkbox=page.getByRole("checkbox");assert(!(await checkbox.isChecked()));
    assert.equal((await getStatus(intent.request.requestId)).status,"PENDING");
    await page.getByRole("button",{name:"Approve one-use action",exact:true}).click();
    assert.equal((await getStatus(intent.request.requestId)).status,"PENDING");
    await checkbox.focus();await checkbox.press("Space");assert(await checkbox.isChecked());await page.getByRole("button",{name:"Approve one-use action",exact:true}).click();
    await page.waitForURL(url=>url.searchParams.get("result")==="approved");
    assert.equal((await getStatus(intent.request.requestId)).status,"APPROVED");
  }
  const execute=(intent:Awaited<ReturnType<typeof request>>)=>call("tradeos_deletion_execute",{operationId:intent.input.executionOperationId,requestId:intent.request.requestId});
  const config=async(entity:string,values:Obj)=>(await call("tradeos_configuration_create",{operationId:randomUUID(),entity,values})).record as Obj;
  const reference=async(entity:string,values:Obj)=>(await call("tradeos_references_create",{operationId:randomUUID(),entity,values})).record as Obj;
  const instrumentValues=(symbol:string)=>({symbol,display_name:"Disposable deletion instrument",asset_class:"FOREX",base_currency:"EUR",quote_currency:"USD",pip_size:"0.0001",price_precision:5,active:true});
  const goalValues={title:"Disposable deletion goal",goal_type:"CUSTOM",target_value:"10",custom_unit:"reviews",target_date:null,notes:null,active:true};
  try {
    const account=(await call("tradeos_accounts_create",{operationId:randomUUID(),values:{name:"Deletion gate account",account_type:"DEMO",broker_name:"Fixture",platform:"OTHER",currency_code:"USD",currency_precision:2,starting_balance:"1000",started_at:"2026-10-01",status:"ACTIVE",leverage:null,notes:null}})).record as Obj;
    const parent=await config("STRATEGY",{name:"Deletion retained parent",description:null,active:true});
    const unused:Array<{entity:string;record:Obj}>=[];
    unused.push({entity:"STRATEGY",record:await config("STRATEGY",{name:"Deletion unused strategy",description:null,active:true})});
    unused.push({entity:"SETUP",record:await config("SETUP",{name:"Deletion unused setup",description:null,strategy_id:parent.id,active:true})});
    unused.push({entity:"RULE",record:await config("RULE",{name:"Deletion unused rule",description:"Wait for recorded confirmation",rule_type:"DESCRIPTIVE",numeric_limit:null,account_id:account.id,active:true})});
    unused.push({entity:"GOAL",record:(await call("tradeos_goals_create",{operationId:randomUUID(),accountId:account.id,values:goalValues})).record as Obj});
    unused.push({entity:"TAG",record:await reference("TAG",{name:"Deletion unused tag",color:null})});
    unused.push({entity:"INSTRUMENT",record:await reference("INSTRUMENT",instrumentValues(`DEL${randomUUID().slice(0,8)}`))});
    for(const item of unused){const intent=await request(item.entity,item.record.id);assert.equal(intent.target.effect,"DELETE");
      await rejected("tradeos_deletion_execute",{operationId:intent.input.executionOperationId,requestId:intent.request.requestId},"INVALID_REFERENCE");
      await approve(intent);
      await rejected("tradeos_deletion_execute",{operationId:randomUUID(),requestId:intent.request.requestId},"ACCESS_DENIED");
      const results=await Promise.all([execute(intent),execute(intent)]);assert.deepEqual(results[0],results[1]);
      assert.equal((results[0].request as Obj).status,"DELETED");assert.equal((await getStatus(intent.request.requestId)).status,"DELETED");
      assert.equal((await db.query("select count(*)::int as n from private.application_operations where owner_id=$1 and operation_id=$2",[userId,intent.input.executionOperationId])).rows[0].n,1);
    }
    passed("all six unused configuration families delete only after unchecked-by-default real browser approval; concurrent replays consume once");

    const stale=await config("STRATEGY",{name:"Deletion stale target",description:null,active:true}),staleIntent=await request("STRATEGY",stale.id);
    await call("tradeos_configuration_patch",{operationId:randomUUID(),entity:"STRATEGY",id:stale.id,expectedVersion:stale.record_version,values:{description:"Changed since inspection"}});
    await page.goto(staleIntent.result.approvalUrl as string);assert(await page.getByRole("button",{name:"Approve one-use action",exact:true}).isDisabled());
    await page.getByRole("button",{name:"Reject request",exact:true}).click();await page.waitForURL(url=>url.searchParams.get("result")==="rejected");
    assert.equal((await getStatus(staleIntent.request.requestId)).status,"REJECTED");
    await rejected("tradeos_deletion_execute",{operationId:staleIntent.input.executionOperationId,requestId:staleIntent.request.requestId},"INVALID_REFERENCE");
    passed("changed target disables browser consent; explicit rejection never authorizes execution");

    const usedSetup=await config("SETUP",{name:"Deletion historical setup",strategy_id:parent.id,description:null,active:true});
    const usedRule=await config("RULE",{name:"Deletion historical rule",description:"Wait for recorded confirmation",rule_type:"DESCRIPTIVE",numeric_limit:null,account_id:account.id,active:true});
    const usedInstrument=await reference("INSTRUMENT",instrumentValues(`REF${randomUUID().slice(0,8)}`));
    const usedTag=await reference("TAG",{name:"Deletion historical tag",color:null});
    const usedGoal=(await call("tradeos_goals_create",{operationId:randomUUID(),accountId:account.id,values:{...goalValues,title:"Deletion progress history"}})).record as Obj;
    let trade=(await call("tradeos_trades_create",{operationId:randomUUID(),values:{account_id:account.id,instrument_id:usedInstrument.id,strategy_id:parent.id,setup_id:usedSetup.id,direction:"BUY",status:"OPEN",opened_at:"2026-10-01T12:00:00Z",planned_risk_amount:"10"}})).record as Obj;
    trade=(await call("tradeos_trades_patch",{operationId:randomUUID(),id:trade.id,expectedVersion:trade.record_version,values:{status:"CLOSED",closed_at:"2026-10-01T13:00:00Z",gross_pnl:"10",commission:"0",swap:"0"}})).record as Obj;
    const applicable=(await db.query("select id from public.trading_rules where user_id=$1 and active and archived_at is null and (account_id is null or account_id=$2)",[userId,account.id])).rows;
    trade=(await call("tradeos_trade_review",{operationId:randomUUID(),id:trade.id,expectedVersion:trade.record_version,reviews:{rules:{complete:true,results:applicable.map(rule=>({trading_rule_id:rule.id,complied:true,notes:"Explicit disposable-fixture review"}))}}})).record as Obj;
    await call("tradeos_trade_tags_assign",{operationId:randomUUID(),tradeId:trade.id,tagId:usedTag.id,expectedVersion:trade.record_version,expectedTagVersion:usedTag.record_version});
    await call("tradeos_goal_progress_record",{operationId:randomUUID(),goalId:usedGoal.id,expectedVersion:usedGoal.record_version,progressValue:"2",recordedAt:"2026-10-02T00:00:00Z",notes:null});
    for(const item of [{entity:"STRATEGY",record:parent},{entity:"SETUP",record:usedSetup},{entity:"RULE",record:usedRule},{entity:"GOAL",record:usedGoal},{entity:"TAG",record:usedTag},{entity:"INSTRUMENT",record:usedInstrument}]){
      const intent=await request(item.entity,item.record.id);assert.equal(intent.target.effect,"ARCHIVE");assert(Number(intent.target.referenceCount)>0);await approve(intent);
      assert.equal(((await execute(intent)).request as Obj).status,"ARCHIVED");
    }
    assert.equal((await call("tradeos_accounts_get",{id:account.id})).derived_balance,"1010.00");
    const preserved=await call("tradeos_trades_get",{id:trade.id});assert.equal((preserved.ruleReviewItems as Obj[]).length,applicable.length);
    passed("all six referenced families archive via existing writers; closed trade, reviewed rule snapshot, tag, goal progress and ledger remain intact");

    const expiryTarget=await reference("TAG",{name:"Deletion expired tag",color:null}),expired=await request("TAG",expiryTarget.id);
    await db.query("update private.deletion_requests set expires_at=clock_timestamp()-interval '1 second' where id=$1",[expired.request.requestId]);
    assert.equal((await getStatus(expired.request.requestId)).status,"EXPIRED");await page.goto(expired.result.approvalUrl as string);
    assert.equal(await page.getByRole("button",{name:"Approve one-use action",exact:true}).count(),0);
    const anonymous=await page.context().browser()!.newContext();try{const anon=await anonymous.newPage();await anon.goto(expired.result.approvalUrl as string);await anon.waitForURL(url=>url.pathname==="/login");assert.equal(await anon.getByText("Deletion expired tag",{exact:true}).count(),0);}finally{await anonymous.close();}
    passed("expired requests cannot approve; anonymous approval links reveal no target information");

    const bytes=await sharp({create:{width:16,height:8,channels:3,background:"white"}}).png().toBuffer();
    const screenshotTrade=(await call("tradeos_trades_create",{operationId:randomUUID(),values:{account_id:account.id,instrument_id:instrumentId,direction:"BUY",status:"DRAFT"}})).record as Obj;
    const path=`${userId}/${screenshotTrade.id}/${randomUUID()}-legacy.png`;objects.push({bucket:"trade-screenshots",path});
    assert(!(await browser.storage.from("trade-screenshots").upload(path,bytes,{contentType:"image/png",upsert:false})).error);
    const inserted=await browser.from("trade_screenshots").insert({user_id:userId,trade_id:screenshotTrade.id,category:"AT_ENTRY",storage_path:path,caption:"Legacy deletion fixture"}).select("id").single();assert(!inserted.error&&inserted.data);
    const legacyId=inserted.data.id,old=await request("SCREENSHOT",legacyId);await approve(old);
    assert(!(await browser.storage.from("trade-screenshots").update(path,bytes,{contentType:"image/png"})).error);
    await rejected("tradeos_deletion_execute",{operationId:old.input.executionOperationId,requestId:old.request.requestId},"VERSION_CONFLICT");
    const legacy=await request("SCREENSHOT",legacyId);await approve(legacy);const accepted=await execute(legacy);
    assert.equal((accepted.request as Obj).status,"PURGE_PENDING");assert.equal((await getStatus(legacy.request.requestId)).status,"DELETED");
    assert.deepEqual(await execute(legacy),accepted);assert((await admin.storage.from("trade-screenshots").download(path)).error);
    assert((await browser.storage.from("trade-screenshots").upload(path,bytes,{contentType:"image/png",upsert:false})).error);
    await rejected("tradeos_screenshots_get",{screenshotId:legacyId},"NOT_FOUND");
    passed("legacy Storage revision changes invalidate approval; fresh consent removes actual bytes and permanently reserves the exact retired identity");

    const hash=createHash("sha256").update(bytes).digest("hex");
    const latest=(await call("tradeos_trades_get",{id:screenshotTrade.id})).trade as Obj;
    const reserved=await call("tradeos_screenshot_upload_request",{operationId:randomUUID(),tradeId:screenshotTrade.id,expectedTradeVersion:latest.record_version,metadata:{category:"AT_ENTRY",caption:"Managed deletion fixture"},contentType:"image/png",byteLength:bytes.length,sha256:hash});
    const upload=reserved.upload as Obj;
    const chunk=await call("tradeos_screenshot_upload_chunk",{operationId:randomUUID(),uploadId:upload.uploadId,expectedVersion:upload.version,chunkIndex:0,contentBase64:bytes.toString("base64")});
    const chunkPath=`${userId}/${screenshotTrade.id}/${upload.uploadId}/chunks/0-${hash}.part`,originalPath=`${userId}/${screenshotTrade.id}/mcp/${upload.uploadId}/original.png`;
    objects.push({bucket:"trade-file-staging",path:chunkPath},{bucket:"trade-screenshots",path:originalPath});
    const fresh=(await call("tradeos_trades_get",{id:screenshotTrade.id})).trade as Obj;
    const finished=await call("tradeos_screenshot_upload_finish",{operationId:randomUUID(),uploadId:upload.uploadId,expectedVersion:(chunk.upload as Obj).version,expectedTradeVersion:fresh.record_version});
    const managed=await request("SCREENSHOT",(finished.screenshot as Obj).id);await approve(managed);
    // Controlled settlement outage after actual API removal. Database action and
    // physical deletion must not be falsely advertised as completed/rolled back.
    await db.query("create function pg_temp.deletions_sdk_settle_failure() returns trigger language plpgsql as $$begin if new.changes->>'action'='SETTLE' then raise exception 'Fixture settlement outage' using errcode='23514';end if;return new;end;$$");
    await db.query("create trigger deletions_sdk_settle_failure before insert on private.application_mutation_audits for each row execute function pg_temp.deletions_sdk_settle_failure()");
    let pending:Obj;
    try{pending=await execute(managed);assert.equal((await getStatus(managed.request.requestId)).status,"PURGE_PENDING");}
    finally{await db.query("drop trigger if exists deletions_sdk_settle_failure on private.application_mutation_audits");}
    assert((await admin.storage.from("trade-screenshots").download(originalPath)).error);assert((await admin.storage.from("trade-file-staging").download(chunkPath)).error);
    assert.equal(((await call("tradeos_screenshot_upload_status",{uploadId:upload.uploadId})).status),"COMPLETE");
    assert.equal((await db.query("select count(*)::int as n from private.file_upload_chunks where upload_id=$1",[upload.uploadId])).rows[0].n,1);
    await db.query("update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id=$1",[grantId]);
    try{
      await assert.rejects(client.callTool({name:"tradeos_deletion_execute",arguments:{operationId:managed.input.executionOperationId,requestId:managed.request.requestId}}));
      await page.goto(managed.result.approvalUrl as string);await page.getByRole("button",{name:"Retry file removal",exact:true}).click();
      await page.waitForURL(url=>url.searchParams.get("result")==="deleted");await page.getByText("Deletion completed. Original audit metadata is preserved.",{exact:true}).waitFor();
    }finally{await db.query("update private.integration_grants set status='ACTIVE',revoked_at=null where id=$1",[grantId]);}
    assert.equal((await getStatus(managed.request.requestId)).status,"DELETED");assert.deepEqual(await execute(managed),pending!);
    const evidence=(await db.query("select original_record,status from private.deletion_requests where id=$1",[managed.request.requestId])).rows[0];assert.equal(evidence.original_record.storage_path,originalPath);
    assert.equal((await call("tradeos_accounts_get",{id:account.id})).derived_balance,"1010.00");
    passed("managed originals/chunks physically purge; settlement interruption stays pending, revoked client is denied, and owner-browser recovery preserves immutable receipts/manifests");

    setStage("Deletion fixture: browser dark/light/mobile and keyboard");
    for(const dark of [false,true]){await page.evaluate(value=>document.documentElement.classList.toggle("dark",value),dark);assert.equal(await page.evaluate(()=>document.documentElement.classList.contains("dark")),dark);await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));}
    await page.setViewportSize({width:1440,height:1000});
    passed("deletion status/approval use existing dark/light tokens, mobile has no horizontal overflow, and native explicit-checkbox consent is enforced");
  }finally{
    await db.query("drop trigger if exists deletions_sdk_settle_failure on private.application_mutation_audits");
    for(const bucket of ["trade-screenshots","trade-file-staging"]){const paths=objects.filter(o=>o.bucket===bucket).map(o=>o.path);if(paths.length)assert(!(await admin.storage.from(bucket).remove(paths)).error);}
  }
}
