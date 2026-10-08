import {beforeEach,describe,expect,it,vi} from "vitest";
import {applicationTransaction,type ApplicationContext} from "@/services/application/transaction";

const state=vi.hoisted(()=>({connect:vi.fn(),query:vi.fn(),end:vi.fn(),browser:vi.fn(),integration:vi.fn()}));
vi.mock("pg",()=>({Client:class {connect=state.connect;query=state.query;end=state.end;}}));
vi.mock("@/services/integrations/publication-database-config",()=>({publicationDatabaseConfig:()=>({})}));
vi.mock("@/services/integrations/browser-context",()=>({verifiedBrowserClaims:state.browser}));
vi.mock("@/services/integrations/actor-context",()=>({verifiedIntegrationClaims:state.integration}));
const context={} as ApplicationContext;
beforeEach(()=>{
  vi.resetAllMocks();state.connect.mockResolvedValue(undefined);state.end.mockResolvedValue(undefined);
  state.browser.mockReturnValue({role:"authenticated"});state.integration.mockReturnValue({role:"authenticated",client_id:"fixture"});
  state.query.mockResolvedValue({rows:[{result:{records:[],nextCursor:null}}]});
});
describe("application transaction mode and fixed workflow boundary",()=>{
  it("keeps browser reads consistent without forbidding authorization shared locks",async()=>{
    expect(await applicationTransaction(context,"CONFIGURATION_READ",{entity:"STRATEGY"})).toEqual({records:[],nextCursor:null});
    expect(state.browser).toHaveBeenCalledWith(context);
    expect(state.query).toHaveBeenCalledWith("begin isolation level repeatable read");
    expect(state.query.mock.calls.some(([sql])=>String(sql).includes("read only"))).toBe(false);
    expect(state.query).toHaveBeenCalledWith("select private.configuration_read($1::jsonb) as result",['{"entity":"STRATEGY"}']);
    expect(state.query).toHaveBeenCalledWith("commit");expect(state.end).toHaveBeenCalled();
  });
  it("uses the same consistent transaction for MCP progress and its verified grant claims",async()=>{
    const integration={actor:{purpose:"MCP"}} as ApplicationContext;
    await applicationTransaction(integration,"PROGRESS_DATA",{accountId:"fixture"});
    expect(state.integration).toHaveBeenCalledWith(integration);
    expect(state.query).toHaveBeenCalledWith("begin isolation level repeatable read");
    expect(state.query).toHaveBeenCalledWith("select private.application_progress_data($1::jsonb) as result",['{"accountId":"fixture"}']);
  });
  it("returns a durable write receipt before recalculation while retaining the write transaction",async()=>{
    const receipt={action:"GOAL_PROGRESS",goalVersion:"2"},prepare=vi.fn();
    state.query.mockImplementation(async(sql:string)=>({rows:[{result:sql.includes("_prepare")?{receipt}:null}]}));
    expect(await applicationTransaction(context,"PROGRESS_WRITE",{operationId:"fixture"},prepare)).toEqual(receipt);
    expect(state.query).toHaveBeenCalledWith("begin");expect(prepare).not.toHaveBeenCalled();
    expect(state.query.mock.calls.some(([sql])=>String(sql).includes("_write"))).toBe(false);
  });
  it("rolls failed reads back and exposes no private database details",async()=>{
    state.query.mockImplementation(async(sql:string)=>{if(sql.includes("_progress_data"))throw Object.assign(new Error("private fixture detail"),{code:"25006"});return {rows:[]};});
    await expect(applicationTransaction(context,"PROGRESS_DATA",{accountId:"fixture"})).rejects.toMatchObject({code:"READ_UNAVAILABLE"});
    expect(state.query).toHaveBeenCalledWith("rollback");expect(state.end).toHaveBeenCalled();
  });
});
