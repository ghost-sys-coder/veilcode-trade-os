import { afterEach, describe, expect, it, vi } from "vitest";
import { removeDeletionObjects } from "@/services/files/removal";
const { factory, remove, from, config } = vi.hoisted(() => ({ factory:vi.fn(),remove:vi.fn(),from:vi.fn(),config:vi.fn() }));
vi.mock("@supabase/supabase-js",()=>({createClient:factory}));
vi.mock("@/config/env",()=>({getSupabaseConfig:config}));
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",trade="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const path=`${owner}/${trade}/image.png`;
const job={requestId:owner,ownerId:owner,tradeId:trade,settleOperationId:trade,objects:[{bucket:"trade-screenshots",path}]};
function setup(){vi.stubEnv("SUPABASE_SECRET_KEY","sb_secret_fixture_key_never_a_real_secret");config.mockReturnValue({url:"https://fixture.supabase.co"});factory.mockReturnValue({storage:{from}});from.mockReturnValue({remove});remove.mockResolvedValue({data:[],error:null});}
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("exact frozen Storage removal",()=>{
  it("removes only exact paths grouped by fixed buckets; repeated missing objects are acknowledged",async()=>{
    setup();const both={...job,objects:[...job.objects,{bucket:"trade-file-staging",path:`${owner}/${trade}/chunks/0.part`}]};
    await removeDeletionObjects(both);await removeDeletionObjects(both);
    expect(from.mock.calls).toEqual([["trade-screenshots"],["trade-file-staging"],["trade-screenshots"],["trade-file-staging"]]);
    expect(remove.mock.calls).toEqual([[ [path] ],[[`${owner}/${trade}/chunks/0.part`]],[[path]],[[`${owner}/${trade}/chunks/0.part`]]]);
  });
  it.each(["../outside",`${owner}/${trade}//file`,`${owner}/${trade}/../file`,`${trade}/${owner}/file`,`https://host/file`])("validates the entire job before any removal (%s)",async bad=>{
    setup();await expect(removeDeletionObjects({...job,objects:[...job.objects,{bucket:"trade-file-staging",path:bad}]})).rejects.toMatchObject({code:"INVALID_FILE_PATH"});expect(remove).not.toHaveBeenCalled();
  });
  it("rejects arbitrary buckets and caller fields before credentials/I/O",async()=>{
    setup();await expect(removeDeletionObjects({...job,objects:[{bucket:"public",path}],url:"https://evil"})).rejects.toThrow();expect(factory).not.toHaveBeenCalled();
  });
  it.each(["", "service_role_fixture_unsafe_legacy_key"])("rejects missing/legacy hosted credentials (%s)",async key=>{
    setup();vi.stubEnv("SUPABASE_SECRET_KEY",key);await expect(removeDeletionObjects(job)).rejects.toMatchObject({code:"STORAGE_NOT_CONFIGURED"});expect(remove).not.toHaveBeenCalled();
  });
  it("does not follow redirects or cache removal responses and bounds each HTTP call",async()=>{
    setup();await removeDeletionObjects(job);const request=vi.fn().mockResolvedValue(new Response("[]"));vi.stubGlobal("fetch",request);
    await factory.mock.calls[0][2].global.fetch("https://fixture.supabase.co/storage/v1/object",{method:"DELETE"});
    expect(request).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({cache:"no-store",redirect:"error",signal:expect.any(AbortSignal)}));
  });
  it("keeps partial-bucket failures generic and safely retryable",async()=>{
    setup();remove.mockResolvedValueOnce({error:null}).mockResolvedValueOnce({error:{message:"provider secret must not escape"}});
    await expect(removeDeletionObjects({...job,objects:[...job.objects,{bucket:"trade-file-staging",path:`${owner}/${trade}/chunk.part`}]})).rejects.toMatchObject({code:"STORAGE_UNAVAILABLE"});
    expect(remove).toHaveBeenCalledTimes(2);await removeDeletionObjects(job);
  });
});
