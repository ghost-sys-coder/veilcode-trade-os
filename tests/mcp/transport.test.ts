import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createTradeOsMcpServer } from "@/lib/mcp/server";
import { handleMcpRequest } from "@/services/mcp/handle-request";
import { GET as metadata } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { IntegrationAuthorizationError, IntegrationUnavailableError } from "@/domain/integrations/actor";

const { authenticate, verified, lookup } = vi.hoisted(()=>({authenticate:vi.fn(),verified:vi.fn(),lookup:vi.fn()}));
vi.mock("@/services/integrations/actor-context",()=>({getIntegrationContext:authenticate,verifiedIntegrationClaims:verified}));
vi.mock("@/services/integrations/operation-status",()=>({getIntegrationOperation:lookup}));
const origin="https://trade.example";
const operationId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const activeClients:Client[]=[];
afterEach(async()=>{await Promise.all(activeClients.splice(0).map(client=>client.close()));vi.unstubAllEnvs();vi.resetAllMocks();});
function configure() {
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN",origin);vi.stubEnv("TRADE_OS_MCP_ENABLED","true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://project.supabase.co");vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","sb_publishable_fixture_key_for_tests_only");
  authenticate.mockResolvedValue({actor:{purpose:"MCP"}});verified.mockReturnValue({exp:9999999999});
  lookup.mockResolvedValue({operationId,status:"UNKNOWN"});
}
describe("MCP foundation authorization boundary",()=>{
  it("public discovery advertises the exact MCP resource without enabling user access",async()=>{
    configure();vi.stubEnv("TRADE_OS_MCP_ENABLED","false");
    const response=await metadata();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({resource:`${origin}/mcp`,authorization_servers:["https://project.supabase.co/auth/v1"]});
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("uses a MCP-specific challenge for missing, expired or revoked authentication",async()=>{
    configure();authenticate.mockRejectedValue(new IntegrationAuthorizationError());
    const response=await handleMcpRequest(new Request(`${origin}/mcp`,{method:"POST"}));
    expect(response.status).toBe(401);expect(response.headers.get("www-authenticate")).toContain(`${origin}/.well-known/oauth-protected-resource/mcp`);
    expect(authenticate).toHaveBeenCalledWith(expect.any(Request),"MCP");expect(lookup).not.toHaveBeenCalled();
  });
  it("rejects wrong hosts and cross-origin calls before authorization",async()=>{
    configure();for(const request of [new Request("https://wrong.example/mcp"),new Request(`${origin}/mcp`,{headers:{origin:"https://wrong.example"}}),
      new Request(`${origin}/mcp`,{headers:{host:"wrong.example","x-forwarded-host":"trade.example"}})]) {
      expect((await handleMcpRequest(request)).status).toBe(403);
    }
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("validates the actual Host when Next normalizes a loopback request URL",async()=>{
    configure();const response=await handleMcpRequest(new Request("http://localhost:3100/mcp",{headers:{host:"trade.example"}}));
    expect(response.status).toBe(405);expect(authenticate).toHaveBeenCalledOnce();
  });
  it("does not turn a provider outage into token rejection or expose private errors",async()=>{
    configure();authenticate.mockRejectedValue(new IntegrationUnavailableError());
    const response=await handleMcpRequest(new Request(`${origin}/mcp`));expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("15");
    authenticate.mockRejectedValue(new Error("PRIVATE_TEST_VALUE"));
    expect(await (await handleMcpRequest(new Request(`${origin}/mcp`))).text()).not.toContain("PRIVATE_TEST_VALUE");
  });
  it("authenticates stateless GET/DELETE without opening a persistent session",async()=>{
    configure();for(const method of ["GET","DELETE"]) {
      const response=await handleMcpRequest(new Request(`${origin}/mcp`,{method}));expect(response.status).toBe(405);
      expect(response.headers.get("mcp-session-id")).toBeNull();expect(response.headers.get("allow")).toBe("POST");
    }
    expect(authenticate).toHaveBeenCalledTimes(2);expect(verified).toHaveBeenCalledTimes(2);
  });
});
describe("official SDK interoperability",()=>{
  it.each(["legacy", "2026-07-28"] as const)("discovers contracts and calls structured tools across fresh authenticated HTTP requests (%s)",async(protocol)=>{
    configure();const responses:Response[]=[];
    const client=new Client({name:"trade-os-protocol-test",version:"1.0.0"},{versionNegotiation:{mode:protocol==="legacy"?"legacy":{pin:protocol}}});activeClients.push(client);
    const transport=new StreamableHTTPClientTransport(new URL(`${origin}/mcp`),{fetch:async(input,init)=>{
      const response=await handleMcpRequest(new Request(input,init));responses.push(response.clone());return response;
    }});
    await client.connect(transport);
    const tools=await client.listTools();expect(tools.tools.map(tool=>tool.name)).toEqual(["tradeos_capabilities","tradeos_position_size","tradeos_operation_status",
      "tradeos_configuration_list","tradeos_configuration_get","tradeos_configuration_create","tradeos_configuration_patch","tradeos_configuration_archive",
      "tradeos_accounts_list","tradeos_accounts_get","tradeos_accounts_create","tradeos_accounts_patch",
      "tradeos_account_events_list","tradeos_adjustment_create","tradeos_adjustment_classify","tradeos_snapshot_record","tradeos_account_transition","tradeos_account_link_funded",
      "tradeos_trades_list","tradeos_trades_get","tradeos_trades_create","tradeos_trades_patch","tradeos_trade_targets","tradeos_trade_correct_plan","tradeos_trade_management","tradeos_trade_review","tradeos_trade_instruments","tradeos_journals_get","tradeos_journals_list","tradeos_journals_save"]);
    const contracts=await client.listResources();expect(contracts.resources).toHaveLength(5);
    const money=await client.readResource({uri:"tradeos://v1/money"});expect(money.contents[0]).toMatchObject({mimeType:"application/json"});
    const calculation=await client.callTool({name:"tradeos_position_size",arguments:{balance:"100000",currency:"USD",currencyPrecision:2,
      riskMethod:"PERCENTAGE",riskValue:"1",instrumentSymbol:"EURUSD",direction:"BUY",entryPrice:"1.10000",stopLossPrice:"1.09800"}});
    expect(calculation.structuredContent).toMatchObject({riskAmount:"1000.00",lossPerLot:"200.00",recommendedVolume:"5.00"});
    const status=await client.callTool({name:"tradeos_operation_status",arguments:{operationId}});expect(status.structuredContent).toEqual({operationId,status:"UNKNOWN"});
    expect(lookup).toHaveBeenCalledWith(expect.any(Object),operationId);
    expect(authenticate.mock.calls.length).toBeGreaterThanOrEqual(5);expect(verified).toHaveBeenCalledTimes(authenticate.mock.calls.length);
    expect(responses.every(response=>response.headers.get("mcp-session-id")===null&&response.headers.get("cache-control")==="no-store")).toBe(true);
    authenticate.mockRejectedValue(new IntegrationAuthorizationError());
    await expect(client.callTool({name:"tradeos_operation_status",arguments:{operationId}})).rejects.toThrow();
  });
  it("supports legacy stateless MCP and rejects numeric monetary inputs and secret-bearing errors",async()=>{
    const unavailableService=async()=>{throw new Error("PRIVATE_TEST_VALUE");};
    const handler=createMcpHandler(()=>createTradeOsMcpServer({operationStatus:unavailableService,configurationList:unavailableService,
      configurationGet:unavailableService,configurationWrite:unavailableService,accountsList:unavailableService,accountsGet:unavailableService,accountsWrite:unavailableService,
      accountEventsList:unavailableService,accountEventsWrite:unavailableService,tradesList:unavailableService,tradesGet:unavailableService,tradesWrite:unavailableService,tradeInstruments:unavailableService,journalsGet:unavailableService,journalsList:unavailableService,journalsSave:unavailableService}),{responseMode:"json"});
    try {
      const request=(id:number,method:string,params:object)=>handler.fetch(new Request(`${origin}/mcp`,{method:"POST",
        headers:{"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-11-25"},
        body:JSON.stringify({jsonrpc:"2.0",id,method,params})}));
      const responseJson=async(response:Response)=>{const body=await response.text();return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream")?body.split("\n").find(line=>line.startsWith("data: "))!.slice(6):body);};
      const listing=await responseJson(await request(1,"tools/list",{}));expect(listing.result.tools).toHaveLength(30);
      const rejected=await responseJson(await request(2,"tools/call",{name:"tradeos_position_size",arguments:{balance:100000,currency:"USD",currencyPrecision:2,
        riskMethod:"PERCENTAGE",riskValue:"1",instrumentSymbol:"EURUSD",direction:"BUY",entryPrice:"1.10000",stopLossPrice:"1.09800"}}));
      expect(rejected.result?.isError||rejected.error).toBeTruthy();
      const unavailable=await responseJson(await request(3,"tools/call",{name:"tradeos_operation_status",arguments:{operationId}}));
      expect(unavailable.result.isError).toBe(true);expect(JSON.stringify(unavailable)).not.toContain("PRIVATE_TEST_VALUE");
    } finally {await handler.close();}
  });
});
