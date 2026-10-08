import { afterEach, describe, expect, it, vi } from "vitest";
import { configurationCreateSchema, configurationListSchema, configurationPatchSchema, recordVersionSchema,
  parseConfigurationCommand } from "@/domain/configuration/commands";
import { ApplicationWorkflowError, getConfiguration, listConfiguration, writeConfiguration } from "@/services/application/configuration";
import { configurationFormError } from "@/services/application/form-error";
import { IntegrationAuthorizationError } from "@/domain/integrations/actor";
import type { IntegrationContext } from "@/services/integrations/actor-context";
import type { VerifiedBrowserContext } from "@/services/integrations/browser-context";

const { verifiedIntegration, verifiedBrowser, createDb, query, connect, end, databaseConfig }=vi.hoisted(()=>({
  verifiedIntegration:vi.fn(),verifiedBrowser:vi.fn(),createDb:vi.fn(),query:vi.fn(),connect:vi.fn(),end:vi.fn(),databaseConfig:vi.fn(),
}));
vi.mock("pg",()=>({Client:class {constructor(){createDb();}query=query;connect=connect;end=end;}}));
vi.mock("@/services/integrations/actor-context",()=>({verifiedIntegrationClaims:verifiedIntegration}));
vi.mock("@/services/integrations/browser-context",()=>({verifiedBrowserClaims:verifiedBrowser}));
vi.mock("@/services/integrations/publication-database-config",()=>({publicationDatabaseConfig:databaseConfig}));
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const base={entity:"STRATEGY",operationId:id,values:{name:"Methodology",description:null,active:true}};
const context={actor:{purpose:"MCP"}} as IntegrationContext;
const record={id,user_id:id,name:"Methodology",description:null,active:true,record_version:"1",archived_at:null,
  created_at:"2026-10-08T00:00:00Z",updated_at:"2026-10-08T00:00:00Z",is_example:false};
afterEach(()=>vi.resetAllMocks());
function configure() {
  verifiedIntegration.mockReturnValue({sub:id,exp:9999999999});verifiedBrowser.mockReturnValue({sub:id,exp:9999999999});
  query.mockResolvedValue({rows:[]});connect.mockResolvedValue(undefined);end.mockResolvedValue(undefined);
}
describe("configuration command boundaries",()=>{
  it("adapter adds the action after strict schema validation",()=>{
    expect(parseConfigurationCommand("CREATE",base)).toEqual({...base,action:"CREATE"});
    expect(configurationCreateSchema.safeParse({...base,action:"CREATE"}).success).toBe(false);
  });
  it("omission and nullable clearing remain different in patches",()=>{
    const patch=configurationPatchSchema.parse({entity:"STRATEGY",operationId:id,id,expectedVersion:"1",values:{description:null}});
    expect(patch.values).toEqual({description:null});expect("name" in patch.values).toBe(false);
  });
  it.each([{user_id:id},{record_version:"12"},{archived_at:"2026-10-08T00:00:00Z"},{id}])("rejects protected/owner fields %j",extra=>{
    expect(configurationCreateSchema.safeParse({...base,values:{...base.values,...extra}}).success).toBe(false);
  });
  it.each([{}, {active:null}, {name:null}])("rejects invalid patches %j",values=>{
    expect(configurationPatchSchema.safeParse({entity:"STRATEGY",operationId:id,id,expectedVersion:"1",values}).success).toBe(false);
  });
  it.each([0,101,1.5])("bounds list size %s",limit=>expect(configurationListSchema.safeParse({entity:"RULE",limit}).success).toBe(false));
  it("preserves 64-bit versions without JavaScript number conversions",()=>{
    expect(recordVersionSchema.parse("9223372036854775807")).toBe("9223372036854775807");
    expect(recordVersionSchema.safeParse("9223372036854775808").success).toBe(false);
    expect(recordVersionSchema.safeParse(1).success).toBe(false);
  });
  it("rejects numeric rule limits and accepts exact decimal strings",()=>{
    const input={...base,entity:"RULE",values:{name:"Risk",description:"Explicit risk limit",active:true,account_id:null,rule_type:"MAX_RISK_PERCENT",numeric_limit:"0.00000001"}};
    expect(configurationCreateSchema.safeParse(input).success).toBe(true);
    expect(configurationCreateSchema.safeParse({...input,values:{...input.values,numeric_limit:0.1}}).success).toBe(false);
  });
});
describe("verified shared application service",()=>{
  it("rejects forged or expired contexts before opening a socket",async()=>{
    configure();verifiedIntegration.mockImplementation(()=>{throw new IntegrationAuthorizationError();});
    await expect(writeConfiguration(context,"CREATE",base)).rejects.toThrow(IntegrationAuthorizationError);
    expect(createDb).not.toHaveBeenCalled();
  });
  it("never promotes an account-bound MT5 actor into MCP permissions",async()=>{
    configure();await expect(listConfiguration({actor:{purpose:"MT5"}} as IntegrationContext,{entity:"STRATEGY"})).rejects.toThrow();
    expect(createDb).not.toHaveBeenCalled();
  });
  it("commits the fixed private call, consumes the result and closes its connection",async()=>{
    configure();query.mockImplementation(async(sql:string)=>({rows:sql.includes("configuration_write")?[{result:{entity:"STRATEGY",action:"CREATE",record}}]:[]}));
    expect(await writeConfiguration(context,"CREATE",base)).toEqual({entity:"STRATEGY",action:"CREATE",record});
    const writeCall=query.mock.calls.find(call=>call[0]==="select private.configuration_write($1::jsonb) as result");
    expect(JSON.parse(writeCall![1][0])).toEqual({...base,action:"CREATE"});
    expect(query).toHaveBeenCalledWith("commit");expect(end).toHaveBeenCalledOnce();
  });
  it("uses browser provenance independently without fabrication",async()=>{
    configure();query.mockImplementation(async(sql:string)=>({rows:sql.includes("configuration_read")?[{result:record}]:[]}));
    await getConfiguration({userId:id} as VerifiedBrowserContext,{entity:"STRATEGY",id});
    expect(verifiedBrowser).toHaveBeenCalledOnce();expect(verifiedIntegration).not.toHaveBeenCalled();
  });
  it.each([["40001","VERSION_CONFLICT"],["23505","OPERATION_CONFLICT"],["P0002","NOT_FOUND"],
    ["42501","ACCESS_DENIED"],["23514","INVALID_REFERENCE"],["UNKNOWN","UNAVAILABLE"]])("rolls back %s without leaking database detail",async(state,code)=>{
    configure();query.mockImplementation(async(sql:string)=>{if(sql.includes("configuration_write"))throw {code:state,message:"PRIVATE_TEST_VALUE"};return {rows:[]};});
    await expect(writeConfiguration(context,"CREATE",base)).rejects.toMatchObject({code});
    expect(query).toHaveBeenCalledWith("rollback");expect(end).toHaveBeenCalledOnce();
    expect(configurationFormError(new ApplicationWorkflowError(code as ConstructorParameters<typeof ApplicationWorkflowError>[0]))).not.toContain("PRIVATE_TEST_VALUE");
  });
  it("redacts unexpected exception messages in form redirects",()=>{
    expect(configurationFormError(new Error("PRIVATE_TEST_VALUE"))).not.toContain("PRIVATE_TEST_VALUE");
  });
  it.each(["42883","42P01","42703"])("identifies missing schema dependencies (%s) without leaking SQL",async state=>{
    configure();query.mockImplementation(async(sql:string)=>{if(sql.includes("configuration_read"))throw {code:state,message:"PRIVATE_TEST_VALUE"};return {rows:[]};});
    await expect(listConfiguration(context,{entity:"STRATEGY"})).rejects.toMatchObject({code:"SCHEMA_NOT_READY"});
    expect(query).toHaveBeenCalledWith("rollback");expect(end).toHaveBeenCalledOnce();
  });
  it("does not describe a failed read as an uncertain write",async()=>{
    configure();connect.mockRejectedValue({code:"ECONNREFUSED",message:"PRIVATE_TEST_VALUE"});
    await expect(listConfiguration(context,{entity:"STRATEGY"})).rejects.toMatchObject({code:"READ_UNAVAILABLE"});
    expect(new ApplicationWorkflowError("READ_UNAVAILABLE").message).not.toContain("operation status");
  });
  it("distinguishes invalid server configuration from transient connectivity",async()=>{
    configure();databaseConfig.mockImplementation(()=>{throw new Error("MT5_PUBLICATION_DATABASE_UNAVAILABLE");});
    await expect(listConfiguration(context,{entity:"STRATEGY"})).rejects.toMatchObject({code:"DATABASE_NOT_CONFIGURED"});
    expect(createDb).not.toHaveBeenCalled();
  });
  it("distinguishes a duplicate configuration name from reused operation payloads",async()=>{
    configure();query.mockImplementation(async(sql:string)=>{if(sql.includes("configuration_write"))throw {code:"23505",constraint:"strategies_owner_name_unique"};return {rows:[]};});
    await expect(writeConfiguration(context,"CREATE",base)).rejects.toMatchObject({code:"DUPLICATE_NAME"});
  });
});
