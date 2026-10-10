import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type pg from "pg";
import type { Page } from "@playwright/test";
import { configSchema, vaultId } from "../../integrations/mcp/config.mts";
import { WindowsVault } from "../../integrations/mcp/vault.mts";
import { LocalAuthorization, type SavedCredentials } from "../../integrations/mcp/auth.mts";

/** Existing disposable provider/browser fixture supplies a real approved token.
 * No production config, model API, terminal, hosted mutation or plaintext vault. */
export async function verifyStdio(database:pg.Client, userId:string, issuer:string, resource:string,clientId:string,
  tokens:{access_token:string;refresh_token:string},page:Page,passed:(message:string)=>void,stage:(message:string)=>void) {
  assert.equal(process.platform,"win32","Native Windows gate must run on Windows, not be silently skipped");
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const originalBrowserUrl=page.url();
  const directory=await mkdtemp(join(root,".artifacts","mcp-stdio-fixture-"));
  const config=configSchema.parse({version:1,profile:`fixture-${randomUUID()}`,resource,issuer,clientId,
    redirectUri:"http://127.0.0.1:9878/callback",allowLoopback:true});
  const path=join(directory,"config.json");
  await writeFile(path,JSON.stringify(config));
  const vaultPath=join(process.env.LOCALAPPDATA!,"TradeOS","credentials",vaultId(config));
  let vault:WindowsVault|undefined;
  const clients:Client[]=[]; const transports:StdioClientTransport[]=[];
  let stderr=""; let protocolErrors=0;
  const cli=fileURLToPath(new URL("../../integrations/mcp/cli.mts",import.meta.url));
  async function client(mode:"legacy"|"2026-07-28") {
    const instance=new Client({name:"Trade OS stdio fixture",version:"1"},{versionNegotiation:{mode:mode==="legacy"?"legacy":{pin:mode}}});
    const transport=new StdioClientTransport({command:process.execPath,args:["--experimental-strip-types",cli,"run","--config",path],
      cwd:root,stderr:"pipe",env:{LOCALAPPDATA:process.env.LOCALAPPDATA!,PATH:process.env.PATH!,SystemRoot:process.env.SystemRoot!}});
    transport.stderr?.on("data",data=>{stderr+=String(data);assert(stderr.length<65536);});
    transport.onerror=()=>{protocolErrors++;}; clients.push(instance);transports.push(transport);
    await instance.connect(transport);return instance;
  }
  function content(result:Awaited<ReturnType<Client["callTool"]>>) {
    assert(!result.isError && result.structuredContent && typeof result.structuredContent==="object");
    return result.structuredContent as Record<string,unknown>;
  }
  try {
    stage("stdio encrypted Windows credentials");
    vault=new WindowsVault(config);const auth=new LocalAuthorization(config,vault);
    await auth.login(async url=>{
      const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(10000)});
      assert([302,303,307].includes(response.status));
      const authorizationId=new URL(response.headers.get("location")!).searchParams.get("authorization_id");assert(authorizationId);
      await page.goto(`${new URL(resource).origin}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
      // Existing active consent resumes safely without showing another form.
      // Do not revoke/remap just to manufacture a new approval button.
      if(new URL(page.url()).origin+new URL(page.url()).pathname!==config.redirectUri)
        await page.getByRole("button",{name:"Approve access",exact:true}).click();
      await page.waitForURL(url=>url.origin+url.pathname===config.redirectUri);
    });
    const approved=await vault.load() as SavedCredentials;
    tokens.access_token=approved.accessToken;tokens.refresh_token=approved.refreshToken;
    passed("stdio's own loopback browser consent and S256 exchange issue verified resource-bound credentials");
    const encrypted=await readFile(vaultPath+".dpapi");
    assert(!encrypted.includes(Buffer.from(tokens.access_token))&&!encrypted.includes(Buffer.from(tokens.refresh_token)));
    const competing=new WindowsVault(config);
    try {await assert.rejects(competing.load(),error=>error instanceof Error && "code" in error && error.code==="PROFILE_BUSY");}
    finally {await competing.close();}
    await vault.close();vault=undefined;
    passed("stdio uses real per-user DPAPI encryption and cross-process profile locking, without MT5");

    stage("stdio legacy subprocess roundtrip");
    const legacy=await client("legacy");
    assert.equal((await legacy.listTools()).tools.length,84);assert.equal((await legacy.listResources()).resources.length,8);
    assert.equal((await legacy.listResourceTemplates()).resourceTemplates.length,0);
    assert((await legacy.readResource({uri:"tradeos://v1/money"})).contents.length>0);
    const sizing=content(await legacy.callTool({name:"tradeos_position_size",arguments:{balance:"100000",currency:"USD",currencyPrecision:2,
      riskMethod:"PERCENTAGE",riskValue:"1",instrumentSymbol:"EURUSD",direction:"BUY",entryPrice:"1.1",stopLossPrice:"1.098"}}));
    assert.equal(sizing.riskAmount,"1000.00");assert.equal(sizing.recommendedVolume,"5.00");
    const input={entity:"STRATEGY",operationId:randomUUID(),values:{name:"Stdio fixture strategy",description:null,active:true}};
    const created=content(await legacy.callTool({name:"tradeos_configuration_create",arguments:input}));
    const record=created.record as Record<string,unknown>;assert.equal(record.user_id,userId);
    assert(transports[0].pid);process.kill(transports[0].pid!);await legacy.close();
    passed("actual legacy stdio process preserves 84 tools/eight resources and exact 5.00-lot calculation");

    stage("stdio restart and durable mutation replay");
    const modern=await client("2026-07-28");
    assert.deepEqual(content(await modern.callTool({name:"tradeos_configuration_create",arguments:input})),created);
    assert.equal((await database.query("select count(*)::int n from private.application_operations where owner_id=$1 and operation_id=$2",[userId,input.operationId])).rows[0].n,1);
    assert.equal(content(await modern.callTool({name:"tradeos_operation_status",arguments:{operationId:input.operationId}})).status,"COMMITTED");
    const conflict=await modern.callTool({name:"tradeos_configuration_create",arguments:{...input,values:{...input.values,name:"Changed replay"}}});
    assert(conflict.isError && JSON.stringify(conflict.content).includes("OPERATION_CONFLICT"));
    const patched=content(await modern.callTool({name:"tradeos_configuration_patch",arguments:{entity:"STRATEGY",id:record.id,
      expectedVersion:"1",operationId:randomUUID(),values:{description:null}}})).record as Record<string,unknown>;
    assert.equal(patched.name,input.values.name);assert.equal(patched.description,null);
    const stale=await modern.callTool({name:"tradeos_configuration_patch",arguments:{entity:"STRATEGY",id:record.id,
      expectedVersion:"1",operationId:randomUUID(),values:{name:"Stale"}}});assert(stale.isError);
    passed("modern stdio restart after process termination recovers one durable write, rejects changed retry/stale versions and preserves null/omission");

    stage("stdio live disablement has no cached bypass");
    await database.query("update private.integration_resources set enabled=false where purpose='MCP'");
    try {
      await assert.rejects(modern.listTools(undefined,{cacheMode:"refresh"}));
      await assert.rejects(modern.readResource({uri:"tradeos://v1/money"},{cacheMode:"bypass"}));
    } finally {await database.query("update private.integration_resources set enabled=true where purpose='MCP'");}
    assert.equal((await modern.listTools(undefined,{cacheMode:"refresh"})).tools.length,84);
    await modern.close();
    passed("stdio immediately respects the remote kill switch and never serves cached protected resources");

    stage("stdio protected credential rotation and disconnect");
    vault=new WindowsVault(config);const renewed=new LocalAuthorization(config,vault);await renewed.load();
    await renewed.refresh();const rotated=await vault.load() as SavedCredentials;
    assert(rotated.refreshToken!==tokens.refresh_token);
    tokens.access_token=rotated.accessToken;tokens.refresh_token=rotated.refreshToken;
    await vault.close();vault=undefined;
    const restarted=await client("legacy");assert.equal(content(await restarted.callTool({name:"tradeos_capabilities",arguments:{}})).version,"1");
    await restarted.close();
    vault=new WindowsVault(config);await vault.clear();await vault.close();vault=undefined;
    await assert.rejects(client("legacy"));
    assert(stderr.includes("login command"));
    assert(!stderr.includes(tokens.access_token)&&!stderr.includes(tokens.refresh_token));
    assert.equal(protocolErrors,0);
    passed("rotated DPAPI credentials survive restart; disconnected adapters fail cleanly without token/protocol leakage");
    return tokens;
  } catch(error) {
    const code=error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN";
    console.error(JSON.stringify({stdioFailureCode:/^[A-Za-z0-9_-]{1,80}$/.test(code)?code:"SUPPRESSED",
      safeDiagnostics:stderr.split(/\r?\n/).filter(line=>line.startsWith("Trade OS MCP:")).slice(-3),
      nodeImportFailure:stderr.includes("ERR_MODULE_NOT_FOUND"),unsupportedSyntax:stderr.includes("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX")}));
    throw error;
  } finally {
    await Promise.all(clients.map(client=>client.close().catch(()=>{})));
    await Promise.all(transports.map(transport=>transport.close().catch(()=>{})));await vault?.close();
    // Exact random fixture paths only, never user config/profile files.
    await unlink(vaultPath+".dpapi").catch(()=>{});await unlink(vaultPath+".lock").catch(()=>{});
    await rm(directory,{recursive:true,force:true});
    // Keep the enclosing browser regression on its original workspace page,
    // not the intentionally minimal loopback receipt from this sub-fixture.
    await page.goto(new URL(originalBrowserUrl).origin===new URL(resource).origin ? originalBrowserUrl : `${new URL(resource).origin}/settings/integrations`);
  }
}
