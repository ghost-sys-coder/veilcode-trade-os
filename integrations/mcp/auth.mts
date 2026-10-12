import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";
import { integrationSigningKeys, verifyIntegrationToken } from "../../services/integrations/verify-token.ts";
import { LocalMcpError, type LocalMcpConfig } from "./config.mts";
import type { CredentialStore } from "./vault.mts";

const tokenSchema = z.object({access_token:z.string().min(1).max(16384), refresh_token:z.string().min(1).max(16384),
  token_type:z.string().refine(value=>value.toLowerCase()==="bearer"), expires_in:z.number().int().positive().optional()});
const refreshResponseSchema=tokenSchema.extend({refresh_token:tokenSchema.shape.refresh_token.optional()});
const savedSchema = z.object({version:z.literal(1),resource:z.string(),issuer:z.string(),clientId:z.string(),
  accessToken:z.string().min(1).max(16384),refreshToken:z.string().min(1).max(16384),expiresAt:z.number().int().positive()}).strict();
export type SavedCredentials = z.infer<typeof savedSchema>;
type Verify = (token:string) => Promise<{exp:number;client_id:string}>;
export class LocalAuthorization {
  private config: LocalMcpConfig;
  private store: CredentialStore;
  private fetcher: typeof fetch;
  private verify: Verify;
  private credentials?: SavedCredentials;
  private refreshing?: Promise<string>;
  private blocked = false;
  constructor(config: LocalMcpConfig, store: CredentialStore, options: {fetch?: typeof fetch; verify?: Verify} = {}) {
    this.config=config; this.store=store; this.fetcher=options.fetch ?? fetch;
    const key=integrationSigningKeys(config.issuer);
    this.verify=options.verify ?? (token=>verifyIntegrationToken(token,{issuer:config.issuer,resource:config.resource,key}));
  }
  async load() {
    const parsed=savedSchema.safeParse(await this.store.load());
    if (!parsed.success) throw new LocalMcpError("LOGIN_REQUIRED");
    const value=parsed.data;
    if(value.resource!==this.config.resource || value.issuer!==this.config.issuer || value.clientId!==this.config.clientId)
      throw new LocalMcpError("LOGIN_REQUIRED");
    this.credentials=value;
    // Expired tokens renew before verification, never trust a decoded JWT alone.
    await this.accessToken();
  }
  async discovery() {
    const origin=new URL(this.config.resource).origin;
    const resource=await this.json(`${origin}/.well-known/oauth-protected-resource/mcp`);
    if(resource.resource!==this.config.resource || !Array.isArray(resource.authorization_servers) ||
      resource.authorization_servers.length!==1 || resource.authorization_servers[0]!==this.config.issuer)
      throw new LocalMcpError("INVALID_DISCOVERY");
    const issuer=new URL(this.config.issuer);
    let metadata:Record<string,unknown>;
    try {metadata=await this.json(`${this.config.issuer}/.well-known/oauth-authorization-server`);}
    catch(error) {
      if(!(error instanceof LocalMcpError) || error.code!=="DISCOVERY_NOT_FOUND")throw error;
      metadata=await this.json(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`);
    }
    if(metadata.issuer!==this.config.issuer || metadata.authorization_endpoint!==`${this.config.issuer}/oauth/authorize` ||
      metadata.token_endpoint!==`${this.config.issuer}/oauth/token` ||
      !Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes("S256") ||
      !Array.isArray(metadata.token_endpoint_auth_methods_supported) || !metadata.token_endpoint_auth_methods_supported.includes("none"))
      throw new LocalMcpError("INVALID_DISCOVERY");
  }
  private async json(url:string, init?: RequestInit): Promise<Record<string,unknown>> {
    const response=await this.fetcher(url,{...init,redirect:"error",signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new LocalMcpError(response.status===404 ? "DISCOVERY_NOT_FOUND" : response.status===400||response.status===401||response.status===403 ? "ACCESS_DENIED" : "UNAVAILABLE");
    const text=await response.text();
    if(text.length>131072) throw new LocalMcpError("UNAVAILABLE");
    return JSON.parse(text) as Record<string,unknown>;
  }
  async accept(response: unknown) {
    const tokens=tokenSchema.parse(response);
    const claims=await this.verify(tokens.access_token);
    if(claims.client_id!==this.config.clientId) throw new LocalMcpError("ACCESS_DENIED");
    const credentials: SavedCredentials={version:1,resource:this.config.resource,issuer:this.config.issuer,clientId:this.config.clientId,
      accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt:claims.exp};
    await this.store.save(credentials); this.credentials=credentials; this.blocked=false;
  }
  async accessToken(): Promise<string> {
    if(this.blocked || !this.credentials) throw new LocalMcpError("LOGIN_REQUIRED");
    if(this.credentials.expiresAt<=Math.floor(Date.now()/1000)+60) return this.refresh();
    let claims:{exp:number;client_id:string};
    try {claims=await this.verify(this.credentials.accessToken);}
    catch {throw new LocalMcpError("ACCESS_DENIED");}
    if(claims.client_id!==this.config.clientId) throw new LocalMcpError("ACCESS_DENIED");
    return this.credentials.accessToken;
  }
  async refresh(): Promise<string> {
    if(this.refreshing) return this.refreshing;
    if(this.blocked || !this.credentials) throw new LocalMcpError("LOGIN_REQUIRED");
    this.refreshing=(async()=>{
      let stage: NonNullable<LocalMcpError["refreshStage"]>="PRE_CLEAR";
      try {
        const refreshToken=this.credentials!.refreshToken;
        // Durably invalidate the old rotating secret BEFORE the request. A
        // process crash/lost response must require login, not replay a refresh
        // whose rotation may already have committed at the provider.
        await this.store.clear();
        stage="PROVIDER_REQUEST";
        const response=await this.json(`${this.config.issuer}/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
          body:new URLSearchParams({grant_type:"refresh_token",client_id:this.config.clientId,refresh_token:refreshToken,resource:this.config.resource})});
        stage="TOKEN_RESPONSE";
        const tokens=refreshResponseSchema.parse(response);
        // A verified successful response may omit a replacement refresh token
        // (documented OAuth behavior). Only then retain the previously validated
        // token. Null/empty/malformed values and uncertain responses NEVER fall
        // back. The old credential remains durably cleared until this succeeds.
        stage="TOKEN_VERIFICATION";
        const claims=await this.verify(tokens.access_token);
        if(claims.client_id!==this.config.clientId)throw new LocalMcpError("ACCESS_DENIED");
        const credentials: SavedCredentials={version:1,resource:this.config.resource,issuer:this.config.issuer,clientId:this.config.clientId,
          accessToken:tokens.access_token,refreshToken:tokens.refresh_token??refreshToken,expiresAt:claims.exp};
        stage="CREDENTIAL_SAVE";
        await this.store.save(credentials);this.credentials=credentials;this.blocked=false;
        return this.credentials!.accessToken;
      } catch {
        // Rotation may have committed even if response/save was lost. Do not reuse
        // a potentially consumed refresh token or retry an uncertain mutation.
        this.blocked=true;
        await this.store.clear().catch(()=>{});
        throw new LocalMcpError("REFRESH_UNCERTAIN",stage);
      } finally { this.refreshing=undefined; }
    })();
    return this.refreshing;
  }
  async login(openBrowser:(url:string)=>Promise<void>, timeout=180000) {
    await this.discovery();
    const verifier=randomBytes(48).toString("base64url"), state=randomBytes(32).toString("base64url");
    const redirect=new URL(this.config.redirectUri);
    let resolveCode:(value:string)=>void, rejectCode:(error:unknown)=>void;
    const code=new Promise<string>((resolve,reject)=>{resolveCode=resolve;rejectCode=reject;});
    void code.catch(()=>{});
    let consumed=false;
    const server=createServer({maxHeaderSize:8192},(request,response)=>{
      let valid=false, denied=false, value:string|null=null;
      try {
        const url=new URL(request.url!,redirect);
        const received=url.searchParams.get("state")??"";
        valid=request.method==="GET" && request.socket.remoteAddress==="127.0.0.1" && request.headers.host===redirect.host &&
          !request.headers.origin && (request.url?.length??0)<=8192 && url.pathname==="/callback" &&
          url.searchParams.getAll("state").length===1 && received.length===state.length &&
          timingSafeEqual(Buffer.from(received),Buffer.from(state)) && !consumed;
        denied=valid && url.searchParams.get("error")==="access_denied" && url.searchParams.getAll("error").length===1 &&
          [...url.searchParams.keys()].every(key=>["error","state"].includes(key));
        value=url.searchParams.get("code"); valid=valid && url.searchParams.getAll("code").length===1 &&
          [...url.searchParams.keys()].every(key=>["code","state"].includes(key)) && Boolean(value) && value!.length<=4096;
      } catch { valid=false; }
      response.writeHead(valid||denied?200:400,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer",
        "Content-Security-Policy":"default-src 'none'"});
      response.end(valid?"<h1>Trade OS authorization received</h1><p>You can close this tab. Check the terminal for connection verification.</p>":denied?"Authorization declined. You can close this tab.":"Callback rejected");
      if(valid){consumed=true;resolveCode!(value!);}
      if(denied){consumed=true;rejectCode!(new LocalMcpError("ACCESS_DENIED"));}
    });
    server.requestTimeout=2000;server.headersTimeout=2000;server.setTimeout(2000,socket=>socket.destroy());
    const timer=setTimeout(()=>rejectCode!(new LocalMcpError("LOGIN_TIMEOUT")),timeout);
    try {
      await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen({host:"127.0.0.1",port:Number(redirect.port),exclusive:true},resolve);});
      const authorize=new URL(`${this.config.issuer}/oauth/authorize`);
      authorize.search=new URLSearchParams({client_id:this.config.clientId,redirect_uri:this.config.redirectUri,response_type:"code",scope:"email",
        state,resource:this.config.resource,code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url")}).toString();
      await openBrowser(authorize.href);
      const response=await this.json(`${this.config.issuer}/oauth/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({grant_type:"authorization_code",client_id:this.config.clientId,redirect_uri:this.config.redirectUri,
          code:await code,code_verifier:verifier,resource:this.config.resource})});
      await this.accept(response);
    } finally {clearTimeout(timer);server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }
  /** Resource-bound token only; never forward it to redirects/alternate origins. */
  authorizedFetch: typeof fetch = async (input, init) => {
    const url=input instanceof Request ? input.url : String(input);
    if(new URL(url).href!==this.config.resource) throw new LocalMcpError("ACCESS_DENIED");
    const headers=new Headers(init?.headers);headers.set("Authorization",`Bearer ${await this.accessToken()}`);
    const signal=init?.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    const response=await this.fetcher(input,{...init,headers,redirect:"error",signal});
    if(response.status===401||response.status===403) throw new LocalMcpError("ACCESS_DENIED");
    return response;
  };
}
