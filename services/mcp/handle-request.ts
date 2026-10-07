import "server-only";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { getIntegrationContext, verifiedIntegrationClaims } from "@/services/integrations/actor-context";
import { getIntegrationOperation } from "@/services/integrations/operation-status";
import { getIntegrationConfig } from "@/config/integrations";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { createTradeOsMcpServer } from "@/lib/mcp/server";

/** No cookie login, in-memory session map, or caller-submitted owner identity. */
export async function handleMcpRequest(request:Request):Promise<Response> {
  try {
    const configured = new URL(getIntegrationConfig("MCP").resource);
    const target = new URL(request.url);
    const origin=request.headers.get("Origin");
    if(target.host!==configured.host || (origin!==null && origin!==configured.origin)) {
      return Response.json({error:"INVALID_MCP_ORIGIN"},{status:403,headers:{"Cache-Control":"no-store"}});
    }
    const context=await getIntegrationContext(request,"MCP");
    verifiedIntegrationClaims(context);
    if(request.method!=="POST")return new Response(null,{status:405,headers:{Allow:"POST","Cache-Control":"no-store"}});
    const handler=createMcpHandler(()=>createTradeOsMcpServer({operationStatus:id=>getIntegrationOperation(context,id)}),
      {responseMode:"json",legacy:"stateless",maxRequestBodySize:1_048_576,maxSubscriptions:0});
    try {
      const response=await handler.fetch(request);
      response.headers.set("Cache-Control","no-store");
      return response;
    } finally { await handler.close(); }
  } catch(error) { return integrationErrorResponse(error,"MCP"); }
}
