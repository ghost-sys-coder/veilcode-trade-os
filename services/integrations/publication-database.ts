import "server-only";
import { Client } from "pg";
import { verifiedBrowserClaims,type VerifiedBrowserContext } from "@/services/integrations/browser-context";
import { publicationDatabaseConfig } from "@/services/integrations/publication-database-config";
import type { Mt5PublicationRequest } from "@/domain/mt5/publication";
import type { Mt5SymbolMappingRequest } from "@/domain/mt5/symbol-mapping";

// Fixed private calls only. No submitted SQL, roles, owner IDs or function names.
export async function mt5PublicationTransaction(context: VerifiedBrowserContext, request: Mt5PublicationRequest, proposal?: object): Promise<unknown> {
  return browserIntegrationTransaction(context,{kind:"PUBLICATION",request,proposal});
}
export async function mt5SymbolMappingTransaction(context:VerifiedBrowserContext,request:Mt5SymbolMappingRequest):Promise<unknown> {
  return browserIntegrationTransaction(context,{kind:"SYMBOL_MAPPING",request});
}
async function browserIntegrationTransaction(context:VerifiedBrowserContext,operation:
  | {kind:"PUBLICATION";request:Mt5PublicationRequest;proposal?:object}
  | {kind:"SYMBOL_MAPPING";request:Mt5SymbolMappingRequest}):Promise<unknown> {
  const {request}=operation;
  const claims = verifiedBrowserClaims(context);
  const database = new Client(publicationDatabaseConfig(process.env));
  try {
    await database.connect();
    await database.query("begin");
    await database.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
    const result = operation.kind==="SYMBOL_MAPPING"
      ? await database.query("select private.mt5_save_symbol_mapping($1::jsonb) as result",[JSON.stringify(request)])
      : operation.proposal
      ? await database.query("select private.mt5_publish_browser($1::jsonb,$2::jsonb) as result",[JSON.stringify(request),JSON.stringify(operation.proposal)])
      : await database.query("select private.mt5_browser_publication_result($1::jsonb) as result",[JSON.stringify(request)]);
    await database.query("commit");
    return result.rows[0]?.result;
  } catch (error) {
    await database.query("rollback").catch(() => {});
    // Expose stable domain errors only; a pg error can contain credentials or SQL detail.
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    throw new Error(["23505","40001","23514","22023"].includes(String(code))
      ? "MT5_PUBLICATION_REVIEW_REQUIRED" : "MT5_PUBLICATION_UNAVAILABLE");
  } finally { await database.end().catch(() => {}); }
}
