import "server-only";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { getIntegrationContext, verifiedIntegrationClaims } from "@/services/integrations/actor-context";
import { getIntegrationOperation } from "@/services/integrations/operation-status";
import { getIntegrationConfig } from "@/config/integrations";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { createTradeOsMcpServer } from "@/lib/mcp/server";
import { getConfiguration, listConfiguration, writeConfiguration } from "@/services/application/configuration";
import { getAccount, listAccounts, writeAccount } from "@/services/application/accounts";
import { listAccountEvents,writeAccountEvent } from "@/services/application/account-events";
import { listTrades,getTrade,writeTrade,listTradeReferences } from "@/services/application/trades";

/** No cookie login, in-memory session map, or caller-submitted owner identity. */
export async function handleMcpRequest(request:Request):Promise<Response> {
  try {
    const configured = new URL(getIntegrationConfig("MCP").resource);
    // Next's dev adapter may normalize request.url to localhost even when the
    // socket Host is 127.0.0.1. Validate the actual Host for DNS rebinding; never
    // trust caller-supplied X-Forwarded-Host. Plain Request fixtures use URL host.
    const targetHost=request.headers.get("host") ?? new URL(request.url).host;
    const origin=request.headers.get("Origin");
    if(targetHost!==configured.host || (origin!==null && origin!==configured.origin)) {
      return Response.json({error:"INVALID_MCP_ORIGIN"},{status:403,headers:{"Cache-Control":"no-store"}});
    }
    const context=await getIntegrationContext(request,"MCP");
    verifiedIntegrationClaims(context);
    if(request.method!=="POST")return new Response(null,{status:405,headers:{Allow:"POST","Cache-Control":"no-store"}});
    const handler=createMcpHandler(()=>createTradeOsMcpServer({operationStatus:id=>getIntegrationOperation(context,id),
      configurationList:input=>listConfiguration(context,input), configurationGet:input=>getConfiguration(context,input),
      configurationWrite:(action,input)=>writeConfiguration(context,action,input), accountsList:input=>listAccounts(context,input),
      accountsGet:input=>getAccount(context,input), accountsWrite:(action,input)=>writeAccount(context,action,input),
      accountEventsList:input=>listAccountEvents(context,input),accountEventsWrite:(action,input)=>writeAccountEvent(context,action,input),
      tradesList:input=>listTrades(context,input),tradesGet:input=>getTrade(context,input),tradesWrite:(action,input)=>writeTrade(context,action,input),tradeInstruments:input=>listTradeReferences(context,input)}),
      {responseMode:"json",legacy:"stateless",maxRequestBodySize:1_048_576,maxSubscriptions:0});
    try {
      const response=await handler.fetch(request);
      response.headers.set("Cache-Control","no-store");
      return response;
    } finally { await handler.close(); }
  } catch(error) { return integrationErrorResponse(error,"MCP"); }
}
