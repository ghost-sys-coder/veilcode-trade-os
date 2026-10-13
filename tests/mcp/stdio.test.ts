import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createHash } from "node:crypto";
import { configSchema, credentialContext, LocalMcpError, safeMessage, vaultId } from "../../integrations/mcp/config.mts";
import { LocalAuthorization, type SavedCredentials } from "../../integrations/mcp/auth.mts";
import { createProxyServer } from "../../integrations/mcp/proxy.mts";
import type { CredentialStore } from "../../integrations/mcp/vault.mts";

const config=configSchema.parse({version:1,profile:"fixture",resource:"http://127.0.0.1:3100/mcp",issuer:"http://127.0.0.1:54321/auth/v1",
  clientId:"70000000-0000-4000-8000-000000000001",redirectUri:"http://127.0.0.1:19878/callback",allowLoopback:true});
function fixture(options:{exp?:number;fetch?:typeof fetch;verify?: (token:string)=>Promise<{exp:number;client_id:string}>}={}) {
  let stored:unknown;
  const store:CredentialStore={load:vi.fn(async()=>stored),save:vi.fn(async value=>{stored=value;}),clear:vi.fn(async()=>{stored={disconnected:true};}),close:vi.fn()};
  const expiry=options.exp??Math.floor(Date.now()/1000)+3600;
  const verify=options.verify??vi.fn(async()=>({exp:expiry,client_id:config.clientId}));
  const fetcher=options.fetch??vi.fn<typeof fetch>(async()=>Response.json({access_token:"NEXT_TOKEN",refresh_token:"NEXT_REFRESH",token_type:"bearer"}));
  const auth=new LocalAuthorization(config,store,{verify,fetch:fetcher});
  return {auth,store,fetcher,verify,getStored:()=>stored};
}
const tokens={access_token:"PRIVATE_ACCESS",refresh_token:"PRIVATE_REFRESH",token_type:"Bearer"};
describe("stdio public configuration and errors",()=>{
  it("accepts HTTPS without trusting implicit loopback or embedded secrets",()=>{
    expect(configSchema.parse({...config,resource:"https://trade.example/mcp",issuer:"https://project.supabase.co/auth/v1",allowLoopback:false})).toBeDefined();
  });
  it.each([
    {allowLoopback:false},{resource:"https://user:password@trade.example/mcp"},{resource:"http://trade.example/mcp"},
    {resource:"https://trade.example/mcp?override=true"},{resource:"https://trade.example/mcp/"},
    {issuer:"https://project.supabase.co/wrong"},{issuer:"https://project.supabase.co/auth/v1#secret"},
    {redirectUri:"http://localhost:9878/callback"},{redirectUri:"https://127.0.0.1:9878/callback"},
    {redirectUri:"http://127.0.0.1:80/callback"},{redirectUri:"http://127.0.0.1:9878/callback?state=bad"},
    {profile:"../credentials"},{clientSecret:"DO_NOT_ALLOW"},
  ])("rejects unsafe configuration %#",patch=>expect(configSchema.safeParse({...config,...patch}).success).toBe(false));
  it("binds encrypted records separately to profile/client/resource/issuer",()=>{
    const ids=[config,{...config,profile:"claude"},{...config,clientId:"70000000-0000-4000-8000-000000000002"},
      {...config,resource:"https://trade.example/mcp"},{...config,issuer:"https://project.supabase.co/auth/v1"}].map(vaultId);
    expect(new Set(ids).size).toBe(5);expect(credentialContext(config)).not.toContain("PRIVATE_REFRESH");
  });
  it("sanitizes raw errors and explains uncertain operation lookup",()=>{
    expect(safeMessage(new Error("PRIVATE_TOKEN=secret"))).not.toContain("secret");
    expect(safeMessage(new Error())).toContain("SAME operation ID");
    expect(safeMessage(new LocalMcpError("PROFILE_BUSY"))).toContain("separate profile");
  });
});
describe("stdio renewable authorization",()=>{
  it("requires login for missing/default records",async()=>{
    await expect(fixture().auth.load()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
  });
  it("persists only verified resource/client-bound credentials",async()=>{
    const f=fixture();await f.auth.accept(tokens);expect(await f.auth.accessToken()).toBe(tokens.access_token);
    expect(f.getStored()).toMatchObject({resource:config.resource,issuer:config.issuer,clientId:config.clientId});
    const wrong=fixture({verify:async()=>({exp:9999999999,client_id:"70000000-0000-4000-8000-000000000002"})});
    await expect(wrong.auth.accept(tokens)).rejects.toMatchObject({code:"ACCESS_DENIED"});expect(wrong.store.save).not.toHaveBeenCalled();
  });
  it("does not accept copied records from another resource",async()=>{
    const f=fixture();await f.store.save({version:1,resource:"https://wrong.example/mcp",issuer:config.issuer,clientId:config.clientId,
      accessToken:"a",refreshToken:"r",expiresAt:9999999999} satisfies SavedCredentials);
    await expect(f.auth.load()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
  });
  it("serializes concurrent proactive refresh and durably clears before provider rotation",async()=>{
    const f=fixture({exp:Math.floor(Date.now()/1000)+30});await f.auth.accept(tokens);
    const results=await Promise.all([f.auth.accessToken(),f.auth.accessToken(),f.auth.accessToken()]);
    expect(results).toEqual(["NEXT_TOKEN","NEXT_TOKEN","NEXT_TOKEN"]);expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.store.clear).toHaveBeenCalledOnce();
    expect(vi.mocked(f.store.clear).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.fetcher).mock.invocationCallOrder[0]);
    const init=vi.mocked(f.fetcher).mock.calls[0][1]!;
    expect(new URLSearchParams(init.body as URLSearchParams).get("resource")).toBe(config.resource);
    expect(f.getStored()).toMatchObject({refreshToken:"NEXT_REFRESH"});
  });
  it("blocks uncertain refresh without replaying the consumed secret",async()=>{
    const f=fixture({fetch:vi.fn(async()=>{throw new Error("PRIVATE_NETWORK");})});await f.auth.accept(tokens);
    await expect(f.auth.refresh()).rejects.toMatchObject({code:"REFRESH_UNCERTAIN"});
    await expect(f.auth.refresh()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
    expect(f.fetcher).toHaveBeenCalledOnce();expect(f.getStored()).toEqual({disconnected:true});
  });
  it("retains the prior refresh token only after a verified successful response omits its replacement",async()=>{
    const f=fixture({fetch:vi.fn(async()=>Response.json({access_token:"NEXT_TOKEN",token_type:"bearer"}))});
    await f.auth.accept(tokens);await f.auth.refresh();
    expect(f.getStored()).toMatchObject({accessToken:"NEXT_TOKEN",refreshToken:tokens.refresh_token});
    expect(f.verify).toHaveBeenCalledWith("NEXT_TOKEN");
    expect(vi.mocked(f.store.clear).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.fetcher).mock.invocationCallOrder[0]);
    expect(vi.mocked(f.verify).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(f.store.save).mock.invocationCallOrder.at(-1)!);
  });
  it.each([null,"",123,"x".repeat(16385)])("does not retain an old refresh token when replacement is malformed (%#)",async refreshToken=>{
    const f=fixture({fetch:vi.fn(async()=>Response.json({access_token:"NEXT_TOKEN",refresh_token:refreshToken,token_type:"bearer"}))});
    await f.auth.accept(tokens);
    await expect(f.auth.refresh()).rejects.toMatchObject({code:"REFRESH_UNCERTAIN",refreshStage:"TOKEN_RESPONSE"});
    expect(f.getStored()).toEqual({disconnected:true});
    await expect(f.auth.accessToken()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it("does not persist either refresh token when refreshed access-token verification fails",async()=>{
    const f=fixture({fetch:vi.fn(async()=>Response.json({access_token:"NEXT_TOKEN",token_type:"bearer"})),
      verify:vi.fn(async token=>{if(token==="NEXT_TOKEN")throw new Error("PRIVATE_RAW_TOKEN");return {exp:9999999999,client_id:config.clientId};})});
    await f.auth.accept(tokens);
    await expect(f.auth.refresh()).rejects.toMatchObject({code:"REFRESH_UNCERTAIN",refreshStage:"TOKEN_VERIFICATION"});
    expect(f.getStored()).toEqual({disconnected:true});expect(f.store.save).toHaveBeenCalledOnce();
  });
  it("reports only allowlisted refresh stages, never provider errors or tokens",()=>{
    expect(safeMessage(new LocalMcpError("REFRESH_UNCERTAIN","TOKEN_VERIFICATION"))).toContain("Verification stage: TOKEN_VERIFICATION");
    const error=new LocalMcpError("REFRESH_UNCERTAIN");
    Object.assign(error,{refreshStage:"PRIVATE_TOKEN=secret"});
    expect(safeMessage(error)).not.toContain("secret");
    expect(safeMessage(error)).not.toContain("Verification stage");
  });
  it("still requires a refresh token during the initial code exchange",async()=>{
    const f=fixture();await expect(f.auth.accept({access_token:"INITIAL",token_type:"bearer"})).rejects.toThrow();
    expect(f.store.save).not.toHaveBeenCalled();
  });
  it("cannot use omission fallback to accept another client's signed access token",async()=>{
    const f=fixture({fetch:vi.fn(async()=>Response.json({access_token:"NEXT_TOKEN",token_type:"bearer"})),
      verify:vi.fn(async token=>({exp:9999999999,client_id:token==="NEXT_TOKEN"?"70000000-0000-4000-8000-000000000002":config.clientId}))});
    await f.auth.accept(tokens);
    await expect(f.auth.refresh()).rejects.toMatchObject({code:"REFRESH_UNCERTAIN",refreshStage:"TOKEN_VERIFICATION"});
    expect(f.getStored()).toEqual({disconnected:true});
  });
  it("fails closed without replay if saving a verified refresh fails",async()=>{
    const f=fixture();await f.auth.accept(tokens);vi.mocked(f.store.save).mockRejectedValueOnce(new Error("PRIVATE_DISK_ERROR"));
    await expect(f.auth.refresh()).rejects.toMatchObject({code:"REFRESH_UNCERTAIN",refreshStage:"CREDENTIAL_SAVE"});
    expect(f.getStored()).toEqual({disconnected:true});
    await expect(f.auth.refresh()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it("does not start rotation if its durable pre-clear fails",async()=>{
    const f=fixture();await f.auth.accept(tokens);vi.mocked(f.store.clear).mockRejectedValue(new Error("DISK_FAIL"));
    await expect(f.auth.refresh()).rejects.toMatchObject({code:"REFRESH_UNCERTAIN"});expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("binds bearer headers to exact resource and forbids redirects",async()=>{
    const f=fixture();await f.auth.accept(tokens);
    await f.auth.authorizedFetch(config.resource,{method:"POST"});
    const init=vi.mocked(f.fetcher).mock.calls[0][1]!;expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${tokens.access_token}`);
    expect(init.redirect).toBe("error");
    await expect(f.auth.authorizedFetch("https://other.example/mcp")).rejects.toMatchObject({code:"ACCESS_DENIED"});
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it.each([401,403])("denies revoked/disabled access without automatic retries (%i)",async status=>{
    const f=fixture({fetch:vi.fn(async()=>new Response(null,{status}))});await f.auth.accept(tokens);
    await expect(f.auth.authorizedFetch(config.resource)).rejects.toMatchObject({code:"ACCESS_DENIED"});expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it("verifies public discovery against exact pinned issuer/resource and PKCE",async()=>{
    const fetcher=vi.fn<typeof fetch>(async input=>String(input).includes("oauth-protected-resource") ?
      Response.json({resource:config.resource,authorization_servers:[config.issuer]}):Response.json({issuer:config.issuer,
        authorization_endpoint:`${config.issuer}/oauth/authorize`,token_endpoint:`${config.issuer}/oauth/token`,
        code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"]}));
    await fixture({fetch:fetcher}).auth.discovery();expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValue(Response.json({resource:config.resource,authorization_servers:["https://attacker.example/auth/v1"]}));
    await expect(fixture({fetch:fetcher}).auth.discovery()).rejects.toMatchObject({code:"INVALID_DISCOVERY"});
  });
  it("validates loopback state, duplicate parameters, one-use codes and S256 before exchange",async()=>{
    let authorization:URL|undefined;
    const fetcher=vi.fn<typeof fetch>(async (input,init)=>{
      const url=String(input);
      if(url.includes("oauth-protected-resource"))return Response.json({resource:config.resource,authorization_servers:[config.issuer]});
      if(url.includes("oauth-authorization-server"))return Response.json({issuer:config.issuer,authorization_endpoint:`${config.issuer}/oauth/authorize`,
        token_endpoint:`${config.issuer}/oauth/token`,code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"]});
      const body=new URLSearchParams(init!.body as URLSearchParams);
      expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(authorization!.searchParams.get("code_challenge"));
      expect(body.get("code")).toBe("CODE_ONLY_IN_MEMORY");expect(body.get("resource")).toBe(config.resource);
      return Response.json(tokens);
    });
    const f=fixture({fetch:fetcher});await f.auth.login(async url=>{
      authorization=new URL(url);const state=authorization.searchParams.get("state")!;
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      for(const suffix of [`code=a&state=wrong`,`code=a&code=b&state=${state}`,`code=a&state=${state}&unexpected=1`])
        expect((await fetch(`${config.redirectUri}?${suffix}`)).status).toBe(400);
      expect((await fetch(`${config.redirectUri}?code=CODE_ONLY_IN_MEMORY&state=${state}`,{headers:{Origin:"https://attacker.example"}})).status).toBe(400);
      expect((await fetch(`${config.redirectUri}?code=CODE_ONLY_IN_MEMORY&state=${state}`)).status).toBe(200);
      expect((await fetch(`${config.redirectUri}?code=CODE_ONLY_IN_MEMORY&state=${state}`)).status).toBe(400);
    },1000);
    expect(f.getStored()).toMatchObject({accessToken:tokens.access_token});
  });
  it("cleans up callback sockets on consent timeout",async()=>{
    const fetcher=vi.fn<typeof fetch>(async input=>String(input).includes("oauth-protected-resource")?
      Response.json({resource:config.resource,authorization_servers:[config.issuer]}):Response.json({issuer:config.issuer,
        authorization_endpoint:`${config.issuer}/oauth/authorize`,token_endpoint:`${config.issuer}/oauth/token`,
        code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"]}));
    await expect(fixture({fetch:fetcher}).auth.login(async()=>{},40)).rejects.toMatchObject({code:"LOGIN_TIMEOUT"});
    await expect(fetch(config.redirectUri)).rejects.toThrow();
  });
  it("releases the callback port after browser launch failure without saving credentials",async()=>{
    const fetcher=vi.fn<typeof fetch>(async input=>String(input).includes("oauth-protected-resource")?
      Response.json({resource:config.resource,authorization_servers:[config.issuer]}):Response.json({issuer:config.issuer,
        authorization_endpoint:`${config.issuer}/oauth/authorize`,token_endpoint:`${config.issuer}/oauth/token`,
        code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"]}));
    const f=fixture({fetch:fetcher});
    await expect(f.auth.login(async()=>{throw new LocalMcpError("BROWSER_UNAVAILABLE");})).rejects.toMatchObject({code:"BROWSER_UNAVAILABLE"});
    expect(f.store.save).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(fetch(config.redirectUri)).rejects.toThrow();
  });
  it("returns actionable denial without exchanging a code or waiting for timeout",async()=>{
    const fetcher=vi.fn<typeof fetch>(async input=>String(input).includes("oauth-protected-resource")?
      Response.json({resource:config.resource,authorization_servers:[config.issuer]}):Response.json({issuer:config.issuer,
        authorization_endpoint:`${config.issuer}/oauth/authorize`,token_endpoint:`${config.issuer}/oauth/token`,
        code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"]}));
    const f=fixture({fetch:fetcher});
    await expect(f.auth.login(async url=>{
      const state=new URL(url).searchParams.get("state")!;
      expect((await fetch(`${config.redirectUri}?error=access_denied&state=${state}`)).status).toBe(200);
    },1000)).rejects.toMatchObject({code:"ACCESS_DENIED"});
    expect(fetcher).toHaveBeenCalledTimes(2);expect(f.store.save).not.toHaveBeenCalled();
  });
  it("tries only the pinned RFC discovery alternative after a 404",async()=>{
    const calls:string[]=[];
    const fetcher=vi.fn<typeof fetch>(async input=>{
      calls.push(String(input));
      if(calls.length===1)return Response.json({resource:config.resource,authorization_servers:[config.issuer]});
      if(calls.length===2)return new Response(null,{status:404});
      return Response.json({issuer:config.issuer,authorization_endpoint:`${config.issuer}/oauth/authorize`,token_endpoint:`${config.issuer}/oauth/token`,
        code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"]});
    });
    await fixture({fetch:fetcher}).auth.discovery();
    expect(calls[2]).toBe("http://127.0.0.1:54321/.well-known/oauth-authorization-server/auth/v1");
  });
});
describe("stdio SDK forwarding without a parallel domain implementation",()=>{
  it("preserves pagination, decimal strings, null/omission, IDs and structured results; bypasses cached resources",async()=>{
    const remote={listTools:vi.fn<Client["listTools"]>(async()=>({tools:[{name:"write",inputSchema:{type:"object"}}]})),
      callTool:vi.fn<Client["callTool"]>(async()=>({content:[{type:"text",text:"ok"}],structuredContent:{net_pnl:"0.01"}})),
      listResources:vi.fn<Client["listResources"]>(async()=>({resources:[],nextCursor:"PAGE_2"})),readResource:vi.fn<Client["readResource"]>(async()=>({contents:[{uri:"tradeos://v1/money",text:"{}"}]})),
      listResourceTemplates:vi.fn(async()=>({resourceTemplates:[]}))};
    const server=createProxyServer(remote as unknown as Client);
    const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
    const client=new Client({name:"stdio-unit",version:"1"},{versionNegotiation:{mode:"legacy"}});
    try {
      await server.connect(serverTransport);await client.connect(clientTransport);
      await client.listTools();
      const arguments_={operationId:"unchanged-id",net_pnl:"0.01",clear:null};
      expect((await client.callTool({name:"write",arguments:arguments_})).structuredContent).toEqual({net_pnl:"0.01"});
      expect(remote.callTool.mock.calls[0][0]).toMatchObject({arguments:arguments_});
      await client.listResources({cursor:"PAGE_1"});expect(remote.listResources.mock.calls[0][0]).toMatchObject({cursor:"PAGE_1"});
      await client.readResource({uri:"tradeos://v1/money"});
      expect(remote.readResource.mock.calls[0][1]).toMatchObject({cacheMode:"bypass"});
      expect(remote.listTools.mock.calls[0][1]).toMatchObject({cacheMode:"refresh"});
      remote.callTool.mockRejectedValueOnce(new Error("PRIVATE_RAW_TOKEN"));
      await expect(client.callTool({name:"write",arguments:arguments_})).rejects.toThrow(/operation_status/);
      expect(remote.callTool).toHaveBeenCalledTimes(2);
    } finally {await client.close();await server.close();}
  });
});
