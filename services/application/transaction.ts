import "server-only";
import { Client } from "pg";
import { IntegrationAuthorizationError } from "@/domain/integrations/actor";
import { verifiedIntegrationClaims, type IntegrationContext } from "@/services/integrations/actor-context";
import { verifiedBrowserClaims, type VerifiedBrowserContext } from "@/services/integrations/browser-context";
import { publicationDatabaseConfig } from "@/services/integrations/publication-database-config";

export type ApplicationContext = IntegrationContext | VerifiedBrowserContext;
const messages = {
  VERSION_CONFLICT:"This record changed. Reload its current version before updating.",
  OPERATION_CONFLICT:"This operation ID was already used with another payload. Do not retry with changed values.",
  DUPLICATE_NAME:"A record with this name already exists in its scope.",
  NOT_FOUND:"Record not found or unavailable.",
  INVALID_REFERENCE:"Invalid values, protected record or unavailable reference. Baseline/date changes require a correction reason; mapped-account financial changes require integration reconciliation.",
  ACCESS_DENIED:"Application access denied.",
  MONEY_STORAGE_LIMIT:"The normalized value exceeds database storage precision. No value was silently truncated.",
  UNAVAILABLE:"Application workflow temporarily unavailable. Check operation status before retrying an uncertain write.",
} as const;
export class ApplicationWorkflowError extends Error {
  constructor(readonly code:keyof typeof messages) { super(messages[code]); this.name="ApplicationWorkflowError"; }
}

const statements={
  CONFIGURATION_READ:"select private.configuration_read($1::jsonb) as result",
  CONFIGURATION_WRITE:"select private.configuration_write($1::jsonb) as result",
  ACCOUNT_READ:"select private.application_account_read($1::jsonb) as result",
  ACCOUNT_WRITE:"select private.application_account_write($1::jsonb) as result",
} as const;

/** Fixed allowlist, verified runtime provenance, fresh database authorization. */
export async function applicationTransaction(context:ApplicationContext, workflow:keyof typeof statements, request:object) {
  const claims="actor" in context ? verifiedIntegrationClaims(context) : verifiedBrowserClaims(context);
  if("actor" in context && context.actor.purpose!=="MCP")throw new IntegrationAuthorizationError();
  if(!Object.hasOwn(statements,workflow))throw new IntegrationAuthorizationError();
  let database:Client|undefined;
  try {
    database=new Client({...publicationDatabaseConfig(process.env),application_name:"trade-os-application"});
    await database.connect();await database.query("begin");
    await database.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
    const response=await database.query(statements[workflow],[JSON.stringify(request)]);
    await database.query("commit");return response.rows[0]?.result;
  } catch(error) {
    await database?.query("rollback").catch(()=>{});
    const state=typeof error==="object" && error!==null && "code" in error ? String(error.code):"";
    const constraint=typeof error==="object" && error!==null && "constraint" in error ? String(error.constraint):"";
    const duplicateName=["strategies_owner_name_unique","setups_strategy_name_unique","trading_accounts_owner_name_unique"].includes(constraint);
    throw new ApplicationWorkflowError(state==="40001"?"VERSION_CONFLICT":state==="23505"?(duplicateName?"DUPLICATE_NAME":"OPERATION_CONFLICT")
      :state==="P0002"?"NOT_FOUND":state==="42501"?"ACCESS_DENIED"
      :state==="22003"?"MONEY_STORAGE_LIMIT"
      :["22023","23514","23503","22P02","22007","22008"].includes(state)?"INVALID_REFERENCE":"UNAVAILABLE");
  } finally {await database?.end().catch(()=>{});}
}
