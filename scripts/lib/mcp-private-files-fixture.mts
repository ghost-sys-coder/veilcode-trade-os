import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type pg from "pg";
import type { Client } from "@modelcontextprotocol/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

const chunkBytes=393216;
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
type Obj=Record<string,unknown>;
export async function verifyPrivateFiles(db:pg.Client,client:Client,userId:string,instrumentId:string,
  storageAdmin:SupabaseClient,directOAuth:SupabaseClient,browser:SupabaseClient,page:Page,grantId:string,
  passed:(message:string)=>void,setStage:(message:string)=>void) {
  const objects:Array<{bucket:string;path:string}>=[];
  async function call(name:string,args:Obj):Promise<Obj> {const r=await client.callTool({name,arguments:args});
    if(r.isError) {const code=JSON.stringify(r.content).match(/STORAGE_UNAVAILABLE|STORAGE_NOT_CONFIGURED|FILE_CONTENT_CONFLICT|INVALID_FILE_CONTENT|INVALID_FILE_CHUNK|ACCESS_DENIED|VERSION_CONFLICT|INVALID_REFERENCE|SCHEMA_NOT_READY|UNAVAILABLE/)?.[0];
      throw new Error(`Private fixture tool failed: ${code??"REJECTED"}`);}
    assert(r.structuredContent);return r.structuredContent as Obj;}
  async function rejected(name:string,args:Obj,code:string) {const r=await client.callTool({name,arguments:args});assert(r.isError && JSON.stringify(r.content).includes(code));}
  let accountId:string|undefined,tradeId:string|undefined;
  try {
    setStage("private-file fixture and exact reservation");
    const account=(await call("tradeos_accounts_create",{operationId:randomUUID(),values:{name:"Private evidence fixture",account_type:"DEMO",broker_name:"Fixture",platform:"MT5",currency_code:"USD",currency_precision:2,starting_balance:"1000",started_at:"2026-10-01",status:"ACTIVE",leverage:null,notes:null}})).record as Obj;
    accountId=account.id as string;
    const trade=(await call("tradeos_trades_create",{operationId:randomUUID(),values:{account_id:accountId,instrument_id:instrumentId,direction:"BUY",status:"DRAFT"}})).record as Obj;
    tradeId=trade.id as string;
    const pixels=Buffer.alloc(512*512*3);let seed=42;
    for(let i=0;i<pixels.length;i++){seed=(seed*1664525+1013904223)>>>0;pixels[i]=seed>>>24;}
    const bytes=await sharp(pixels,{raw:{width:512,height:512,channels:3}}).png({compressionLevel:0}).toBuffer();
    const parts:Array<Buffer>=[];for(let offset=0;offset<bytes.length;offset+=chunkBytes)parts.push(bytes.subarray(offset,offset+chunkBytes));
    assert.equal(parts.length,3);
    const request={operationId:randomUUID(),tradeId,expectedTradeVersion:trade.record_version,metadata:{category:"AT_ENTRY",caption:"Byte verified chart evidence"},contentType:"image/png",byteLength:bytes.length,sha256:hash(bytes)};
    const reserved=await call("tradeos_screenshot_upload_request",request),upload=reserved.upload as Obj,uploadId=upload.uploadId as string;
    assert.deepEqual(await call("tradeos_screenshot_upload_request",request),reserved);
    assert.equal((await call("tradeos_operation_status",{operationId:request.operationId})).status,"COMMITTED");
    assert.equal((await call("tradeos_screenshots_list",{tradeId,limit:1})).records instanceof Array,true);
    assert.equal(((await call("tradeos_screenshots_list",{tradeId})).records as Obj[]).length,0);
    passed("private upload reservation is durable and does not create screenshot evidence");
    const chunkPath=(index:number)=>`${userId}/${tradeId}/${uploadId}/chunks/${index}-${hash(parts[index])}.part`;
    const originalPath=`${userId}/${tradeId}/mcp/${uploadId}/original.png`;
    objects.push({bucket:"trade-screenshots",path:originalPath});
    parts.forEach((_,index)=>objects.push({bucket:"trade-file-staging",path:chunkPath(index)}));
    let version=upload.version;
    const chunk=(index:number)=>({operationId:randomUUID(),uploadId,expectedVersion:version,chunkIndex:index,contentBase64:parts[index].toString("base64")});
    const finalPart=chunk(2);const last=await call("tradeos_screenshot_upload_chunk",finalPart);version=(last.upload as Obj).version;
    assert.deepEqual(await call("tradeos_screenshot_upload_chunk",finalPart),last);
    await rejected("tradeos_screenshot_upload_chunk",{...chunk(0),expectedVersion:"1"},"VERSION_CONFLICT");
    const status=await call("tradeos_screenshot_upload_status",{uploadId});assert.deepEqual(status.receivedChunks,[2]);
    assert.equal(status.status,"PENDING");
    passed("out-of-order chunks resume by persisted manifest; stale versions and lost response retries stay safe");
    setStage("private file lost Storage acknowledgement and concurrent replay");
    const lost=await storageAdmin.storage.from("trade-file-staging").upload(chunkPath(0),parts[0],{contentType:"application/octet-stream",upsert:false,metadata:{tradeOsSha256:hash(parts[0])}});assert(!lost.error);
    setStage("private full-size chunk after lost Storage acknowledgement");
    version=((await call("tradeos_screenshot_upload_chunk",chunk(0))).upload as Obj).version;
    setStage("private full-size chunk concurrent replay");
    const race=chunk(1),raceResults=await Promise.all([call("tradeos_screenshot_upload_chunk",race),call("tradeos_screenshot_upload_chunk",race)]);
    assert.deepEqual(raceResults[0],raceResults[1]);version=(raceResults[0].upload as Obj).version;
    const changed=Buffer.from(parts[1]);changed[0]^=1;
    await rejected("tradeos_screenshot_upload_chunk",{...race,contentBase64:changed.toString("base64")},"OPERATION_CONFLICT");
    assert.equal((await db.query("select count(*)::int as n from private.file_upload_chunks where upload_id=$1",[uploadId])).rows[0].n,3);
    const deniedRead=await directOAuth.storage.from("trade-file-staging").download(chunkPath(0));assert(deniedRead.error);
    const deniedWrite=await directOAuth.storage.from("trade-file-staging").upload(`${userId}/${tradeId}/unauthorized.part`,Buffer.from("no"),{contentType:"application/octet-stream"});assert(deniedWrite.error);
    const directTable=await directOAuth.from("trade_screenshots").select("id");assert(!directTable.error && directTable.data?.length===0);
    passed("concurrent/changed retries have one durable chunk effect, recover lost Storage acknowledgement, and retain direct OAuth denial");
    setStage("private file stale trade and audit rollback");
    await db.query("update public.trades set confirmation_notes='Concurrent fixture note' where id=$1 and user_id=$2",[tradeId,userId]);
    const current=(await call("tradeos_trades_get",{id:tradeId})).trade as Obj;
    const finish={operationId:randomUUID(),uploadId,expectedVersion:version,expectedTradeVersion:current.record_version};
    await rejected("tradeos_screenshot_upload_finish",{...finish,operationId:randomUUID(),expectedTradeVersion:trade.record_version},"VERSION_CONFLICT");
    await db.query("create function pg_temp.files_sdk_audit_failure() returns trigger language plpgsql as $$begin if new.changes->>'action'='FINISH' then raise exception 'Fixture audit failure' using errcode='23514';end if;return new;end;$$");
    await db.query("create trigger files_sdk_audit_failure before insert on private.application_mutation_audits for each row execute function pg_temp.files_sdk_audit_failure()");
    try {await rejected("tradeos_screenshot_upload_finish",finish,"INVALID_REFERENCE");}
    finally {await db.query("drop trigger if exists files_sdk_audit_failure on private.application_mutation_audits");}
    assert.equal((await call("tradeos_screenshot_upload_status",{uploadId})).status,"PENDING");
    assert.equal(((await call("tradeos_screenshots_list",{tradeId})).records as Obj[]).length,0);
    assert.equal((await call("tradeos_operation_status",{operationId:finish.operationId})).status,"UNKNOWN");
    passed("stale canonical versions and audit failure leave uploaded bytes private/unpublished with no metadata or receipt");
    const completed=await call("tradeos_screenshot_upload_finish",finish);assert.deepEqual(await call("tradeos_screenshot_upload_finish",finish),completed);
    const record=completed.screenshot as Obj;assert.equal(record.sha256,hash(bytes));assert.equal(record.width,512);assert.equal(record.height,512);
    assert.equal((await call("tradeos_screenshots_get",{screenshotId:record.id})).id,record.id);
    assert.equal((await call("tradeos_accounts_get",{id:accountId})).derived_balance,"1000.00");
    const ledger=(await db.query("select starting_balance::text,(select count(*) from public.account_adjustments where account_id=$1)::int as adjustments from public.trading_accounts where id=$1",[accountId])).rows[0];assert.equal(ledger.adjustments,0);
    passed("full image hash/type/size/pixels validate before atomic attachment; retries create one image and never change the account ledger");
    setStage("private screenshot bounded download and legacy compatibility");
    const received:Buffer[]=[];let offset=0;
    do {const response=await call("tradeos_screenshot_download",{screenshotId:record.id,offset,limit:chunkBytes,...(offset?{expectedSha256:hash(bytes)}:{})});
      assert.equal(response.sha256,hash(bytes));assert.equal(response.integrity,"VERIFIED_UPLOAD");received.push(Buffer.from(response.contentBase64 as string,"base64"));
      if(response.nextOffset===null)break;offset=response.nextOffset as number;
    } while(true);
    assert.deepEqual(Buffer.concat(received),bytes);
    await rejected("tradeos_screenshot_download",{screenshotId:record.id,offset:1,expectedSha256:"0".repeat(64)},"FILE_CONTENT_CONFLICT");
    const overwrite=await browser.storage.from("trade-screenshots").update(originalPath,Buffer.from("not an image"),{contentType:"image/png"});assert(overwrite.error);
    await page.goto(`http://127.0.0.1:3100/trades/${tradeId}`);await page.getByText("Byte verified chart evidence",{exact:true}).first().waitFor();
    passed("bounded authenticated download reconstructs exact bytes, rejects wrong continuation hashes, and renders in the existing browser");
    const legacyBytes=await sharp({create:{width:8,height:8,channels:3,background:"white"}}).png().toBuffer();
    const legacyPath=`${userId}/${tradeId}/${randomUUID()}-legacy.png`;objects.push({bucket:"trade-screenshots",path:legacyPath});
    assert(!(await browser.storage.from("trade-screenshots").upload(legacyPath,legacyBytes,{contentType:"image/png",upsert:false})).error);
    const legacy=await browser.from("trade_screenshots").insert({user_id:userId,trade_id:tradeId,category:"AT_ENTRY",storage_path:legacyPath}).select("id").single();assert(!legacy.error && legacy.data);
    const legacyRead=await call("tradeos_screenshot_download",{screenshotId:legacy.data.id,limit:10});assert.equal(legacyRead.integrity,"LEGACY_VALIDATED_ON_READ");
    assert.equal((await call("tradeos_screenshots_get",{screenshotId:legacy.data.id})).sha256,null);
    const replaced=await sharp({create:{width:8,height:8,channels:3,background:"black"}}).png().toBuffer();
    assert(!(await browser.storage.from("trade-screenshots").update(legacyPath,replaced,{contentType:"image/png"})).error);
    await rejected("tradeos_screenshot_download",{screenshotId:legacy.data.id,offset:10,expectedSha256:legacyRead.sha256},"FILE_CONTENT_CONFLICT");
    const list=await call("tradeos_screenshots_list",{tradeId,limit:1});assert(list.nextCursor);
    const next=await call("tradeos_screenshots_list",{tradeId,limit:1,afterId:list.nextCursor});assert.equal((next.records as Obj[]).length,1);
    passed("legacy browser uploads stay supported without invented original hashes; changed bytes reject continuation and metadata paging exhausts all rows");
    setStage("private screenshot kill switch and revocation");
    await db.query("update private.integration_resources set enabled=false where purpose='MCP'");
    try {await assert.rejects(client.callTool({name:"tradeos_screenshot_download",arguments:{screenshotId:record.id}}));}
    finally {await db.query("update private.integration_resources set enabled=true where purpose='MCP'");}
    await db.query("update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id=$1",[grantId]);
    try {await assert.rejects(client.callTool({name:"tradeos_screenshot_download",arguments:{screenshotId:record.id}}));await assert.rejects(client.callTool({name:"tradeos_screenshot_upload_finish",arguments:finish}));}
    finally {await db.query("update private.integration_grants set status='ACTIVE',revoked_at=null where id=$1",[grantId]);}
    assert.equal((await call("tradeos_screenshots_get",{screenshotId:record.id})).id,record.id);
    passed("kill switch and revoked current grant block new downloads and old finish receipt recovery without deleting evidence");
  } finally {
    // Only bytes created by this exact disposable fixture; never broker/user data.
    for(const bucket of ["trade-screenshots","trade-file-staging"]){const paths=objects.filter(o=>o.bucket===bucket).map(o=>o.path);if(paths.length){const removed=await storageAdmin.storage.from(bucket).remove(paths);assert(!removed.error);}}
    await db.query("drop trigger if exists files_sdk_audit_failure on private.application_mutation_audits");
    await db.query("begin");
    try {
      await db.query("set local session_replication_role=replica");
      await db.query("delete from private.file_upload_chunks where upload_id in(select id from private.file_uploads where owner_id=$1 and trade_id=$2)",[userId,tradeId??null]);
      await db.query("delete from private.file_uploads where owner_id=$1 and trade_id=$2",[userId,tradeId??null]);
      await db.query("delete from public.trade_screenshots where user_id=$1 and trade_id=$2",[userId,tradeId??null]);
      await db.query("delete from private.application_trade_versions where trade_id=$1",[tradeId??null]);
      await db.query("delete from public.trades where user_id=$1 and id=$2",[userId,tradeId??null]);
      await db.query("delete from public.trading_accounts where user_id=$1 and id=$2",[userId,accountId??null]);
      await db.query("commit");
    } catch(error){await db.query("rollback");throw error;}
  }
}
