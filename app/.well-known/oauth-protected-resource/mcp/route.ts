import { getSupabaseConfig } from "@/config/env";
import { getIntegrationConfig } from "@/config/integrations";

export async function GET() {
  try {
    const {resource}=getIntegrationConfig("MCP");
    const {url}=getSupabaseConfig();
    return Response.json({resource,authorization_servers:[`${url.replace(/\/$/,"")}/auth/v1`],
      bearer_methods_supported:["header"],scopes_supported:["email"]},
    {headers:{"Cache-Control":"no-store","Access-Control-Allow-Origin":"*"}});
  } catch{return Response.json({error:"INTEGRATION_NOT_CONFIGURED"},{status:503});}
}
