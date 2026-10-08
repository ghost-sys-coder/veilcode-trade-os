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
    body:JSON.stringify({client_name:"Trade OS MCP local gate",redirect_uris:[callback],client_type:"public",
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
  assert.equal((await modern.listTools()).tools.length,8);assert.equal((await legacy.listTools()).tools.length,8);
  assert.equal((await modern.listResources()).resources.length,5);
  const calculator=content(await modern.callTool({name:"tradeos_position_size",arguments:{balance:"100000",currency:"USD",currencyPrecision:2,
    riskMethod:"PERCENTAGE",riskValue:"1",instrumentSymbol:"EURUSD",direction:"BUY",entryPrice:"1.1",stopLossPrice:"1.098"}}));
  assert.equal(calculator.recommendedVolume,"5.00");assert.equal(calculator.riskAmount,"1000.00");
  passed("official SDK negotiates modern and legacy HTTP, discovers eight tools and verifies 5.00-lot fixture");

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
    const result=content(await modern.callTool({name:"tradeos_configuration_list",arguments:{entity:"STRATEGY",limit:1,...(afterId?{afterId}:{})}}));
    const records=result.records as Array<{id:string;user_id:string}>;assert(records.every(item=>item.user_id===fixtureUser));
    ids.push(...records.map(item=>item.id));afterId=result.nextCursor as string|undefined;
    assert(ids.length<=100);
  } while(afterId);
  assert.equal(ids.length,new Set(ids).size);assert(ids.includes(strategy.id as string));
  const allIds=(await database.query("select id::text from public.strategies where user_id=$1 and archived_at is null order by id",[fixtureUser])).rows.map(row=>row.id);
  assert.deepEqual(ids,allIds);
  passed("all stable pages contain only the owner and no duplicated/omitted strategy IDs");

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
  assert.equal((await database.query("select count(*)::integer as count from private.application_mutation_audits where actor_user_id=$1 and actor_type='BROWSER'",[fixtureUser])).rows[0].count,1);
  passed("normal browser creation uses the shared audited writer; stale browser edits cannot overwrite MCP changes");

  stage="archival and preserved references";
  const archived=record(await modern.callTool({name:"tradeos_configuration_archive",arguments:{entity:"STRATEGY",operationId:randomUUID(),id:strategy.id,expectedVersion:"3",reason:"Retire referenced methodology"}}));
  assert.equal(archived.active,false);assert(archived.archived_at);
  assert.equal(content(await modern.callTool({name:"tradeos_configuration_get",arguments:{entity:"SETUP",id:setup.id}})).strategy_id,strategy.id);
  await page.goto(`${origin}/strategies`);await page.locator(`#edit-strategy-${strategy.id} summary`).click();
  assert(await page.locator(`#edit-strategy-${strategy.id}`).getByRole("button",{name:"Archived strategy",exact:true}).isDisabled());
  passed("archival preserves setup references and the browser exposes a disabled archived action");

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
  const refreshDenied=await fetch(`${issuer}/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"refresh_token",client_id:fixtureClient!,refresh_token:tokens.refresh_token,resource}),signal:AbortSignal.timeout(10000)});
  assert(!refreshDenied.ok);
  assert.equal(pageErrors,0);
  passed("server kill switch and grant revocation stop real SDK calls and refresh; no uncaught browser errors");
  console.log(`Local MCP gate: ${checks} checks passed. Real external clients and hosted rollout remain pending.`);
} catch(error) {
  console.error(JSON.stringify({stage,failure:error instanceof Error?error.name:"UnknownError"}));
  console.error("Local MCP gate failed; provider responses, codes and credentials suppressed.");process.exitCode=1;
} finally {
  await Promise.all(connected.map(client=>client.close().catch(()=>{})));await ui?.close();
  if(callbackServer?.listening)await new Promise<void>(resolve=>callbackServer!.close(()=>resolve()));
  try {
    if(database && fixtureUser) {
      // Exact disposable fixture owner only. Never application deletion or hosted
      // data. Replica mode is transaction-local solely for immutable test cleanup.
      await database.query("begin");await database.query("set local session_replication_role=replica");
      await database.query("delete from private.application_mutation_audits where actor_user_id=$1",[fixtureUser]);
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
