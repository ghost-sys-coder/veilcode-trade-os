import {afterEach,describe,expect,it,vi} from "vitest";
import {getIntegrationContext,verifiedIntegrationClaims} from "@/services/integrations/actor-context";

const f=vi.hoisted(()=>({verify:vi.fn(),rpc:vi.fn()}));
vi.mock("@/services/integrations/verify-token",()=>({verifyIntegrationToken:f.verify,integrationSigningKeys:()=>({})}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({rpc:f.rpc})}));
vi.mock("@/config/env",()=>({getSupabaseConfig:()=>({url:"https://provider.example",publishableKey:"public-fixture"})}));
vi.mock("@/config/integrations",()=>({getIntegrationConfig:()=>({enabled:true,resource:"https://trade.example/api/integrations/v1"})}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",resource="https://trade.example/api/integrations/v1";
const request=new Request(resource+"/session",{headers:{Authorization:"Bearer signed.fixture.token"}});
function fixture() {
  f.verify.mockResolvedValue({sub:id,client_id:id,session_id:id,role:"authenticated",exp:Math.floor(Date.now()/1000)+3600,
    iat:Math.floor(Date.now()/1000),iss:"https://provider.example/auth/v1",aud:["authenticated",resource],
    trade_os_grant_id:id,trade_os_grant_version:"1",trade_os_resource:resource});
  f.rpc.mockResolvedValue({error:null,data:{user_id:id,client_id:id,grant_id:id,grant_version:"1",purpose:"MT5",account_id:id,resource}});
}
afterEach(()=>vi.clearAllMocks());
describe("verified actor provenance for private transactions",()=>{
  it("retains signed issuer/audience and binds the exact live account context",async()=>{
    fixture();const context=await getIntegrationContext(request,"MT5");
    expect(verifiedIntegrationClaims(context).aud).toEqual(["authenticated",resource]);
    expect(verifiedIntegrationClaims(context).iss).toBe("https://provider.example/auth/v1");
    expect(Object.isFrozen(context)).toBe(true);expect(Object.isFrozen(context.actor)).toBe(true);
  });
  it("rejects a clone, cast or JSON owner/account injection as an unverified actor",async()=>{
    fixture();const context=await getIntegrationContext(request,"MT5");
    expect(()=>verifiedIntegrationClaims({...context})).toThrow();
    expect(()=>verifiedIntegrationClaims(JSON.parse(JSON.stringify(context)))).toThrow();
  });
  it("rejects mismatched live grant data after signature verification",async()=>{
    fixture();const response=await f.rpc();response.data.user_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    f.rpc.mockResolvedValue(response);await expect(getIntegrationContext(request,"MT5")).rejects.toThrow();
  });
  it("refuses expired provenance at the private transaction boundary",async()=>{
    fixture();const context=await getIntegrationContext(request,"MT5");
    const current=Date.now();vi.spyOn(Date,"now").mockReturnValue(current+7200_000);
    try{expect(()=>verifiedIntegrationClaims(context)).toThrow();}finally{vi.restoreAllMocks();}
  });
});
