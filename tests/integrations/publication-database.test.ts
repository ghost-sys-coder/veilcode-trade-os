import { beforeEach,afterEach,describe,expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { getVerifiedBrowserContext,type VerifiedBrowserContext } from "@/services/integrations/browser-context";
import { mt5PublicationTransaction,mt5SymbolMappingTransaction,mt5CashTransaction,mt5OnboardingTransaction } from "@/services/integrations/publication-database";
import { mt5PublicationRequestSchema } from "@/domain/mt5/publication";
import { mt5CashRequestSchema } from "@/domain/mt5/cash";
import { mt5OnboardingRequestSchema } from "@/domain/mt5/onboarding-approval";

const driver=vi.hoisted(()=>({construct:vi.fn(),connect:vi.fn(),query:vi.fn(),end:vi.fn()}));
vi.mock("pg",()=>({Client:class {
  constructor(configuration:unknown){driver.construct(configuration);}
  connect=driver.connect; query=driver.query; end=driver.end;
}}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request=mt5PublicationRequestSchema.parse({connectionId:id,operationId:id,version:"1",snapshotToken:"a".repeat(64),ledgerToken:"b".repeat(64),
  openingBaseline:"1000",reason:"Approve verified execution history",episodeIdentities:[`${id}:100:1:BUY`]});
async function actor() {
  return getVerifiedBrowserContext({auth:{getClaims:async()=>({error:null,data:{claims:{sub:id,session_id:id,role:"authenticated",exp:Math.floor(Date.now()/1000)+3600}}}),
    getUser:async()=>({error:null,data:{user:{id}}})}} as unknown as SupabaseClient<IntegrationDatabase>);
}
beforeEach(()=>{
  vi.resetAllMocks(); vi.stubEnv("TRADE_OS_LOCAL_TEST_APP","true");
  vi.stubEnv("TRADE_OS_LOCAL_DATABASE_URL","postgresql://postgres:fixture@127.0.0.1:54322/postgres");
  driver.connect.mockResolvedValue(undefined);driver.end.mockResolvedValue(undefined);driver.query.mockResolvedValue({rows:[{result:null}]});
});
afterEach(()=>vi.unstubAllEnvs());
describe("private publication transaction boundary",()=>{
  it.each(["CASH","ONBOARDING"] as const)("uses fixed %s calls and SQL null for receipt-only retries",async(kind)=>{
    const decision=kind==="CASH"?mt5CashRequestSchema.parse({connectionId:id,operationId:id,version:"1",snapshotToken:request.snapshotToken,ledgerToken:request.ledgerToken,
      sourceTicket:"100",sourceRevisionId:"1",disposition:"ZERO_EFFECT",adjustmentType:null,isPerformanceNeutral:null,existingAdjustmentId:null,reason:request.reason})
      :mt5OnboardingRequestSchema.parse({connectionId:id,operationId:id,version:"1",snapshotToken:request.snapshotToken,ledgerToken:request.ledgerToken,
        openingBaseline:"1000",availableHistoryConfirmed:true,reason:request.reason});
    const invoke=(context:VerifiedBrowserContext,proposal?:object)=>kind==="CASH"
      ?mt5CashTransaction(context,decision as Parameters<typeof mt5CashTransaction>[1],proposal)
      :mt5OnboardingTransaction(context,decision as Parameters<typeof mt5OnboardingTransaction>[1],proposal);
    const sql=`select private.${kind==="CASH"?"mt5_classify_cash":"mt5_approve_onboarding"}($1::jsonb,$2::jsonb) as result`;
    await invoke(await actor());
    expect(driver.query.mock.calls[2]).toEqual([sql,[JSON.stringify(decision),null]]);
    await expect(invoke({userId:id} as VerifiedBrowserContext)).rejects.toThrow();
    expect(driver.construct).toHaveBeenCalledTimes(1);
    driver.query.mockClear(); await invoke(await actor(),{trusted:true});
    expect(driver.query.mock.calls[2]).toEqual([sql,[JSON.stringify(decision),JSON.stringify({trusted:true})]]);
    driver.query.mockImplementation(async(query:string)=>{if(query===sql)throw {code:"23514",message:"private financial evidence"};return {rows:[]};});
    await expect(invoke(await actor(),{})).rejects.toThrow("MT5_PUBLICATION_REVIEW_REQUIRED");
    expect(driver.query).toHaveBeenLastCalledWith("rollback");
  });
  it("uses the fixed private mapping call with verified context",async()=>{
    const mapping={connectionId:id,operationId:id,version:"1",snapshotToken:"a".repeat(64),brokerSymbol:"EURUSD.m",instrumentId:id,reason:"Confirmed broker alias"};
    await mt5SymbolMappingTransaction(await actor(),mapping);
    expect(driver.query.mock.calls[2]).toEqual(["select private.mt5_save_symbol_mapping($1::jsonb) as result",[JSON.stringify(mapping)]]);
    await expect(mt5SymbolMappingTransaction({userId:id} as VerifiedBrowserContext,mapping)).rejects.toThrow();
    expect(driver.construct).toHaveBeenCalledTimes(1);
  });
  it("uses one connection and transaction with fixed queries and verified claims",async()=>{
    expect(await mt5PublicationTransaction(await actor(),request)).toBe(null);
    expect(driver.query.mock.calls.map(call=>call[0])).toEqual(["begin","select set_config('request.jwt.claims',$1,true)",
      "select private.mt5_browser_publication_result($1::jsonb) as result","commit"]);
    expect(JSON.parse(driver.query.mock.calls[1][1][0])).toMatchObject({sub:id,session_id:id,role:"authenticated"});
    expect(driver.connect).toHaveBeenCalledTimes(1);expect(driver.end).toHaveBeenCalledTimes(1);
  });
  it("passes a trusted proposal only as a parameter to the private fixed publisher",async()=>{
    const proposal={episodes:[]}; await mt5PublicationTransaction(await actor(),request,proposal);
    expect(driver.query.mock.calls[2]).toEqual(["select private.mt5_publish_browser($1::jsonb,$2::jsonb) as result",[JSON.stringify(request),JSON.stringify(proposal)]]);
  });
  it("rejects a forged actor before opening a privileged database connection",async()=>{
    await expect(mt5PublicationTransaction({userId:id} as VerifiedBrowserContext,request)).rejects.toThrow();
    expect(driver.construct).not.toHaveBeenCalled();
  });
  it("rolls back a conflict and does not expose raw PostgreSQL details",async()=>{
    driver.query.mockImplementation(async(sql:string)=>{
      if(sql.includes("mt5_publish_browser")) throw {code:"40001",message:"sensitive raw SQL and connection details"};
      return {rows:[]};
    });
    await expect(mt5PublicationTransaction(await actor(),request,{})).rejects.toThrow("MT5_PUBLICATION_REVIEW_REQUIRED");
    expect(driver.query).toHaveBeenLastCalledWith("rollback");expect(driver.end).toHaveBeenCalledTimes(1);
    expect(driver.query.mock.calls.some(call=>call[0]==="commit")).toBe(false);
  });
  it("reports an uncertain commit as unavailable, leaving retries to durable receipts",async()=>{
    driver.query.mockImplementation(async(sql:string)=>{
      if(sql==="commit") throw {code:"08006",message:"connection disappeared after server commit"};
      return {rows:[{result:{committed:true}}]};
    });
    await expect(mt5PublicationTransaction(await actor(),request,{})).rejects.toThrow("MT5_PUBLICATION_UNAVAILABLE");
    expect(driver.end).toHaveBeenCalledTimes(1);
  });
});
