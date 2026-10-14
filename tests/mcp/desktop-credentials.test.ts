import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalAuthorization, type SavedCredentials } from "../../integrations/mcp/auth.mts";
import { configSchema } from "../../integrations/mcp/config.mts";
import { WindowsVault, type CredentialStore } from "../../integrations/mcp/vault.mts";

const config = configSchema.parse({version:1,profile:"desktop-fixture",resource:"https://trade.example/mcp",
  issuer:"https://project.supabase.co/auth/v1",clientId:"70000000-0000-4000-8000-000000000001",
  redirectUri:"http://127.0.0.1:9884/callback",allowLoopback:false});
const tokens = {access_token:"ORIGINAL",refresh_token:"ORIGINAL_REFRESH",token_type:"Bearer"};
function fixture() {
  let stored: unknown, tail: Promise<unknown> = Promise.resolve(), rotations = 0;
  const locked: CredentialStore = {load:async()=>stored,save:async value=>{stored=structuredClone(value);},
    clear:async()=>{stored={disconnected:true};},close:()=>{}};
  const store: CredentialStore = {...locked,withExclusive<T>(work:(value:CredentialStore)=>Promise<T>) {
    const next=tail.then(()=>work(locked));tail=next.catch(()=>{});return next;
  }};
  const verify=vi.fn(async(token:string)=>({client_id:config.clientId,
    exp:Math.floor(Date.now()/1000)+(token==="ORIGINAL"?30:3600)}));
  const fetcher=vi.fn<typeof fetch>(async (_url,init)=>{
    const used=new URLSearchParams(init!.body as URLSearchParams).get("refresh_token");
    expect(used).toBe(rotations===0?tokens.refresh_token:`REFRESH_${rotations}`);
    expect(stored).toEqual({disconnected:true});
    rotations++;
    return Response.json({access_token:`ACCESS_${rotations}`,refresh_token:`REFRESH_${rotations}`,token_type:"bearer"});
  });
  const clients=Array.from({length:3},()=>new LocalAuthorization(config,store,{verify,fetch:fetcher}));
  return {clients,store,locked,fetcher,verify,read:()=>stored};
}

describe("Desktop transports share one serialized credential lifecycle",()=>{
  it("overlapping startup loads rotate once and every instance reads the saved winner",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);
    await Promise.all(f.clients.map(client=>client.load()));
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(await Promise.all(f.clients.map(client=>client.accessToken()))).toEqual(["ACCESS_1","ACCESS_1","ACCESS_1"]);
    expect(f.read()).toMatchObject({accessToken:"ACCESS_1",refreshToken:"REFRESH_1"});
  });
  it("concurrent explicit renewals do not replay a rotating secret from stale memory",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);await Promise.all(f.clients.map(client=>client.load()));
    expect(await Promise.all(f.clients.map(client=>client.refresh()))).toEqual(["ACCESS_2","ACCESS_2","ACCESS_2"]);
    expect(f.fetcher).toHaveBeenCalledTimes(2); // One proactive, one explicit renewal.
  });
  it("same-instance explicit renewals are coalesced",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);await f.clients[0].load();
    expect(await Promise.all([f.clients[0].refresh(),f.clients[0].refresh()])).toEqual(["ACCESS_2","ACCESS_2"]);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it("recognizes another renewal even if its access-token bytes are unchanged",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);await Promise.all(f.clients.map(client=>client.load()));
    f.fetcher.mockResolvedValueOnce(Response.json({access_token:"ACCESS_1",refresh_token:"ROTATED_ONLY_REFRESH",token_type:"bearer"}));
    expect(await Promise.all(f.clients.map(client=>client.refresh()))).toEqual(["ACCESS_1","ACCESS_1","ACCESS_1"]);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.read()).toMatchObject({refreshToken:"ROTATED_ONLY_REFRESH"});
  });
  it("does not reuse the same record when both durable pre-clear attempts fail",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);await f.clients[0].load();
    const clear=f.locked.clear;
    f.locked.clear=vi.fn(async()=>{throw new Error("PRIVATE_DISK");});
    await expect(f.clients[0].refresh()).rejects.toMatchObject({code:"REFRESH_UNCERTAIN",refreshStage:"PRE_CLEAR"});
    await expect(f.clients[0].accessToken()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
    expect(f.fetcher).toHaveBeenCalledOnce();
    f.locked.clear=clear;
    await f.clients[1].accept({...tokens,access_token:"RECONNECTED"});
    expect(await f.clients[0].accessToken()).toBe("RECONNECTED");
  });
  it("an uncertain winner blocks every waiter, including instances with a previously valid token",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);await Promise.all(f.clients.map(client=>client.load()));
    f.fetcher.mockRejectedValueOnce(new Error("PRIVATE_NETWORK"));
    const results=await Promise.allSettled(f.clients.map(client=>client.refresh()));
    expect(results.map(result=>result.status)).toEqual(["rejected","rejected","rejected"]);
    expect(results[0]).toMatchObject({reason:{code:"REFRESH_UNCERTAIN"}});
    expect(results[1]).toMatchObject({reason:{code:"LOGIN_REQUIRED"}});
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.read()).toEqual({disconnected:true});
    await expect(f.clients[2].accessToken()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
  });
  it("a protected disconnect is observed even when another instance cached an unexpired token",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);await Promise.all(f.clients.map(client=>client.load()));
    await f.store.withExclusive!(locked=>locked.clear());
    await expect(f.clients[1].accessToken()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it("an explicitly completed reconnect restores the latest protected credential, not stale memory",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);await f.clients[1].load();
    await f.store.withExclusive!(locked=>locked.clear());
    await expect(f.clients[1].accessToken()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
    await f.clients[0].accept({...tokens,access_token:"RECONNECTED",refresh_token:"RECONNECTED_REFRESH"});
    expect(await f.clients[1].accessToken()).toBe("RECONNECTED");
  });
  it("does not accept another resource's credential even under the shared lock",async()=>{
    const f=fixture();await f.clients[0].accept(tokens);
    const original=f.read() as SavedCredentials;
    await f.store.withExclusive!(locked=>locked.save({...original,resource:"https://wrong.example/mcp"}));
    await expect(f.clients[1].load()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each([401,403])("live resource denial is not retried or bypassed by shared credentials (%i)",async status=>{
    const f=fixture();await f.clients[0].accept(tokens);await f.clients[0].load();
    f.fetcher.mockResolvedValueOnce(new Response(null,{status}));
    await expect(f.clients[0].authorizedFetch(config.resource)).rejects.toMatchObject({code:"ACCESS_DENIED"});
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it.skipIf(process.platform!=="win32")("three real Windows helpers initialize and renew together, then observe disconnect/reconnect",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"trade-os-desktop-coordination-"));
    const original=process.env.LOCALAPPDATA;
    const vaults: WindowsVault[]=[];
    const nativeConfig={...config,profile:`tradeos-${randomUUID()}`};
    try {
      // Only disposable fixture helpers inherit this directory. Restore the
      // worker environment immediately; never use an owner's authorized vault.
      process.env.LOCALAPPDATA=directory;
      for(let index=0;index<3;index++)vaults.push(new WindowsVault(nativeConfig));
    } finally { process.env.LOCALAPPDATA=original; }
    const verify=async (token:string)=>({client_id:nativeConfig.clientId,
      exp:Math.floor(Date.now()/1000)+(token==="ORIGINAL"?30:3600)});
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({access_token:"NEXT",refresh_token:"NEXT_REFRESH",token_type:"bearer"}));
    try {
      const clients=vaults.map(vault=>new LocalAuthorization(nativeConfig,vault,{verify,fetch:fetcher}));
      await clients[0].accept(tokens);
      await Promise.all(clients.map(client=>client.load()));
      expect(fetcher).toHaveBeenCalledOnce();
      expect(await Promise.all(clients.map(client=>client.accessToken()))).toEqual(["NEXT","NEXT","NEXT"]);
      await vaults[0].clear();
      for(const client of clients)await expect(client.accessToken()).rejects.toMatchObject({code:"LOGIN_REQUIRED"});
      await clients[0].accept({...tokens,access_token:"RECONNECTED"});
      expect(await Promise.all(clients.map(client=>client.accessToken()))).toEqual(["RECONNECTED","RECONNECTED","RECONNECTED"]);
    } finally {
      await Promise.all(vaults.map(vault=>vault.close()));
      await rm(directory,{recursive:true}); // Exact directory created by this fixture.
    }
  },15_000);
});
