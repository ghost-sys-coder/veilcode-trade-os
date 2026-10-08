import "server-only";
import { Client } from "pg";
import {
  configurationGetSchema, configurationListSchema, configurationPageSchema, configurationRecordSchema,
  configurationResultSchema, parseConfigurationCommand,
} from "@/domain/configuration/commands";
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
  INVALID_REFERENCE:"Invalid values, archived record or unavailable parent/account reference.",
  ACCESS_DENIED:"Application access denied.",
  UNAVAILABLE:"Application workflow temporarily unavailable. Check operation status before retrying an uncertain write.",
} as const;
export class ApplicationWorkflowError extends Error {
  constructor(readonly code:keyof typeof messages) { super(messages[code]); this.name="ApplicationWorkflowError"; }
}

function claimsFor(context:ApplicationContext) {
  if ("actor" in context) {
    const claims=verifiedIntegrationClaims(context);
    if(context.actor.purpose!=="MCP")throw new IntegrationAuthorizationError();
    return claims;
  }
  return verifiedBrowserClaims(context);
}

/** Fixed private calls only; never accepts SQL, table names, roles or owner IDs. */
async function transaction(context:ApplicationContext, request:object, write:boolean) {
  // Authenticate provenance before configuration lookup or opening a DB socket.
  const claims=claimsFor(context);
  let database:Client | undefined;
  try {
    database=new Client({...publicationDatabaseConfig(process.env),application_name:"trade-os-application"});
    await database.connect();
    await database.query("begin");
    await database.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
    const response=await database.query(write
      ? "select private.configuration_write($1::jsonb) as result"
      : "select private.configuration_read($1::jsonb) as result",[JSON.stringify(request)]);
    await database.query("commit");
    return response.rows[0]?.result;
  } catch(error) {
    await database?.query("rollback").catch(()=>{});
    const state=typeof error==="object" && error!==null && "code" in error ? String(error.code) : "";
    const constraint=typeof error==="object" && error!==null && "constraint" in error ? String(error.constraint):"";
    const duplicateName=["strategies_owner_name_unique","setups_strategy_name_unique"].includes(constraint);
    throw new ApplicationWorkflowError(state==="40001"?"VERSION_CONFLICT":state==="23505"?(duplicateName?"DUPLICATE_NAME":"OPERATION_CONFLICT")
      :state==="P0002"?"NOT_FOUND":state==="42501"?"ACCESS_DENIED"
      :["22023","23514","23503","22P02","22003"].includes(state)?"INVALID_REFERENCE":"UNAVAILABLE");
  } finally {await database?.end().catch(()=>{});}
}

export async function listConfiguration(context:ApplicationContext,input:unknown) {
  return configurationPageSchema.parse(await transaction(context,configurationListSchema.parse(input),false));
}
export async function getConfiguration(context:ApplicationContext,input:unknown) {
  return configurationRecordSchema.parse(await transaction(context,configurationGetSchema.parse(input),false));
}
export async function writeConfiguration(context:ApplicationContext,action:"CREATE"|"PATCH"|"ARCHIVE",input:unknown) {
  return configurationResultSchema.parse(await transaction(context,parseConfigurationCommand(action,input),true));
}
