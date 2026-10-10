import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import pg from "pg";
import { databaseTestConnection } from "./lib/database-test-safety.mjs";
import { integrationSigningKeys, verifyIntegrationToken } from "../services/integrations/verify-token.ts";
import type { IntegrationDatabase } from "../types/integration-database.ts";
import { verifyIntegrationAccess } from "./lib/mcp-integration-access-fixture.mts";
import { verifyPrivateFiles } from "./lib/mcp-private-files-fixture.mts";
import { verifyDeletions } from "./lib/mcp-deletions-fixture.mts";
import { verifyStdio } from "./lib/mcp-stdio-fixture.mts";

// Isolated local provider/browser/SDK test. No .env, real users, model API or
// hosted writes. Credentials and authorization codes stay in process memory.
let stage="local discovery", checks=0, pageErrors=0;
let database:pg.Client|undefined, ui:Browser|undefined, page:Page|undefined, callbackServer:Server|undefined;
let fixtureUser:string|undefined, fixtureClient:string|undefined;
let admin:ReturnType<typeof createClient>|undefined;
let previousResource:{purpose:string;resource:string;enabled:boolean}|undefined;
const connected:Client[]=[];
const origin="http://127.0.0.1:3100", resource=`${origin}/mcp`, callback="http://127.0.0.1:9877/callback";
function passed(message:string) {console.log(`PASS ${++checks}: ${message}`);}
function content(result:Awaited<ReturnType<Client["callTool"]>>):Record<string,unknown> {
  if(result.isError) {
    const known=["VERSION_CONFLICT","CURVE_CHANGED","INVALID_CURSOR","OPERATION_CONFLICT","READ_UNAVAILABLE","SCHEMA_NOT_READY","ACCESS_DENIED","INVALID_REFERENCE","APPLICATION_WORKFLOW_UNAVAILABLE"];
    const code=known.find(code=>result.content?.some(item=>item.type==="text" && item.text.startsWith(code)));
    if(code)console.error(`Fixture tool error code: ${code}`);
  }
  assert(!result.isError && result.structuredContent && typeof result.structuredContent==="object");
  return result.structuredContent as Record<string,unknown>;
}
function record(result:Awaited<ReturnType<Client["callTool"]>>) {return content(result).record as Record<string,unknown>;}

try {
  const status=JSON.parse(execFileSync("supabase",["status","--output","json"],{
    cwd:fileURLToPath(new URL("..",import.meta.url)),encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:15000,
  })) as Record<string,string>;
  const connection=databaseTestConnection(status.DB_URL);
  const api=new URL(status.API_URL);assert(["127.0.0.1","localhost","[::1]"].includes(api.hostname));
  const issuer=`${api.origin}/auth/v1`;
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  admin=createClient(api.origin,status.SERVICE_ROLE_KEY,options);
  const browser=createClient<IntegrationDatabase>(api.origin,status.ANON_KEY,options);
  database=new pg.Client(connection);database.on("error",()=>{process.exitCode=1;console.error("Local MCP fixture database interrupted.");});
  await database.connect();await database.query("select pg_advisory_lock(670051234)");
  assert.equal((await database.query("select to_regprocedure('private.configuration_write(jsonb)') is not null as ready")).rows[0].ready,true);
  previousResource=(await database.query("select * from private.integration_resources where purpose='MCP'")).rows[0];
  await database.query("insert into private.integration_resources(purpose,resource,enabled) values('MCP',$1,true) on conflict(purpose) do update set resource=excluded.resource,enabled=true",[resource]);

  stage="identity and client registration";
  const email=`mcp-${randomUUID()}@example.test`, password=randomBytes(32).toString("base64url");
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert(!created.error && created.data.user);
  fixtureUser=created.data.user.id;
  const signedIn=await browser.auth.signInWithPassword({email,password});assert(!signedIn.error && signedIn.data.session);
  const registration=await fetch(`${issuer}/admin/oauth/clients`,{method:"POST",headers:{apikey:status.SERVICE_ROLE_KEY,
    Authorization:`Bearer ${status.SERVICE_ROLE_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({client_name:"Trade OS MCP local gate",redirect_uris:[callback,"http://127.0.0.1:9878/callback"],client_type:"public",
      token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"]}),signal:AbortSignal.timeout(10000)});
  assert(registration.ok);fixtureClient=(await registration.json() as {client_id:string}).client_id;assert(fixtureClient);
  ui=await chromium.launch({channel:"chrome",headless:true});console.log(`MCP browser verification: Chrome ${ui.version()}, SDK 2.3.1.`);
  page=await ui.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);page.on("pageerror",()=>{pageErrors++;});

  stage="public discovery and challenge";
  const metadata=await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);assert.equal(metadata.status,200);
  assert.equal((await metadata.json() as {resource:string}).resource,resource);
  const denied=await fetch(resource,{method:"POST"});assert.equal(denied.status,401);
  assert(denied.headers.get("www-authenticate")?.includes(`${origin}/.well-known/oauth-protected-resource/mcp`));
  assert.equal((await page.goto(`${origin}/tools/position-size-calculator`))?.status(),200);
  assert.equal(new URL(page.url()).pathname,"/tools/position-size-calculator");
  passed("public MCP discovery/challenge and anonymous calculator remain accessible");

  stage="authorization request";
  const verifier=randomBytes(48).toString("base64url"), state=randomUUID();
  const authorize=new URL(`${issuer}/oauth/authorize`);
  authorize.search=new URLSearchParams({client_id:fixtureClient,redirect_uri:callback,response_type:"code",scope:"email",
    state,resource,code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url")}).toString();
  const request=await fetch(authorize,{redirect:"manual",signal:AbortSignal.timeout(10000)});assert([302,303,307].includes(request.status));
  const authorizationId=new URL(request.headers.get("location")!).searchParams.get("authorization_id");assert(authorizationId);
  let receivedCode:string|undefined;
  callbackServer=createServer({maxHeaderSize:8192},(request,response)=>{
    let valid=false;
    try {
      const url=new URL(request.url!,callback);
      valid=request.method==="GET" && request.socket.remoteAddress==="127.0.0.1" && request.headers.host==="127.0.0.1:9877"
        && !request.headers.origin && (request.url?.length??0)<=8192 && url.pathname==="/callback"
        && url.searchParams.getAll("state").length===1 && url.searchParams.get("state")===state
        && url.searchParams.getAll("code").length===1 && Boolean(url.searchParams.get("code"))
        && [...url.searchParams.keys()].every(key=>["code","state"].includes(key)) && receivedCode===undefined;
      if(valid)receivedCode=url.searchParams.get("code")!;
    } catch { /* Never consume malformed callbacks. */ }
    response.writeHead(valid?200:400,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store",
      "Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'"});
    response.end(valid?"<h1>MCP fixture approved</h1>":"Callback rejected");
  });
  callbackServer.requestTimeout=2000;callbackServer.headersTimeout=2000;callbackServer.setTimeout(2000,socket=>socket.destroy());
  await new Promise<void>((resolve,reject)=>{callbackServer!.once("error",reject);callbackServer!.listen({host:"127.0.0.1",port:9877,exclusive:true},resolve);});
  stage="real browser consent";
  await page.goto(`${origin}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
  await page.getByLabel("Email address",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("button",{name:"Approve access",exact:true}).waitFor();
  assert.equal(await page.getByLabel("Authorized trading account",{exact:true}).count(),0);
  assert((await page.locator("#approval-help").innerText()).includes("application-wide access"));
  await page.getByRole("button",{name:"Approve access",exact:true}).click();
  await page.waitForURL(url=>url.origin+url.pathname===callback && url.searchParams.has("code"));assert(receivedCode);
  const grants=await browser.rpc("list_integration_grants");assert(!grants.error && Array.isArray(grants.data));
  const grant=grants.data.find(item=>typeof item==="object" && item!==null && "client_id" in item && item.client_id===fixtureClient) as {id:string;version:string;purpose:string;account_id:null;status:string};
  assert.equal(grant.purpose,"MCP");assert.equal(grant.account_id,null);assert.equal(grant.status,"ACTIVE");
  passed("real browser consent activates an application-wide MCP grant without MT5 account mapping");

  async function exchange(proof:string) {
    return fetch(`${issuer}/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"authorization_code",client_id:fixtureClient!,redirect_uri:callback,code:receivedCode!,code_verifier:proof,resource}),
      signal:AbortSignal.timeout(10000)});
  }
  stage="PKCE and resource verification";
  assert(!(await exchange(randomBytes(48).toString("base64url"))).ok);
  const tokenResponse=await exchange(verifier);assert(tokenResponse.ok);
  let tokens=await tokenResponse.json() as {access_token:string;refresh_token:string};
  const claims=await verifyIntegrationToken(tokens.access_token,{issuer,resource,key:integrationSigningKeys(issuer)});
  assert.equal(claims.sub,fixtureUser);assert.equal(claims.trade_os_grant_id,grant.id);
  await assert.rejects(verifyIntegrationToken(tokens.access_token,{issuer,resource:`${origin}/api/integrations/v1`,key:integrationSigningKeys(issuer)}));
  const wrongApi=await fetch(`${origin}/api/integrations/v1/session`,{headers:{Authorization:`Bearer ${tokens.access_token}`}});assert.equal(wrongApi.status,401);
  passed("provider enforces S256 and signed MCP tokens cannot authorize MT5");

  stage="official SDK transports";
  async function client(mode:"legacy"|"2026-07-28") {
    const instance=new Client({name:"Trade OS MCP local gate",version:"1.0.0"},{versionNegotiation:{mode:mode==="legacy"?"legacy":{pin:mode}}});
    connected.push(instance);
    await instance.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:(input,init)=>{
      const headers=new Headers(init?.headers);headers.set("Authorization",`Bearer ${tokens.access_token}`);
      return fetch(input,{...init,headers,signal:AbortSignal.timeout(15000)});
    }}));
    return instance;
  }
  const modern=await client("2026-07-28"), legacy=await client("legacy");
  assert.equal((await modern.listTools()).tools.length,84);assert.equal((await legacy.listTools()).tools.length,84);
  assert.equal((await modern.listResources()).resources.length,8);
  const calculator=content(await modern.callTool({name:"tradeos_position_size",arguments:{balance:"100000",currency:"USD",currencyPrecision:2,
    riskMethod:"PERCENTAGE",riskValue:"1",instrumentSymbol:"EURUSD",direction:"BUY",entryPrice:"1.1",stopLossPrice:"1.098"}}));
  assert.equal(calculator.recommendedVolume,"5.00");assert.equal(calculator.riskAmount,"1000.00");
  passed("official SDK negotiates modern and legacy HTTP, discovers 84 tools and verifies 5.00-lot fixture");

  const directOAuth=createClient(api.origin,status.ANON_KEY,{...options,global:{headers:{Authorization:`Bearer ${tokens.access_token}`}}});
  if(!process.argv.includes("--integration-access-only")&&!process.argv.includes("--deletions-only")&&!process.argv.includes("--stdio-only")) {
    const fileInstrument=(await database.query("select id from public.instruments where symbol='EURUSD' and user_id is null")).rows[0].id;
    await verifyPrivateFiles(database,modern,fixtureUser,fileInstrument,admin,directOAuth,browser,page,grant.id,passed,message=>{stage=message;});
  }
  if(process.argv.includes("--deletions-only")) {
    const fileInstrument=(await database.query("select id from public.instruments where symbol='EURUSD' and user_id is null")).rows[0].id;
    await verifyDeletions(database,modern,fixtureUser,fileInstrument,admin,browser,page,grant.id,passed,message=>{stage=message;});
  }
  if(process.argv.includes("--stdio-only")) {
    tokens=await verifyStdio(database,fixtureUser,issuer,resource,fixtureClient,tokens,page,passed,message=>{stage=message;});
    assert.equal(pageErrors,0);console.log(`Focused MCP stdio gate: ${checks} checks passed; real external clients remain separate.`);
  } else if(process.argv.includes("--deletions-only")) {
    assert.equal(pageErrors,0);console.log(`Focused MCP deletion gate: ${checks} checks passed; full regression gate remains separate.`);
  } else if(process.argv.includes("--files-only")) {
    console.log(`Focused MCP private-file gate: ${checks} checks passed; full regression gate remains separate.`);
  } else if(process.argv.includes("--integration-access-only")) {
    const instrument=(await database.query("select id from public.instruments where symbol='EURUSD' and user_id is null")).rows[0].id;
    await verifyIntegrationAccess(database,modern,fixtureUser,instrument,passed,message=>{stage=message;});
    console.log(`Focused MCP integration gate: ${checks} checks passed; full regression gate remains separate.`);
  } else {

  stage="self-profile audited SDK/browser preferences";
  const originalProfile=content(await modern.callTool({name:"tradeos_profile_get",arguments:{}}));
  assert.equal(originalProfile.id,fixtureUser);assert.equal(originalProfile.record_version,"1");
  assert(!Object.hasOwn(originalProfile,"email")&&!Object.hasOwn(originalProfile,"raw_user_meta_data"));
  const profileInput={operationId:randomUUID(),expectedVersion:originalProfile.record_version,values:{displayName:"MCP Profile Fixture"}};
  stage="profile concurrent SDK retry";
  const profileRacers=await Promise.all([modern,legacy].map(instance=>instance.callTool({name:"tradeos_profile_patch",arguments:profileInput})));
  assert.deepEqual(content(profileRacers[0]),content(profileRacers[1]));let profile=record(profileRacers[0]);
  assert.equal(profile.record_version,"2");assert.equal(profile.timezone,originalProfile.timezone);
  assert.equal((await database.query("select count(*)::integer as n from private.application_operations where owner_id=$1 and operation_id=$2",[fixtureUser,profileInput.operationId])).rows[0].n,1);
  assert.equal(content(await modern.callTool({name:"tradeos_operation_status",arguments:{operationId:profileInput.operationId}})).status,"COMMITTED");
  stage="profile rejects caller-supplied identity";
  const badProfileScope=await modern.callTool({name:"tradeos_profile_get",arguments:{id:randomUUID()}});assert(badProfileScope.isError);
  const profileConflict=await legacy.callTool({name:"tradeos_profile_patch",arguments:{...profileInput,values:{displayName:"Changed retry"}}});
  assert(profileConflict.isError&&JSON.stringify(profileConflict.content).includes("OPERATION_CONFLICT"));
  passed("profile SDK reads self only; concurrent identical retries have one receipt/audit and changed-payload retry is rejected");

  const profileEdits=await Promise.all([modern,legacy].map((instance,index)=>instance.callTool({name:"tradeos_profile_patch",arguments:{operationId:randomUUID(),expectedVersion:profile.record_version,values:{displayName:`Profile race ${index}`}}})));
  assert.equal(profileEdits.filter(result=>!result.isError).length,1);
  assert(profileEdits.filter(result=>result.isError).every(result=>JSON.stringify(result.content).includes("VERSION_CONFLICT")));
  profile=content(await modern.callTool({name:"tradeos_profile_get",arguments:{}}));
  assert.equal(profile.record_version,"3");
  await page.goto(`${origin}/settings`);
  assert.equal(await page.locator('input[name="expectedVersion"]').inputValue(),"3");
  assert.equal(await page.getByLabel("Display name",{exact:true}).inputValue(),profile.display_name);
  const beforeProfileAudit=(await database.query("select count(*)::integer as n from private.application_mutation_audits where actor_user_id=$1 and actor_type='BROWSER'",[fixtureUser])).rows[0].n;
  await page.getByLabel("Display name",{exact:true}).fill("Browser Profile Fixture");await page.getByLabel("Journal timezone",{exact:true}).fill("europe/london");
  await page.getByRole("button",{name:"Save settings",exact:true}).click();await page.getByText("Workspace settings updated.",{exact:true}).waitFor();
  profile=content(await modern.callTool({name:"tradeos_profile_get",arguments:{}}));
  assert.equal(profile.display_name,"Browser Profile Fixture");assert.equal(profile.timezone,"Europe/London");assert.equal(profile.record_version,"4");
  assert.equal(profile.created_at,originalProfile.created_at);
  assert.equal((await database.query("select count(*)::integer as n from private.application_mutation_audits where actor_user_id=$1 and actor_type='BROWSER'",[fixtureUser])).rows[0].n,beforeProfileAudit+1);
  passed("simultaneous profile edits have one winner; real browser preferences use the same versioned audited service and canonical timezone");

  await page.getByLabel("Display name",{exact:true}).fill("Must not overwrite concurrent change");
  profile=record(await modern.callTool({name:"tradeos_profile_patch",arguments:{operationId:randomUUID(),expectedVersion:profile.record_version,values:{displayName:null}}}));
  assert.equal(profile.display_name,null);assert.equal(profile.timezone,"Europe/London");
  await page.getByRole("button",{name:"Save settings",exact:true}).click();await page.getByRole("alert").filter({hasText:"This record changed"}).waitFor();
  assert.equal(content(await modern.callTool({name:"tradeos_profile_get",arguments:{}})).display_name,null);
  profile=record(await modern.callTool({name:"tradeos_profile_patch",arguments:{operationId:randomUUID(),expectedVersion:profile.record_version,values:{displayName:originalProfile.display_name,timezone:originalProfile.timezone}}}));
  assert.equal(profile.timezone,originalProfile.timezone);
  const forbiddenAuth=await modern.callTool({name:"tradeos_profile_patch",arguments:{operationId:randomUUID(),expectedVersion:profile.record_version,values:{email:"not-an-auth-workflow@example.test"}}});assert(forbiddenAuth.isError);
  const authIdentity=await browser.auth.getUser();assert(!authIdentity.error&&authIdentity.data.user?.email===email);
  passed("stale browser form cannot overwrite MCP preferences; null clears only name, auth identity is unchanged and default timezone is restored");

  stage="configuration commands and receipts";
  const operationId=randomUUID();
  const createInput={entity:"STRATEGY",operationId,values:{name:"MCP gate strategy",description:"Original methodology",active:true}};
  const createdStrategy=await modern.callTool({name:"tradeos_configuration_create",arguments:createInput});const strategy=record(createdStrategy);
  assert.equal(strategy.user_id,fixtureUser);assert.equal(strategy.record_version,"1");
  assert.deepEqual(content(await legacy.callTool({name:"tradeos_configuration_create",arguments:createInput})),content(createdStrategy));
  const conflict=await modern.callTool({name:"tradeos_configuration_create",arguments:{...createInput,values:{...createInput.values,name:"Changed retry"}}});
  assert(conflict.isError && JSON.stringify(conflict.content).includes("OPERATION_CONFLICT"));
  assert.equal(content(await modern.callTool({name:"tradeos_operation_status",arguments:{operationId}})).status,"COMMITTED");
  const mutationCount=(await database.query("select count(*)::integer as count from private.application_operations where owner_id=$1 and operation_id=$2",[fixtureUser,operationId])).rows[0].count;
  assert.equal(mutationCount,1);
  passed("identical cross-client retry has one durable effect and changed-payload retry is rejected");
  const setup=record(await modern.callTool({name:"tradeos_configuration_create",arguments:{entity:"SETUP",operationId:randomUUID(),
    values:{name:"MCP gate setup",strategy_id:strategy.id,description:null,active:true}}}));assert.equal(setup.strategy_id,strategy.id);
  const rule=record(await modern.callTool({name:"tradeos_configuration_create",arguments:{entity:"RULE",operationId:randomUUID(),
    values:{name:"MCP gate rule",description:"Explicit risk limit",rule_type:"MAX_RISK_PERCENT",numeric_limit:"0.00000001",account_id:null,active:true}}}));
  assert.equal(rule.numeric_limit,"0.00000001");
  const patched=record(await modern.callTool({name:"tradeos_configuration_patch",arguments:{entity:"STRATEGY",operationId:randomUUID(),id:strategy.id,expectedVersion:"1",values:{description:null}}}));
  assert.equal(patched.name,strategy.name);assert.equal(patched.description,null);assert.equal(patched.record_version,"2");
  const stale=await modern.callTool({name:"tradeos_configuration_patch",arguments:{entity:"STRATEGY",operationId:randomUUID(),id:strategy.id,expectedVersion:"1",values:{name:"Stale overwrite"}}});
  assert(stale.isError && JSON.stringify(stale.content).includes("VERSION_CONFLICT"));
  passed("setup/rule creation, exact decimal boundaries, omitted/null patches and stale versions work through real HTTP");

  stage="concurrent operations";
  const raceOperation=randomUUID();
  const raceCreate={entity:"STRATEGY",operationId:raceOperation,values:{name:"Concurrent MCP fixture",description:null,active:true}};
  const racers=await Promise.all([modern,legacy].map(client=>client.callTool({name:"tradeos_configuration_create",arguments:raceCreate})));
  assert.deepEqual(content(racers[0]),content(racers[1]));const raceRecord=record(racers[0]);
  assert.equal((await database.query("select count(*)::integer as count from private.application_operations where owner_id=$1 and operation_id=$2",[fixtureUser,raceOperation])).rows[0].count,1);
  const edits=await Promise.all([modern,legacy].map((client,index)=>client.callTool({name:"tradeos_configuration_patch",
    arguments:{entity:"STRATEGY",operationId:randomUUID(),id:raceRecord.id,expectedVersion:"1",values:{name:`Concurrent winner ${index}`}}})));
  assert.equal(edits.filter(result=>!result.isError).length,1);assert.equal(edits.filter(result=>result.isError).length,1);
  assert(edits.filter(result=>result.isError).every(result=>JSON.stringify(result.content).includes("VERSION_CONFLICT")));
  passed("simultaneous retries create one receipt; simultaneous stale-version edits have exactly one winner");

  stage="stable pagination";
  const ids:string[]=[];let afterId:string|undefined;
  do {
    stage="strategy pagination: SDK response";
    const result=content(await modern.callTool({name:"tradeos_configuration_list",arguments:{entity:"STRATEGY",limit:1,...(afterId?{afterId}:{})}}));
    const records=result.records as Array<{id:string;user_id:string}>;stage="strategy pagination: owner";assert(records.every(item=>item.user_id===fixtureUser));
    ids.push(...records.map(item=>item.id));afterId=result.nextCursor as string|undefined;
    stage="strategy pagination: bounded iteration";assert(ids.length<=100);
  } while(afterId);
  stage="strategy pagination: unique IDs and created record";
  assert.equal(ids.length,new Set(ids).size);assert(ids.includes(strategy.id as string));
  const allIds=(await database.query("select id::text from public.strategies where user_id=$1 and archived_at is null order by id",[fixtureUser])).rows.map(row=>row.id);
  stage="strategy pagination: complete SQL comparison";assert.deepEqual(ids,allIds);
  passed("all stable pages contain only the owner and no duplicated/omitted strategy IDs");

  stage="account CRUD and financial fixtures";
  const accountOperation=randomUUID();
  const accountInput={operationId:accountOperation,values:{name:"MCP gate account",account_type:"DEMO",broker_name:"Fixture broker",platform:"OTHER",
    currency_code:"USD",currency_precision:2,starting_balance:"100000.005",leverage:null,started_at:"2026-09-01",status:"ACTIVE",notes:"Original notes"}};
  const accountCreation=await modern.callTool({name:"tradeos_accounts_create",arguments:accountInput});const account=record(accountCreation);
  assert.equal(account.starting_balance,"100000.01");assert.equal(account.derived_balance,"100000.01");assert.equal(account.record_version,"1");
  assert.deepEqual(content(await legacy.callTool({name:"tradeos_accounts_create",arguments:accountInput})),content(accountCreation));
  assert.equal(content(await modern.callTool({name:"tradeos_operation_status",arguments:{operationId:accountOperation}})).status,"COMMITTED");
  const accountPatch=record(await modern.callTool({name:"tradeos_accounts_patch",arguments:{operationId:randomUUID(),id:account.id,expectedVersion:"1",values:{broker_name:null}}}));
  assert.equal(accountPatch.record_version,"2");assert.equal(accountPatch.broker_name,null);assert.equal(accountPatch.notes,"Original notes");
  const jpy=record(await modern.callTool({name:"tradeos_accounts_create",arguments:{operationId:randomUUID(),values:{...accountInput.values,
    name:"MCP JPY fixture",currency_code:"JPY",currency_precision:0,starting_balance:"1000.5"}}}));assert.equal(jpy.derived_balance,"1001");
  // Deterministic local baseline fixtures; never create broker orders or touch hosted data.
  const instrument=(await database.query("select id from public.instruments where symbol='EURUSD' and user_id is null")).rows[0].id;
  await database.query("insert into public.trades(user_id,account_id,instrument_id,status,direction,opened_at,net_pnl) values($1,$2,$3,'OPEN','BUY',clock_timestamp(),999)",[fixtureUser,account.id,instrument]);
  await database.query("insert into public.trades(user_id,account_id,instrument_id,status,direction,opened_at,closed_at,gross_pnl,net_pnl,outcome) values($1,$2,$3,'CLOSED','BUY',clock_timestamp()-interval '1 hour',clock_timestamp(),1.005,1.005,'WIN'),($1,$2,$3,'CLOSED','BUY',clock_timestamp()-interval '1 hour',clock_timestamp(),-.005,-.005,'LOSS')",[fixtureUser,account.id,instrument]);
  await database.query("insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at) values($1,$2,'DEPOSIT',50,clock_timestamp()),($1,$2,'WITHDRAWAL',-10,clock_timestamp())",[fixtureUser,account.id]);
  await database.query("insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at,is_performance_neutral,classification_reason) values($1,$2,'OTHER',5,clock_timestamp(),false,'Explicit fixture classification')",[fixtureUser,account.id]);
  await database.query("insert into public.account_snapshots(user_id,account_id,captured_at,balance,equity,unrealized_pnl) values($1,$2,clock_timestamp(),999000,1000000,1000)",[fixtureUser,account.id]);
  const accountLedger=content(await modern.callTool({name:"tradeos_accounts_get",arguments:{id:account.id}}));
  assert.equal(accountLedger.closed_trade_net_pnl,"1.00");assert.equal(accountLedger.account_adjustments_total,"45.00");
  assert.equal(accountLedger.derived_balance,"100046.01");assert.equal(accountLedger.closed_trade_count,"2");
  const historyChange=await modern.callTool({name:"tradeos_accounts_patch",arguments:{operationId:randomUUID(),id:account.id,expectedVersion:"2",values:{currency_code:"GBP"}}});
  assert(historyChange.isError && JSON.stringify(historyChange.content).includes("INVALID_REFERENCE"));
  const baselineChange=await modern.callTool({name:"tradeos_accounts_patch",arguments:{operationId:randomUUID(),id:account.id,expectedVersion:"2",values:{starting_balance:"110000"}}});
  assert(baselineChange.isError && JSON.stringify(baselineChange.content).includes("INVALID_REFERENCE"));
  passed("real account tools preserve exact ledger balance, exclude open PnL/snapshots and reject silent financial reinterpretation");
  const accountIds:string[]=[];let accountCursor:string|undefined;
  do {
    const accountPage=content(await modern.callTool({name:"tradeos_accounts_list",arguments:{limit:1,...(accountCursor?{afterId:accountCursor}:{})}}));
    const accountRows=accountPage.records as Array<{id:string;user_id:string}>;assert(accountRows.every(item=>item.user_id===fixtureUser));
    accountIds.push(...accountRows.map(item=>item.id));accountCursor=accountPage.nextCursor as string|undefined;assert(accountIds.length<100);
  } while(accountCursor);
  assert.deepEqual(accountIds,(await database.query("select id::text from public.trading_accounts where user_id=$1 order by id",[fixtureUser])).rows.map(item=>item.id));
  passed("owner-scoped account pagination returns every account without mixing account currencies");

  stage="browser configuration regression and simultaneous edit";
  await page.goto(`${origin}/strategies`);
  const edit=page.locator(`#edit-strategy-${strategy.id}`);await edit.locator("summary").click();
  assert.equal(await edit.locator('input[name="expectedVersion"]').inputValue(),"2");
  const concurrent=record(await modern.callTool({name:"tradeos_configuration_patch",arguments:{entity:"STRATEGY",operationId:randomUUID(),id:strategy.id,expectedVersion:"2",values:{name:"Newer MCP change"}}}));
  assert.equal(concurrent.record_version,"3");
  await edit.getByLabel("Strategy name",{exact:true}).fill("Stale browser change");
  await edit.getByRole("button",{name:"Save strategy",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"This record changed"}).waitFor();
  assert.equal(content(await modern.callTool({name:"tradeos_configuration_get",arguments:{entity:"STRATEGY",id:strategy.id}})).name,"Newer MCP change");
  await page.goto(`${origin}/strategies`);
  const createForm=page.locator('form').filter({has:page.getByRole("button",{name:"Create strategy",exact:true})});
  await createForm.getByLabel("Strategy name",{exact:true}).fill("Browser shared service");
  await createForm.getByRole("button",{name:"Create strategy",exact:true}).click();
  await page.getByText("Strategy created.",{exact:true}).waitFor();
  assert.equal((await database.query("select count(*)::integer as count from private.application_mutation_audits a join private.application_operations o on o.id=a.operation_receipt_id where a.actor_user_id=$1 and a.actor_type='BROWSER' and o.operation_kind='CONFIGURATION_CREATE'",[fixtureUser])).rows[0].count,1);
  passed("normal browser creation uses the shared audited writer; stale browser edits cannot overwrite MCP changes");

  stage="browser account concurrency and shared service";
  await page.goto(`${origin}/accounts`);
  const accountEdit=page.locator("details").filter({has:page.locator(`input[name="id"][value="${account.id}"]`)});
  await accountEdit.locator("summary").click();assert.equal(await accountEdit.locator('input[name="expectedVersion"]').inputValue(),"2");
  const newerAccount=record(await modern.callTool({name:"tradeos_accounts_patch",arguments:{operationId:randomUUID(),id:account.id,expectedVersion:"2",values:{name:"Newer MCP account"}}}));
  assert.equal(newerAccount.record_version,"3");await accountEdit.getByLabel("Account name",{exact:true}).fill("Stale browser account");
  await accountEdit.getByRole("button",{name:"Save account",exact:true}).click();await page.getByRole("alert").filter({hasText:"This record changed"}).waitFor();
  await page.goto(`${origin}/accounts`);await accountEdit.locator("summary").click();
  await accountEdit.getByLabel("Notes",{exact:true}).fill("Browser shared account workflow");
  await accountEdit.getByRole("button",{name:"Save account",exact:true}).click();await page.getByText("Account updated.",{exact:true}).waitFor();
  const savedAccount=content(await modern.callTool({name:"tradeos_accounts_get",arguments:{id:account.id}}));
  assert.equal(savedAccount.name,"Newer MCP account");assert.equal(savedAccount.notes,"Browser shared account workflow");assert.equal(savedAccount.derived_balance,"100046.01");
  passed("browser account edits share the audited service, reject stale versions and preserve authoritative balance");


  stage="account events and lifecycle";
  const cashOperation=randomUUID(),occurredAt="2026-10-08T00:00:00Z";
  const cashInput={operationId:cashOperation,accountId:account.id,type:"WITHDRAWAL",amount:"10.005",occurredAt};
  const cashResult=await modern.callTool({name:"tradeos_adjustment_create",arguments:cashInput});
  assert.equal(record(cashResult).amount,"-10.01");
  assert.deepEqual(content(await legacy.callTool({name:"tradeos_adjustment_create",arguments:cashInput})),content(cashResult));
  const other=record(await modern.callTool({name:"tradeos_adjustment_create",arguments:{operationId:randomUUID(),accountId:account.id,type:"OTHER",amount:"5",occurredAt,isPerformanceNeutral:true,classificationReason:"Cash-only adjustment"}}));
  const classified=record(await modern.callTool({name:"tradeos_adjustment_classify",arguments:{operationId:randomUUID(),id:other.id,expectedVersion:"1",isPerformanceNeutral:false,reason:"Reviewed economic treatment"}}));
  assert.equal(classified.record_version,"2");assert.equal(classified.amount,"5.00");assert.equal(classified.is_performance_neutral,false);
  const classificationHistory=content(await modern.callTool({name:"tradeos_account_events_list",arguments:{accountId:account.id,kind:"CLASSIFICATIONS"}}));
  assert((classificationHistory.records as unknown[]).length>=1);
  const snapshot=record(await modern.callTool({name:"tradeos_snapshot_record",arguments:{operationId:randomUUID(),accountId:account.id,balance:"1000",unrealizedPnl:"0.2",capturedAt:occurredAt}}));
  assert.equal(snapshot.equity,"1000.20000000");
  const badSnapshot=await modern.callTool({name:"tradeos_snapshot_record",arguments:{operationId:randomUUID(),accountId:account.id,balance:"1000",equity:"1001",unrealizedPnl:"5",capturedAt:occurredAt}});
  assert(badSnapshot.isError&&JSON.stringify(badSnapshot.content).includes("INVALID_REFERENCE"));
  const challenge=record(await modern.callTool({name:"tradeos_accounts_create",arguments:{operationId:randomUUID(),values:{...accountInput.values,name:"Lifecycle challenge",account_type:"PROP_CHALLENGE"}}}));
  const passedChallenge=record(await modern.callTool({name:"tradeos_account_transition",arguments:{operationId:randomUUID(),accountId:challenge.id,expectedVersion:"1",status:"PASSED",effectiveAt:occurredAt,reason:"Confirmed challenge completion"}}));
  assert.equal(passedChallenge.status,"PASSED");
  const funded=record(await modern.callTool({name:"tradeos_account_link_funded",arguments:{operationId:randomUUID(),accountId:challenge.id,expectedVersion:passedChallenge.record_version,name:"Separate funded account",startingBalance:"10000",platform:"OTHER",startedAt:"2026-10-08"}}));
  assert.equal(funded.previous_account_id,challenge.id);assert.equal(funded.account_type,"FUNDED");
  passed("cash retries, auditable OTHER classification, snapshot equation and separate funded lifecycle work through real HTTP");

  stage="canonical trade workflow";
  const referencePage=content(await modern.callTool({name:"tradeos_trade_instruments",arguments:{limit:100}}));
  assert((referencePage.records as Array<Record<string,unknown>>).some(item=>item.id===instrument));
  const tradeOperation=randomUUID();
  const tradeInput={operationId:tradeOperation,values:{account_id:funded.id,instrument_id:instrument,direction:"BUY",status:"OPEN",opened_at:"2026-10-08T01:00:21.333Z",planned_stop_loss:"1.08",planned_risk_amount:"100"},
    plannedTargets:[{label:"Partial target",planned_price:"1.10",planned_close_percentage:"50"}]};
  const tradeCreation=await modern.callTool({name:"tradeos_trades_create",arguments:tradeInput});let canonical=record(tradeCreation);
  assert.equal(canonical.status,"OPEN");assert.equal(canonical.net_pnl,null);
  assert.deepEqual(content(await legacy.callTool({name:"tradeos_trades_create",arguments:tradeInput})),content(tradeCreation));
  const getCanonical=async()=>content(await modern.callTool({name:"tradeos_trades_get",arguments:{id:canonical.id}}));
  const badPlan=await modern.callTool({name:"tradeos_trades_patch",arguments:{operationId:randomUUID(),id:canonical.id,expectedVersion:canonical.record_version,values:{planned_stop_loss:"1.09"}}});
  assert(badPlan.isError&&JSON.stringify(badPlan.content).includes("INVALID_REFERENCE"));
  canonical=record(await modern.callTool({name:"tradeos_trade_correct_plan",arguments:{operationId:randomUUID(),id:canonical.id,expectedVersion:canonical.record_version,fieldName:"planned_stop_loss",newValue:"1.081",reason:"Recorded stop data correction"}}));
  canonical=record(await modern.callTool({name:"tradeos_trade_management",arguments:{operationId:randomUUID(),id:canonical.id,expectedVersion:canonical.record_version,event:{event_type:"STOP_MOVED",occurred_at:"2026-10-08T02:00:00Z",price:"1.085",notes:"Actual break-even stop movement"}}}));
  assert.equal(canonical.planned_stop_loss,"1.0810000000");assert.equal(canonical.actual_stop_loss,"1.0850000000");
  const aggregate=await getCanonical();const target=(aggregate.targets as Array<Record<string,unknown>>)[0];
  canonical=record(await modern.callTool({name:"tradeos_trade_targets",arguments:{operationId:randomUUID(),id:canonical.id,expectedVersion:canonical.record_version,executedTargets:[{id:target.id,actual_close_percentage:"50",actual_fill_price:"1.1",pnl_contribution:"25",hit_at:"2026-10-08T02:30:00Z"}]}}));
  assert.equal(canonical.net_pnl,null);
  const badReviewOperation=randomUUID();
  const badClose=await modern.callTool({name:"tradeos_trades_patch",arguments:{operationId:badReviewOperation,id:canonical.id,expectedVersion:canonical.record_version,values:{status:"CLOSED",closed_at:"2026-10-08T03:00:00Z",gross_pnl:"10.20",commission:"0.1",swap:"0.1"},reviews:{psychology:{values:{fear_influenced:false},complete:true}}}});
  assert(badClose.isError);
  const stillOpen=(await getCanonical()).trade as Record<string,unknown>;
  assert.equal(stillOpen.status,"OPEN");assert.equal(stillOpen.record_version,canonical.record_version);
  assert.equal(content(await modern.callTool({name:"tradeos_operation_status",arguments:{operationId:badReviewOperation}})).status,"UNKNOWN");
  canonical=record(await modern.callTool({name:"tradeos_trades_patch",arguments:{operationId:randomUUID(),id:canonical.id,expectedVersion:canonical.record_version,values:{status:"CLOSED",closed_at:"2026-10-08T03:00:00Z",gross_pnl:"10.20",commission:"0.1",swap:"0.1"}}}));
  assert.equal(canonical.net_pnl,"10.00");assert.equal(canonical.outcome,"PARTIAL_WIN");assert.equal(canonical.actual_r,"0.10000000");
  canonical=record(await modern.callTool({name:"tradeos_trade_review",arguments:{operationId:randomUUID(),id:canonical.id,expectedVersion:canonical.record_version,reviews:{psychology:{values:{fear_influenced:false,greed_influenced:false,fomo_influenced:true},complete:true},rules:{results:[{trading_rule_id:rule.id,complied:true,notes:"Reviewed risk limit"}],complete:true}}}}));
  const reviewed=await getCanonical();
  assert((reviewed.psychology as Record<string,unknown>).reviewed_at);
  assert.equal((reviewed.ruleReviewItems as unknown[]).length,1);assert.equal((reviewed.corrections as unknown[]).length,1);
  assert.equal((await database.query("select count(*)::integer as count from public.trades where user_id=$1 and id=$2",[fixtureUser,canonical.id])).rows[0].count,1);
  passed("canonical retry, locked plan, actual management, partial closure, exact financials and immutable reviews work atomically");

  stage="shared computed reporting over authenticated MCP";
  const reportScope={filters:{account:funded.id},timezone:"UTC"};
  const performance=content(await modern.callTool({name:"tradeos_analytics_performance",arguments:reportScope}));
  assert.deepEqual(performance,content(await legacy.callTool({name:"tradeos_analytics_performance",arguments:reportScope})));
  const money=(performance.currencies as Array<Record<string,unknown>>)[0];
  assert.equal((money.metrics as Record<string,unknown>).netProfit,"10.00");assert.equal((performance.unitlessMetrics as Record<string,unknown>).rSample,1);
  assert(!Object.hasOwn(performance.unitlessMetrics as object,"netProfit"));assert(!Object.hasOwn(money.curve as object,"points"));
  const summary=content(await modern.callTool({name:"tradeos_journal_summary",arguments:{kind:"DAILY",accountId:funded.id,period:"2026-10-08",timezone:"UTC"}}));
  assert.equal((summary.summary as Record<string,unknown>).netPnl,"10.00");assert.equal((summary.outcomes as Record<string,unknown>).PARTIAL_WIN,1);
  const calendar=content(await modern.callTool({name:"tradeos_calendar",arguments:{accountId:funded.id,month:"2026-10",timezone:"UTC"}}));
  const day=(calendar.currencies as Array<{days:Array<Record<string,unknown>>}>)[0].days[0];assert.equal(day.date,"2026-10-08");
  assert.equal((day.summary as Record<string,unknown>).rSample,1);
  const behavior=content(await modern.callTool({name:"tradeos_analytics_behavior",arguments:reportScope}));
  assert.equal(behavior.psychologyReviewedTrades,1);assert.equal(behavior.ruleReviewedTrades,1);assert.equal(behavior.executionReviewedTrades,0);
  passed("all reporting MCP tools return hand-calculated 10.00 partial win, 0.10R and explicit reviewed samples through modern/legacy OAuth");
  const exported=content(await modern.callTool({name:"tradeos_journal_export",arguments:{filters:{account:funded.id,status:"CLOSED"},timezone:"UTC"}}));
  assert.equal(exported.recordCount,1);const [csvHeader,csvTrade]=String(exported.csv).replace(/^\uFEFF/,"").split("\r\n").map(line=>line.split(","));
  assert.equal(csvTrade[csvHeader.indexOf("account_id")],funded.id);assert.equal(csvTrade[csvHeader.indexOf("id")],canonical.id);assert.equal(csvTrade[csvHeader.indexOf("net_pnl")],"10");
  // Downloads are checked through the authenticated browser context request so
  // navigation never leaves an unhandled attachment event.
  const browserCsv=await page.request.get(`${origin}/trades/export?account=${funded.id}&status=CLOSED&page=99`);
  assert.equal(browserCsv.status(),200);assert.equal((await browserCsv.text()).replace(/^\uFEFF/,""),String(exported.csv).replace(/^\uFEFF/,""));
  await page.goto(`${origin}/analytics?account=${funded.id}`);
  assert.equal(await page.locator(`select[name="account"] option[value="${account.id}"]`).count(),1);
  assert.equal(await page.locator(`select[name="account"] option[value="${funded.id}"]`).count(),1);
  passed("browser and MCP CSV exports match exactly and ignore pagination; selected-account filters retain other owned choices");

  stage="snapshot-aware balance curve paging";
  const curveRequest={currencyCode:"USD",filters:{account:funded.id},timezone:"UTC",pageSize:1};
  const curveFirst=content(await modern.callTool({name:"tradeos_analytics_balance_curve",arguments:curveRequest}));
  assert.equal(curveFirst.totalPoints,2);assert.equal(curveFirst.currentBalance,money.currentBalance);assert(curveFirst.nextCursor);
  const curveNextRequest={...curveRequest,cursor:curveFirst.nextCursor};
  const curveSecond=content(await legacy.callTool({name:"tradeos_analytics_balance_curve",arguments:curveNextRequest}));
  assert.deepEqual(curveSecond,content(await modern.callTool({name:"tradeos_analytics_balance_curve",arguments:curveNextRequest})));
  assert.equal(curveSecond.snapshotId,curveFirst.snapshotId);assert.equal(curveSecond.nextCursor,null);
  assert.deepEqual((curveSecond.points as Array<Record<string,unknown>>).map(point=>[point.cumulativePnl,point.cumulativeR,point.cumulativeRSample]),[["10.00","0.10000000",1]]);
  const foreignCurve=await modern.callTool({name:"tradeos_analytics_balance_curve",arguments:{...curveRequest,filters:{account:randomUUID()}}});
  assert(foreignCurve.isError&&JSON.stringify(foreignCurve.content).includes("NOT_FOUND"));
  passed("modern/legacy bounded balance pages replay exactly, preserve full balance/0.10R sample and reject unavailable account scope");

  const curveAccount=record(await modern.callTool({name:"tradeos_accounts_create",arguments:{operationId:randomUUID(),values:{...accountInput.values,name:"MCP curve fault fixture",starting_balance:"110000"}}}));
  await database.query("insert into public.trades(user_id,account_id,instrument_id,status,direction,opened_at,closed_at,gross_pnl,net_pnl,outcome) values($1,$2,$3,'CLOSED','BUY','2026-09-02T08:00:00Z','2026-09-02T10:00:00Z',-5000,-5000,'LOSS'),($1,$2,$3,'CLOSED','BUY','2026-09-04T08:00:00Z','2026-09-04T10:00:00Z',50,50,'WIN')",[fixtureUser,curveAccount.id,instrument]);
  await modern.callTool({name:"tradeos_adjustment_create",arguments:{operationId:randomUUID(),accountId:curveAccount.id,type:"WITHDRAWAL",amount:"-10000",occurredAt:"2026-09-03T10:00:00Z"}}).then(content);
  const faultScope={currencyCode:"USD",filters:{account:curveAccount.id},timezone:"UTC",pageSize:1};
  const faultFirst=content(await modern.callTool({name:"tradeos_analytics_balance_curve",arguments:faultScope}));
  assert.equal(faultFirst.currentBalance,"95050.00");assert.equal((faultFirst.drawdown as Record<string,unknown>).maximumAmount,"5000.00");assert(faultFirst.nextCursor);
  const faultPoints:Array<Record<string,unknown>>=[...(faultFirst.points as Array<Record<string,unknown>>)];let faultCursor:unknown=faultFirst.nextCursor;
  while(faultCursor){const next=content(await legacy.callTool({name:"tradeos_analytics_balance_curve",arguments:{...faultScope,cursor:faultCursor}}));faultPoints.push(...next.points as Array<Record<string,unknown>>);faultCursor=next.nextCursor;assert(faultPoints.length<=4);}
  assert.equal(faultPoints.length,4);assert.deepEqual(faultPoints.slice(1).map(point=>point.drawdownAmount),["5000.00","5000.00","4950.00"]);
  const periodCurve=content(await modern.callTool({name:"tradeos_analytics_balance_curve",arguments:{...faultScope,filters:{account:curveAccount.id,from:"2026-09-04",to:"2026-09-04"},timezone:"Africa/Kampala"}}));
  assert.equal((periodCurve.points as Array<Record<string,unknown>>)[0].occurredAt,"2026-09-03T21:00:00.000000000Z");
  assert.equal((periodCurve.points as Array<Record<string,unknown>>)[0].drawdownAmount,"5000.00");
  passed("real SQL-backed curve preserves 5000.00 drawdown across withdrawal, 95050.00 balance and pre-period high-water basis/local midnight");

  await modern.callTool({name:"tradeos_adjustment_create",arguments:{operationId:randomUUID(),accountId:curveAccount.id,type:"DEPOSIT",amount:"1",occurredAt:"2026-09-05T10:00:00Z"}}).then(content);
  const staleCurve=await legacy.callTool({name:"tradeos_analytics_balance_curve",arguments:{...faultScope,cursor:faultFirst.nextCursor}});
  assert(staleCurve.isError&&JSON.stringify(staleCurve.content).includes("CURVE_CHANGED"));
  const malformedCurve=await modern.callTool({name:"tradeos_analytics_balance_curve",arguments:{...faultScope,cursor:"e30"}});
  assert(malformedCurve.isError&&JSON.stringify(malformedCurve.content).includes("INVALID_CURSOR"));
  passed("committed concurrent cash changes reject stale continuation; malformed cursor is an explicit safe tool error");

  stage="reference tools and simultaneous retries";
  const tagOperation=randomUUID();
  const tagInput={entity:"TAG",operationId:tagOperation,values:{name:"FOMO fixture",color:"#aabbcc"}};
  const tagRacers=await Promise.all([modern,legacy].map(client=>client.callTool({name:"tradeos_references_create",arguments:tagInput})));
  assert.deepEqual(content(tagRacers[0]),content(tagRacers[1]));let tag=record(tagRacers[0]);
  assert.equal(tag.normalized_name,"fomo fixture");assert.equal(tag.record_version,"1");
  assert.equal((await database.query("select count(*)::integer as count from private.application_operations where owner_id=$1 and operation_id=$2",[fixtureUser,tagOperation])).rows[0].count,1);
  const duplicateTag=await modern.callTool({name:"tradeos_references_create",arguments:{...tagInput,operationId:randomUUID(),values:{name:"fomo FIXTURE",color:null}}});
  assert(duplicateTag.isError&&JSON.stringify(duplicateTag.content).includes("DUPLICATE_NAME"));
  const tagConflict=await modern.callTool({name:"tradeos_references_create",arguments:{...tagInput,values:{name:"Changed retry",color:null}}});
  assert(tagConflict.isError&&JSON.stringify(tagConflict.content).includes("OPERATION_CONFLICT"));
  assert.equal(content(await modern.callTool({name:"tradeos_operation_status",arguments:{operationId:tagOperation}})).status,"COMMITTED");
  tag=record(await modern.callTool({name:"tradeos_references_patch",arguments:{entity:"TAG",operationId:randomUUID(),id:tag.id,expectedVersion:tag.record_version,values:{color:null}}}));
  assert.equal(tag.name,"FOMO fixture");assert.equal(tag.color,null);
  passed("reference retries are one durable effect; case-insensitive duplicates, changed payloads and nullable clearing work");

  stage="tag association concurrency";
  const tagLink={operationId:randomUUID(),tradeId:canonical.id,tagId:tag.id,expectedVersion:canonical.record_version,expectedTagVersion:tag.record_version};
  const links=await Promise.all([modern,legacy].map(client=>client.callTool({name:"tradeos_trade_tags_assign",arguments:tagLink})));
  assert.deepEqual(content(links[0]),content(links[1]));
  let tradeVersion=content(links[0]).tradeVersion;
  assert.equal((await database.query("select count(*)::integer as count from public.trade_tags where trade_id=$1 and tag_id=$2",[canonical.id,tag.id])).rows[0].count,1);
  const staleLink=await modern.callTool({name:"tradeos_trade_tags_remove",arguments:{...tagLink,operationId:randomUUID()}});
  assert(staleLink.isError&&JSON.stringify(staleLink.content).includes("VERSION_CONFLICT"));
  const labels=content(await modern.callTool({name:"tradeos_trade_tags_list",arguments:{tradeId:canonical.id,limit:1}})).records as Array<Record<string,unknown>>;
  assert.equal(labels[0].id,tag.id);assert.equal(labels[0].record_version,tag.record_version);
  passed("simultaneous assignment has one association, updates trade version and rejects stale removal");

  stage="browser tag regression";
  await page.goto(`${origin}/trades`);
  const tagCreateForm=page.locator("form").filter({has:page.getByRole("button",{name:"Create tag",exact:true})});
  assert(await tagCreateForm.locator('input[name="operationId"]').inputValue());
  await tagCreateForm.getByLabel("New tag",{exact:true}).fill("Browser tag fixture");
  await tagCreateForm.getByRole("button",{name:"Create tag",exact:true}).click();
  stage="browser tag creation confirmation";
  await page.getByText("Tag created.",{exact:true}).waitFor();
  const tagDetails=page.locator("details").filter({has:page.getByText("Edit FOMO fixture",{exact:true})});
  await tagDetails.locator("summary").click();
  assert.equal(await tagDetails.locator('input[name="expectedVersion"]').inputValue(),tag.record_version);
  tag=record(await modern.callTool({name:"tradeos_references_patch",arguments:{entity:"TAG",operationId:randomUUID(),id:tag.id,expectedVersion:tag.record_version,values:{name:"Newer MCP tag"}}}));
  await tagDetails.getByLabel("Display name",{exact:true}).fill("Stale browser tag");
  await tagDetails.getByRole("button",{name:"Save tag",exact:true}).click();
  stage="browser stale tag conflict confirmation";
  await page.getByRole("alert").filter({hasText:"This record changed"}).waitFor();
  assert.equal(content(await modern.callTool({name:"tradeos_references_get",arguments:{entity:"TAG",id:tag.id}})).name,"Newer MCP tag");
  await page.goto(`${origin}/trades/${canonical.id}`);
  await page.getByRole("button",{name:"Newer MCP tag ×",exact:true}).click();
  stage="browser tag removal confirmation";
  await page.getByText("Tag removed from trade.",{exact:true}).waitFor();
  stage="browser tag selector";
  const tagSelect=page.getByRole("combobox",{name:/^Assign tag/});await tagSelect.click();
  await page.getByRole("option",{name:"Newer MCP tag",exact:true}).click();
  await page.getByRole("button",{name:"Assign",exact:true}).click();stage="browser tag assignment confirmation";await page.getByText("Tag assigned.",{exact:true}).waitFor();
  const taggedCanonical=(await getCanonical()).trade as Record<string,unknown>;tradeVersion=taggedCanonical.record_version;
  stage="tag financial regression";
  assert.equal(taggedCanonical.net_pnl,"10.00");assert.equal(taggedCanonical.outcome,"PARTIAL_WIN");
  const beforeTags=reviewed.trade as Record<string,unknown>;
  for(const field of ["gross_pnl","commission","swap","other_fees","trading_credits","net_pnl","actual_r","outcome"])assert.equal(taggedCanonical[field],beforeTags[field]);
  passed("browser tag create, stale edit rejection, remove and assign use the same audited services without changing financials");

  stage="tag archival and historical references";
  tag=record(await modern.callTool({name:"tradeos_references_archive",arguments:{entity:"TAG",operationId:randomUUID(),id:tag.id,expectedVersion:tag.record_version,reason:"Retire fixture label, retain history"}}));
  assert(tag.archived_at);
  assert.equal((content(await modern.callTool({name:"tradeos_trade_tags_list",arguments:{tradeId:canonical.id}})).records as unknown[]).length,1);
  const archiveAssign=await modern.callTool({name:"tradeos_trade_tags_assign",arguments:{...tagLink,operationId:randomUUID(),expectedVersion:tradeVersion,expectedTagVersion:tag.record_version}});
  assert(archiveAssign.isError&&JSON.stringify(archiveAssign.content).includes("INVALID_REFERENCE"));
  await page.goto(`${origin}/trades/${canonical.id}`);await page.getByRole("button",{name:"Newer MCP tag ×",exact:true}).click();
  await page.getByText("Tag removed from trade.",{exact:true}).waitFor();
  passed("archived tags remain historical labels, reject new assignment and allow audited browser removal");

  stage="owned instruments and immutable specification";
  const owned=record(await modern.callTool({name:"tradeos_references_create",arguments:{entity:"INSTRUMENT",operationId:randomUUID(),values:{symbol:"FIXTUREm",display_name:"Owned precision fixture",asset_class:"FOREX",base_currency:"EUR",quote_currency:"USD",pip_size:"0.0000000001",price_precision:10,active:true}}}));
  assert.equal(owned.pip_size,"0.0000000001");assert.equal(owned.user_id,fixtureUser);
  const global=content(await modern.callTool({name:"tradeos_references_get",arguments:{entity:"INSTRUMENT",id:instrument}}));assert.equal(global.user_id,null);
  const globalEdit=await modern.callTool({name:"tradeos_references_patch",arguments:{entity:"INSTRUMENT",operationId:randomUUID(),id:instrument,expectedVersion:global.record_version,values:{display_name:"Unauthorized global change"}}});assert(globalEdit.isError);
  const ownedTrade=record(await modern.callTool({name:"tradeos_trades_create",arguments:{operationId:randomUUID(),values:{account_id:jpy.id,instrument_id:owned.id,direction:"BUY",status:"DRAFT"}}}));
  const specEdit=await modern.callTool({name:"tradeos_references_patch",arguments:{entity:"INSTRUMENT",operationId:randomUUID(),id:owned.id,expectedVersion:owned.record_version,values:{pip_size:"0.01"}}});
  assert(specEdit.isError&&JSON.stringify(specEdit.content).includes("INVALID_REFERENCE"));
  const archivedInstrument=record(await modern.callTool({name:"tradeos_references_archive",arguments:{entity:"INSTRUMENT",operationId:randomUUID(),id:owned.id,expectedVersion:owned.record_version,reason:"Retire referenced precision fixture"}}));
  assert.equal(archivedInstrument.active,false);
  const instrumentIds:string[]=[];let instrumentCursor:string|undefined;
  do {
    const instrumentPage=content(await modern.callTool({name:"tradeos_references_list",arguments:{entity:"INSTRUMENT",limit:7,...(instrumentCursor?{afterId:instrumentCursor}:{})}}));
    const rows=instrumentPage.records as Array<{id:string;user_id:string|null}>;assert(rows.every(row=>row.user_id===null||row.user_id===fixtureUser));
    instrumentIds.push(...rows.map(row=>row.id));instrumentCursor=instrumentPage.nextCursor as string|undefined;assert(instrumentIds.length<300);
  } while(instrumentCursor);
  assert.deepEqual(instrumentIds,(await database.query("select id::text from public.instruments where (user_id is null or user_id=$1) and archived_at is null order by id",[fixtureUser])).rows.map(row=>row.id));
  assert(!instrumentIds.includes(owned.id as string));
  await page.goto(`${origin}/trades/${ownedTrade.id}`);await page.getByRole("heading",{name:"FIXTUREm · BUY",exact:true}).waitFor();
  passed("owned exact instrument specs, global read-only access, complete paging and referenced archival preserve historical display");

  stage="goals and prop SDK coverage";
  const goalOperation=randomUUID();
  const customInput={operationId:goalOperation,accountId:funded.id,values:{title:"MCP custom evidence",goal_type:"CUSTOM",target_value:"25.00000001",target_date:null,custom_unit:"hours",notes:null,active:true}};
  const customCreation=await modern.callTool({name:"tradeos_goals_create",arguments:customInput});let custom=record(customCreation);
  assert.equal(custom.target_value,"25.00000001");
  assert.deepEqual(content(await legacy.callTool({name:"tradeos_goals_create",arguments:customInput})),content(customCreation));
  assert.equal(content(await modern.callTool({name:"tradeos_goals_get",arguments:{id:custom.id}})).record_version,"1");
  assert.equal((content(await modern.callTool({name:"tradeos_goals_list",arguments:{accountId:funded.id,limit:1}})).records as unknown[]).length,1);
  const evidenceInput={operationId:randomUUID(),goalId:custom.id,expectedVersion:"1",progressValue:"5",recordedAt:"2026-10-08T05:00:00Z"};
  const firstEvidence=await modern.callTool({name:"tradeos_goal_progress_record",arguments:evidenceInput});
  assert.equal(content(firstEvidence).goalVersion,"2");
  assert.deepEqual(content(await legacy.callTool({name:"tradeos_goal_progress_record",arguments:evidenceInput})),content(firstEvidence));
  const staleGoal=await modern.callTool({name:"tradeos_goals_patch",arguments:{id:custom.id,operationId:randomUUID(),expectedVersion:"1",values:{title:"Stale"}}});
  assert(staleGoal.isError && JSON.stringify(staleGoal.content).includes("VERSION_CONFLICT"));
  custom=record(await modern.callTool({name:"tradeos_goals_patch",arguments:{id:custom.id,operationId:randomUUID(),expectedVersion:"2",values:{notes:"Explicit evidence"}}}));
  assert.equal(custom.record_version,"3");assert.equal(custom.title,"MCP custom evidence");
  passed("goals SDK create/read/list/patch, cross-client evidence retry and stale edits preserve exact targets and history");

  const propInput={operationId:randomUUID(),accountId:funded.id,expectedVersion:"0",values:{firm_name:"MCP configured firm",drawdown_type:"STATIC",trading_day_timezone:"UTC",profitable_day_min_pnl:"0",profit_target_mode:"PERCENT",profit_target_value:"10"}};
  const propCreation=await modern.callTool({name:"tradeos_prop_save",arguments:propInput});
  assert.equal(record(propCreation).record_version,"1");
  assert.deepEqual(content(await legacy.callTool({name:"tradeos_prop_save",arguments:propInput})),content(propCreation));
  assert.equal((content(await modern.callTool({name:"tradeos_prop_get",arguments:{accountId:funded.id}})).record as Record<string,unknown>).firm_name,"MCP configured firm");
  const progress=content(await modern.callTool({name:"tradeos_progress_get",arguments:{accountId:funded.id}}));
  assert.equal(progress.netProfit,"10.00");assert.equal(progress.rSample,1);assert.equal(progress.closedTrades,1);
  assert.equal((progress.profitTarget as Record<string,unknown>).percentage,"1.00");
  assert.equal((progress.goals as Array<Record<string,unknown>>)[0].currentValue,"5");
  passed("prop SDK save/get/retry and complete shared metrics reproduce closed profit10.00, R sample1 and target1.00%");

  stage="browser goal progress and archive";
  await page.goto(`${origin}/goals?account=${funded.id}`);
  const evidenceForm=page.locator("form").filter({has:page.getByRole("button",{name:"Append progress event",exact:true})});
  await evidenceForm.locator('fieldset[data-mutation-ready="true"]').waitFor();
  await evidenceForm.locator('input[name="progressValue"]').fill("10");
  await evidenceForm.getByLabel("Recorded at (UTC)",{exact:true}).fill("2026-10-08T06:00");
  await evidenceForm.getByRole("button",{name:"Append progress event",exact:true}).click();
  await page.getByText("Custom progress recorded.",{exact:true}).waitFor();
  const afterEvidence=content(await modern.callTool({name:"tradeos_progress_get",arguments:{accountId:funded.id}}));
  assert.equal((afterEvidence.goals as Array<Record<string,unknown>>)[0].currentValue,"10");
  assert.equal((content(await modern.callTool({name:"tradeos_goal_progress_list",arguments:{goalId:custom.id,limit:100}})).records as unknown[]).length,2);
  if(await page.locator("details").filter({has:page.getByText("Edit or archive goal",{exact:true})}).getAttribute("open")===null)await page.getByText("Edit or archive goal",{exact:true}).click();
  const goalEdit=page.locator("form").filter({has:page.getByRole("button",{name:"Save goal changes",exact:true})});
  await goalEdit.locator('fieldset[data-mutation-ready="true"]').waitFor();
  await goalEdit.getByLabel("Goal title",{exact:true}).fill("Browser amended evidence");
  await goalEdit.getByRole("button",{name:"Save goal changes",exact:true}).click();
  await page.getByText("Goal updated.",{exact:true}).waitFor();
  assert.equal(content(await modern.callTool({name:"tradeos_goals_get",arguments:{id:custom.id}})).title,"Browser amended evidence");
  if(await page.locator("details").filter({has:page.getByText("Edit or archive goal",{exact:true})}).getAttribute("open")===null)await page.getByText("Edit or archive goal",{exact:true}).click();
  const goalArchive=page.locator("form").filter({has:page.getByRole("button",{name:"Archive goal",exact:true})});
  await goalArchive.locator('fieldset[data-mutation-ready="true"]').waitFor();
  await goalArchive.getByLabel("Archive reason",{exact:true}).fill("Completed research milestone");
  await goalArchive.getByRole("button",{name:"Archive goal",exact:true}).click();
  await page.getByText("Goal archived. Progress evidence is preserved.",{exact:true}).waitFor();
  assert(content(await modern.callTool({name:"tradeos_goals_get",arguments:{id:custom.id}})).archived_at);
  assert.equal((content(await modern.callTool({name:"tradeos_goal_progress_list",arguments:{goalId:custom.id}})).records as unknown[]).length,2);
  passed("browser custom evidence is a current value, not an increment; edit/archive preserve both observations");

  stage="browser goal create and prop save";
  const createGoalForm=page.locator("form").filter({has:page.getByRole("button",{name:"Create goal",exact:true})});
  await createGoalForm.locator('fieldset[data-mutation-ready="true"]').waitFor();
  await createGoalForm.getByLabel("Title",{exact:true}).fill("Browser research sample");
  await createGoalForm.getByRole("combobox",{name:/^Goal type/}).click();
  await page.getByRole("option",{name:"TOTAL TRADES",exact:true}).click();
  await createGoalForm.getByLabel("Target value",{exact:true}).fill("100");
  await createGoalForm.getByRole("button",{name:"Create goal",exact:true}).click();
  await page.getByText("Goal created.",{exact:true}).waitFor();
  assert((content(await modern.callTool({name:"tradeos_goals_list",arguments:{accountId:funded.id}})).records as Array<Record<string,unknown>>).some(item=>item.title==="Browser research sample"));
  const moneyGoal=record(await modern.callTool({name:"tradeos_goals_create",arguments:{operationId:randomUUID(),accountId:funded.id,values:{title:"Currency display fixture",goal_type:"ACCOUNT_BALANCE",target_value:"10001.005",target_date:null,custom_unit:null,notes:null,active:true}}}));
  assert.equal(moneyGoal.target_value,"10001.01000000");
  await page.goto(`${origin}/goals?account=${funded.id}`);
  await page.getByText("Target USD 10001.01",{exact:true}).waitFor();
  passed("monetary goal targets normalize half-up and display at account precision rather than numeric storage scale");
  await page.goto(`${origin}/prop?account=${funded.id}`);
  const propForm=page.locator("form").filter({has:page.getByRole("button",{name:"Save configured rules",exact:true})});
  await propForm.locator('fieldset[data-mutation-ready="true"]').waitFor();
  await propForm.getByLabel("Firm name",{exact:true}).fill("Browser explicit firm");
  await propForm.getByRole("button",{name:"Save configured rules",exact:true}).click();
  await page.getByText("Prop rules saved.",{exact:true}).waitFor();
  const browserProp=content(await modern.callTool({name:"tradeos_prop_get",arguments:{accountId:funded.id}})).record as Record<string,unknown>;
  assert.equal(browserProp.firm_name,"Browser explicit firm");assert.equal(browserProp.record_version,"2");
  passed("browser goal create and prop edits use shared audit/version contracts without layout or hydration errors");

  stage="browser account event adapters";
  await page.goto(`${origin}/accounts/${account.id}`);
  const adjustmentForm=page.locator("form").filter({has:page.getByRole("button",{name:"Record adjustment",exact:true})});
  await adjustmentForm.getByRole("combobox",{name:/^Type/}).click();
  await page.getByRole("option",{name:"DEPOSIT",exact:true}).click();
  await adjustmentForm.getByLabel("Amount",{exact:true}).fill("0.1");
  await adjustmentForm.getByLabel("Occurred at",{exact:true}).fill("2026-10-08T04:00");
  await adjustmentForm.getByRole("button",{name:"Record adjustment",exact:true}).click();
  await page.getByText("Account adjustment recorded.",{exact:true}).waitFor();
  await page.goto(`${origin}/prop?account=${challenge.id}`);
  const snapshotForm=page.locator("form").filter({has:page.getByRole("button",{name:"Record snapshot",exact:true})});
  await snapshotForm.locator('fieldset[data-mutation-ready="true"]').waitFor();
  await snapshotForm.getByLabel("Equity",{exact:true}).fill("100010");
  await snapshotForm.getByRole("button",{name:"Record snapshot",exact:true}).click();
  await page.getByText("Account snapshot recorded.",{exact:true}).waitFor();
  passed("browser adjustment and snapshot forms use shared durable workflows without client errors");

  stage="browser canonical trade adapter";
  await page.goto(`${origin}/trades/${canonical.id}/edit`);
  const mainTradeForm=page.locator("form").filter({has:page.locator('input[name="id"]')});
  await mainTradeForm.locator('textarea[name="whatWentWell"]').fill("Browser review through shared atomic workflow");
  await mainTradeForm.getByRole("button",{name:"Save trade",exact:true}).click();
  await page.getByText("Trade saved.",{exact:true}).waitFor();
  const browserReviewed=await getCanonical();
  assert.equal((browserReviewed.review as Record<string,unknown>).what_went_well,"Browser review through shared atomic workflow");
  assert.equal((browserReviewed.trade as Record<string,unknown>).outcome,"PARTIAL_WIN");
  assert.equal((browserReviewed.trade as Record<string,unknown>).opened_at,"2026-10-08T01:00:21.333+00:00");
  passed("browser trade save uses shared transaction and preserves completed review snapshots and financial result");

  stage="browser explicit management history";
  const managementForm=page.locator("form").filter({has:page.getByRole("button",{name:"Record management event",exact:true})});
  await managementForm.getByRole("combobox",{name:/^Management event/}).click();
  await page.getByRole("option",{name:"NOTE",exact:true}).click();
  await managementForm.getByLabel("Occurred at (UTC)",{exact:true}).fill("2026-10-08T04:00");
  await managementForm.getByLabel("What changed and why?",{exact:true}).fill("Reviewed management evidence after complete closure");
  await managementForm.getByRole("button",{name:"Record management event",exact:true}).click();
  await page.getByText("Trade management event recorded. The planned values are unchanged.",{exact:true}).waitFor();
  const managed=await getCanonical();assert.equal((managed.managementEvents as unknown[]).length,2);
  assert.equal((managed.trade as Record<string,unknown>).planned_stop_loss,"1.0810000000");
  passed("explicit browser management appends separate evidence without changing recorded plans");

  stage="browser draft creation";
  await page.goto(`${origin}/trades/new`);
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  await page.getByText("Draft saved.",{exact:true}).waitFor();
  const newDraftId=new URL(page.url()).pathname.split("/")[2];
  const draftAggregate=content(await modern.callTool({name:"tradeos_trades_get",arguments:{id:newDraftId}}));
  assert.equal((draftAggregate.trade as Record<string,unknown>).status,"DRAFT");
  assert.equal((draftAggregate.trade as Record<string,unknown>).net_pnl,null);
  assert.equal((draftAggregate.executionReview as Record<string,unknown>).reviewed_at,null);
  passed("browser creates an incomplete draft atomically without manufacturing realized or reviewed evidence");

  stage="journal reflections across SDK and browser";
  for(const [kind,period,segment,queryKey] of [["DAILY","2026-10-08","daily","date"],["WEEKLY","2026-10-05","weekly","week"],["MONTHLY","2026-10-01","monthly","month"]]) {
    stage=`journal ${kind}: missing read`;
    const key={kind,accountId:account.id,period};
    assert.equal(content(await modern.callTool({name:"tradeos_journals_get",arguments:key})).record,null);
    const journalInput={...key,operationId:randomUUID(),expectedVersion:"0",values:{notes:`MCP ${kind} reflection`,...(kind==="DAILY"?{followed_daily_plan:false}:{})}};
    stage=`journal ${kind}: SDK creation`;
    const created=await modern.callTool({name:"tradeos_journals_save",arguments:journalInput});
    assert.equal(record(created).record_version,"1");
    assert.deepEqual(content(await legacy.callTool({name:"tradeos_journals_save",arguments:journalInput})),content(created));
    const listing=content(await modern.callTool({name:"tradeos_journals_list",arguments:{kind,accountId:account.id,limit:1}}));
    assert.equal((listing.records as unknown[]).length,1);
    stage=`journal ${kind}: browser load`;
    const queryPeriod=kind==="MONTHLY"?period.slice(0,7):period;
    await page.goto(`${origin}/journal/${segment}?account=${account.id}&${queryKey}=${queryPeriod}`);
    const reflection=page.locator('form').filter({has:page.locator('input[name="operationId"]')});
    await reflection.locator('fieldset[data-journal-ready="true"]').waitFor();
    assert.equal(await reflection.locator('input[name="expectedVersion"]').inputValue(),"1");
    stage=`journal ${kind}: browser save`;
    await reflection.locator('textarea[name="notes"]').fill(`Browser ${kind} reflection`);
    assert.equal(await reflection.locator('textarea[name="notes"]').inputValue(),`Browser ${kind} reflection`);
    await reflection.getByRole("button",{name:kind==="DAILY"?"Save daily journal":kind==="WEEKLY"?"Save weekly review":"Save monthly review",exact:true}).click();
    await page.getByText(kind==="DAILY"?"Daily journal saved.":kind==="WEEKLY"?"Weekly review saved.":"Monthly review saved.",{exact:true}).waitFor();
    stage=`journal ${kind}: read after browser save`;
    const saved=content(await modern.callTool({name:"tradeos_journals_get",arguments:key})).record as Record<string,unknown>;
    assert.equal(saved.notes,`Browser ${kind} reflection`);assert.equal(saved.record_version,"2");
    if(kind==="DAILY") {assert.equal(saved.followed_daily_plan,false);assert.equal(saved.stopped_when_required,null);}
    const stale=await modern.callTool({name:"tradeos_journals_save",arguments:{...journalInput,operationId:randomUUID(),expectedVersion:"1"}});
    assert(stale.isError && JSON.stringify(stale.content).includes("VERSION_CONFLICT"));
  }
  passed("all three journal kinds share audited SDK/browser writers, nullable answers, durable retries and stale-version rejection");

  stage="archival and preserved references";
  const archived=record(await modern.callTool({name:"tradeos_configuration_archive",arguments:{entity:"STRATEGY",operationId:randomUUID(),id:strategy.id,expectedVersion:"3",reason:"Retire referenced methodology"}}));
  assert.equal(archived.active,false);assert(archived.archived_at);
  assert.equal(content(await modern.callTool({name:"tradeos_configuration_get",arguments:{entity:"SETUP",id:setup.id}})).strategy_id,strategy.id);
  await page.goto(`${origin}/strategies`);await page.locator(`#edit-strategy-${strategy.id} summary`).click();
  assert(await page.locator(`#edit-strategy-${strategy.id}`).getByRole("button",{name:"Archived strategy",exact:true}).isDisabled());
  passed("archival preserves setup references and the browser exposes a disabled archived action");

  await verifyIntegrationAccess(database,modern,fixtureUser,instrument,passed,message=>{stage=message;});

  await verifyDeletions(database,modern,fixtureUser,instrument,admin,browser,page,grant.id,passed,message=>{stage=message;});

  tokens=await verifyStdio(database,fixtureUser,issuer,resource,fixtureClient,tokens,page,passed,message=>{stage=message;});

  stage="refresh and current-browser logout";
  const refresh=await fetch(`${issuer}/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"refresh_token",client_id:fixtureClient!,refresh_token:tokens.refresh_token,resource}),signal:AbortSignal.timeout(10000)});
  assert(refresh.ok);tokens=await refresh.json() as typeof tokens;
  await verifyIntegrationToken(tokens.access_token,{issuer,resource,key:integrationSigningKeys(issuer)});
  await page.getByRole("button",{name:"Sign out",exact:true}).first().click();await page.waitForURL(`${origin}/login`);
  assert.equal(content(await modern.callTool({name:"tradeos_capabilities",arguments:{}})).version,"1");
  passed("renewable MCP credentials remain resource-bound and survive current-browser-only sign-out");
  stage="kill switch and revocation";
  await database.query("update private.integration_resources set enabled=false where purpose='MCP'");
  await assert.rejects(modern.listTools());
  await database.query("update private.integration_resources set enabled=true where purpose='MCP'");
  const revoked=await browser.rpc("revoke_integration_grant",{p_grant_id:grant.id,p_expected_version:grant.version});assert(!revoked.error);
  await assert.rejects(modern.listTools());
  await assert.rejects(modern.callTool({name:"tradeos_analytics_balance_curve",arguments:curveNextRequest}));
  await assert.rejects(modern.callTool({name:"tradeos_profile_get",arguments:{}}));
  await assert.rejects(modern.callTool({name:"tradeos_profile_patch",arguments:profileInput}));
  const refreshDenied=await fetch(`${issuer}/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"refresh_token",client_id:fixtureClient!,refresh_token:tokens.refresh_token,resource}),signal:AbortSignal.timeout(10000)});
  assert(!refreshDenied.ok);
  assert.equal(pageErrors,0);
  passed("server kill switch and grant revocation stop real SDK calls and refresh; no uncaught browser errors");
  console.log(`Local MCP gate: ${checks} checks passed. Real external clients and hosted rollout remain pending.`);
  }
} catch(error) {
  const fixtureFrame=error instanceof Error?error.stack?.match(/(?:test-mcp-integration|mcp-integration-access-fixture|mcp-private-files-fixture|mcp-deletions-fixture)\.mts:\d+:\d+/)?.[0]:undefined;
  console.error(JSON.stringify({stage,failure:error instanceof Error?error.name:"UnknownError",fixtureFrame}));
  if(error instanceof Error && /^Private fixture tool failed: [A-Z_]+$/.test(error.message)) console.error(error.message);
  if(error instanceof Error && /^Deletion fixture tool failed: [A-Z_]+$/.test(error.message)) console.error(error.message);
  console.error("Local MCP gate failed; provider responses, codes and credentials suppressed.");process.exitCode=1;
} finally {
  await Promise.all(connected.map(client=>client.close().catch(()=>{})));await ui?.close();
  if(callbackServer?.listening)await new Promise<void>(resolve=>callbackServer!.close(()=>resolve()));
  try {
    if(database && fixtureUser) {
      // Exact disposable fixture owner only. Never application deletion or hosted
      // data. Replica mode is transaction-local solely for immutable test cleanup.
      await database.query("begin");await database.query("set local session_replication_role=replica");
      await database.query("delete from private.deletion_objects where request_id in(select id from private.deletion_requests where owner_id=$1)",[fixtureUser]);
      await database.query("delete from private.deletion_requests where owner_id=$1",[fixtureUser]);
      await database.query("delete from private.file_upload_chunks where upload_id in(select id from private.file_uploads where owner_id=$1)",[fixtureUser]);
      await database.query("delete from private.file_uploads where owner_id=$1",[fixtureUser]);
      await database.query("delete from private.application_mutation_audits where actor_user_id=$1",[fixtureUser]);
      await database.query("delete from public.account_goal_progress_events where user_id=$1",[fixtureUser]);
      await database.query("delete from private.application_operations where owner_id=$1",[fixtureUser]);
      await database.query("delete from private.integration_grant_events where actor_user_id=$1",[fixtureUser]);
      await database.query("delete from private.integration_grants where owner_id=$1",[fixtureUser]);
      await database.query("commit");const removed=await admin!.auth.admin.deleteUser(fixtureUser);assert(!removed.error);
    }
    if(fixtureClient) {const removed=await admin!.auth.admin.oauth.deleteClient(fixtureClient);assert(!removed.error);}
    if(database) {
      if(previousResource)await database.query("update private.integration_resources set resource=$1,enabled=$2 where purpose='MCP'",[previousResource.resource,previousResource.enabled]);
      else await database.query("delete from private.integration_resources where purpose='MCP'");
      await database.query("select pg_advisory_unlock(670051234)");
    }
  } catch {console.error("Local MCP fixture cleanup requires attention; details suppressed.");process.exitCode=1;}
  finally {await database?.end().catch(()=>{});}
}
