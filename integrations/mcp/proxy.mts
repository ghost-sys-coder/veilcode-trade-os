import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Server, ProtocolError } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { safeMessage, type LocalMcpConfig } from "./config.mts";
import type { LocalAuthorization } from "./auth.mts";

/** Transport adapter, not a second tool implementation. Schemas and all writes
 * come from the owner-scoped remote service with live grant checks every time. */
export function createProxyServer(remote: Client): Server {
  const server=new Server({name:"trade-os-stdio",version:"1.0.0"},{capabilities:{tools:{},resources:{}},
    instructions:"Trade OS authenticated adapter. Keep decimal strings and operation IDs unchanged. On an uncertain write, use tradeos_operation_status before retrying the identical operation. Permanent deletion requires the owner's browser approval."});
  async function guarded<T>(work:()=>Promise<T>):Promise<T> {
    try{return await work();}catch(error){throw new ProtocolError(-32603,safeMessage(error));}
  }
  server.setRequestHandler("tools/list",(request,ctx)=>guarded(()=>remote.listTools(request.params,{signal:ctx.mcpReq.signal,cacheMode:"refresh"})));
  server.setRequestHandler("tools/call",(request,ctx)=>guarded(()=>remote.callTool(request.params,{signal:ctx.mcpReq.signal})));
  server.setRequestHandler("resources/list",(request,ctx)=>guarded(()=>remote.listResources(request.params,{signal:ctx.mcpReq.signal,cacheMode:"bypass"})));
  server.setRequestHandler("resources/read",(request,ctx)=>guarded(()=>remote.readResource(request.params,{signal:ctx.mcpReq.signal,cacheMode:"bypass"})));
  server.setRequestHandler("resources/templates/list",(request,ctx)=>guarded(()=>remote.listResourceTemplates(request.params,{signal:ctx.mcpReq.signal,cacheMode:"bypass"})));
  return server;
}
export async function connectRemote(config:LocalMcpConfig,auth:LocalAuthorization) {
  const client=new Client({name:`trade-os-stdio-${config.profile}`,version:"1.0.0"},{versionNegotiation:{mode:{pin:"2026-07-28"}}});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(config.resource),{fetch:auth.authorizedFetch}));
    // Live grant/flag verification, not a successful local initialize alone.
    await client.listTools();
    return client;
  } catch(error) {await client.close().catch(()=>{});throw error;}
}
export function startStdio(remote:Client,onClose:()=>void) {
  const transport=new StdioServerTransport();
  const handle=serveStdio(()=>createProxyServer(remote),{transport,maxSubscriptions:0,onerror:()=>{
    process.stderr.write("Trade OS MCP: Invalid protocol request or transport failure.\n");
  }});
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await handle.close().catch(()=>{});await remote.close().catch(()=>{});onClose();};
  const original=transport.onclose;
  transport.onclose=()=>{original?.();void close();};
  process.once("SIGINT",()=>void close());process.once("SIGTERM",()=>void close());
  return close;
}
