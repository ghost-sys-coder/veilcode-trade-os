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
      "tradeos_configuration_list","tradeos_configuration_get",
      "tradeos_screenshots_list","tradeos_screenshots_get","tradeos_screenshot_upload_request","tradeos_screenshot_upload_status","tradeos_screenshot_upload_chunk","tradeos_screenshot_upload_finish","tradeos_screenshot_download",
      "tradeos_configuration_create","tradeos_configuration_patch","tradeos_configuration_archive",
      "tradeos_accounts_list","tradeos_accounts_get","tradeos_accounts_create","tradeos_accounts_patch",
      "tradeos_account_events_list","tradeos_adjustment_create","tradeos_adjustment_classify","tradeos_snapshot_record","tradeos_account_transition","tradeos_account_link_funded",
      "tradeos_trades_list","tradeos_trades_get","tradeos_trades_create","tradeos_trades_patch","tradeos_trade_targets","tradeos_trade_correct_plan","tradeos_trade_management","tradeos_trade_review","tradeos_trade_instruments","tradeos_journals_get","tradeos_journals_list","tradeos_journals_save","tradeos_goals_get","tradeos_goals_list","tradeos_goals_create","tradeos_goals_patch","tradeos_goals_archive","tradeos_goal_progress_list","tradeos_goal_progress_record","tradeos_prop_get","tradeos_prop_save","tradeos_progress_get",
      "tradeos_references_list","tradeos_references_get","tradeos_references_create","tradeos_references_patch","tradeos_references_archive","tradeos_trade_tags_list","tradeos_trade_tags_assign","tradeos_trade_tags_remove",
      "tradeos_journal_summary","tradeos_analytics_performance","tradeos_analytics_behavior","tradeos_calendar","tradeos_journal_export","tradeos_analytics_balance_curve","tradeos_profile_get","tradeos_profile_patch","tradeos_mt5_list","tradeos_mt5_get","tradeos_mt5_preview","tradeos_mt5_sources","tradeos_mt5_review","tradeos_imports_list","tradeos_imports_get","tradeos_import_rows","tradeos_mt5_grants","tradeos_mt5_map_account","tradeos_mt5_symbol_map","tradeos_mt5_cash_classify","tradeos_mt5_publish","tradeos_mt5_onboarding_approve","tradeos_mt5_publication_policy","tradeos_mt5_control","tradeos_mt5_matches"]);
    const contracts=await client.listResources();expect(contracts.resources).toHaveLength(7);
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
  },15000);
  it("supports legacy stateless MCP and rejects numeric monetary inputs and secret-bearing errors",async()=>{
    const unavailableService=async()=>{throw new Error("PRIVATE_TEST_VALUE");};
    const unavailableFiles={screenshotsList:unavailableService,screenshotsGet:unavailableService,screenshotUploadRequest:unavailableService,
      screenshotUploadStatus:unavailableService,screenshotUploadChunk:unavailableService,screenshotUploadFinish:unavailableService,screenshotDownload:unavailableService};
    const handler=createMcpHandler(()=>createTradeOsMcpServer({...unavailableFiles,mt5Grants:unavailableService,mt5MapAccount:unavailableService,mt5SymbolMap:unavailableService,mt5CashClassify:unavailableService,mt5Publish:unavailableService,mt5OnboardingApprove:unavailableService,mt5PublicationPolicy:unavailableService,mt5Control:unavailableService,mt5Matches:unavailableService,mt5List:unavailableService,mt5Get:unavailableService,mt5Preview:unavailableService,mt5Sources:unavailableService,mt5Review:unavailableService,importsList:unavailableService,importsGet:unavailableService,importRows:unavailableService,profileGet:unavailableService,profilePatch:unavailableService,balanceCurve:unavailableService,journalSummary:unavailableService,analyticsPerformance:unavailableService,analyticsBehavior:unavailableService,calendar:unavailableService,journalExport:unavailableService,referencesList:unavailableService,referencesGet:unavailableService,referencesWrite:unavailableService,tradeTagsList:unavailableService,tradeTagsWrite:unavailableService,operationStatus:unavailableService,configurationList:unavailableService,
      configurationGet:unavailableService,configurationWrite:unavailableService,accountsList:unavailableService,accountsGet:unavailableService,accountsWrite:unavailableService,
      accountEventsList:unavailableService,accountEventsWrite:unavailableService,tradesList:unavailableService,tradesGet:unavailableService,tradesWrite:unavailableService,tradeInstruments:unavailableService,journalsGet:unavailableService,journalsList:unavailableService,journalsSave:unavailableService,goalsGet:unavailableService,goalsList:unavailableService,goalProgressList:unavailableService,propGet:unavailableService,progressWrite:unavailableService,progressGet:unavailableService}),{responseMode:"json"});
    try {
      const request=(id:number,method:string,params:object)=>handler.fetch(new Request(`${origin}/mcp`,{method:"POST",
        headers:{"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-11-25"},
        body:JSON.stringify({jsonrpc:"2.0",id,method,params})}));
      const responseJson=async(response:Response)=>{const body=await response.text();return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream")?body.split("\n").find(line=>line.startsWith("data: "))!.slice(6):body);};
      const listing=await responseJson(await request(1,"tools/list",{}));expect(listing.result.tools).toHaveLength(80);
      const rejected=await responseJson(await request(2,"tools/call",{name:"tradeos_position_size",arguments:{balance:100000,currency:"USD",currencyPrecision:2,
        riskMethod:"PERCENTAGE",riskValue:"1",instrumentSymbol:"EURUSD",direction:"BUY",entryPrice:"1.10000",stopLossPrice:"1.09800"}}));
      expect(rejected.result?.isError||rejected.error).toBeTruthy();
      const unavailable=await responseJson(await request(3,"tools/call",{name:"tradeos_operation_status",arguments:{operationId}}));
      expect(unavailable.result.isError).toBe(true);expect(JSON.stringify(unavailable)).not.toContain("PRIVATE_TEST_VALUE");
    } finally {await handler.close();}
  });
});
