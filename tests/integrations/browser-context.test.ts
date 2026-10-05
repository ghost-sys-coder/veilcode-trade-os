import { afterEach,describe,expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { getVerifiedBrowserContext,verifiedBrowserClaims,type VerifiedBrowserContext } from "@/services/integrations/browser-context";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixture(change: object={}) {
  const claims={sub:id,session_id:id,role:"authenticated",exp:Math.floor(Date.now()/1000)+3600,...change};
  const client={auth:{getClaims:vi.fn(async()=>({error:null,data:{claims}})),getUser:vi.fn(async()=>({error:null,data:{user:{id}}}))}};
  return {...client,client:client as unknown as SupabaseClient<IntegrationDatabase>};
}
afterEach(()=>vi.useRealTimers());
describe("runtime-verified browser actor",()=>{
  it("freezes a minimal actor and keeps claims out of JSON serialization",async()=>{
    const actor=await getVerifiedBrowserContext(fixture().client);
    expect(Object.isFrozen(actor)).toBe(true); expect(JSON.stringify(actor)).toBe(JSON.stringify({userId:id}));
    expect(verifiedBrowserClaims(actor).sub).toBe(id);
  });
  it("rejects an arbitrary owner object and a clone of a verified context",async()=>{
    const actor=await getVerifiedBrowserContext(fixture().client);
    expect(()=>verifiedBrowserClaims({userId:id} as VerifiedBrowserContext)).toThrow();
    expect(()=>verifiedBrowserClaims({...actor})).toThrow();
  });
  it.each([{client_id:id},{session_id:undefined},{role:"service_role"},{exp:1}])("rejects invalid browser claims %j",async change=>{
    const f=fixture(change); await expect(getVerifiedBrowserContext(f.client)).rejects.toThrow(); expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it("requires verified claims and provider user identity to agree",async()=>{
    const f=fixture(); f.auth.getUser.mockResolvedValueOnce({error:null,data:{user:{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}}});
    await expect(getVerifiedBrowserContext(f.client)).rejects.toThrow();
  });
  it("rechecks expiration before a privileged transaction",async()=>{
    vi.useFakeTimers(); const actor=await getVerifiedBrowserContext(fixture().client);
    vi.advanceTimersByTime(3600001); expect(()=>verifiedBrowserClaims(actor)).toThrow();
  });
});
