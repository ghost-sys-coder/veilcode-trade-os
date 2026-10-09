import "server-only";
import { Client } from "pg";
import { ZodError } from "zod";
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
  NUMERIC_STORAGE_LIMIT:"The value exceeds storage precision for its numeric domain. Prices, volumes and money have separate limits; nothing was silently truncated.",
  UNAVAILABLE:"Application workflow temporarily unavailable. Check operation status before retrying an uncertain write.",
  READ_UNAVAILABLE:"Unable to load application data right now. Reload to retry; no write was attempted.",
  SCHEMA_NOT_READY:"The application database needs its shared-workflow migrations. Ask the operator to apply the deployment prerequisites, then reload. No operation was committed.",
  DATABASE_NOT_CONFIGURED:"The application database connection is not configured correctly. Ask the operator to check the server-only database and TLS settings.",
} as const;
export class ApplicationWorkflowError extends Error {
  constructor(readonly code:keyof typeof messages) { super(messages[code]); this.name="ApplicationWorkflowError"; }
}

const statements={
  FILE_READ:"select private.application_file_read($1::jsonb) as result",
  FILE_PREPARE:"select private.application_file_prepare($1::jsonb) as result",
  FILE_WRITE:"select private.application_file_write($1::jsonb,$2::jsonb) as result",
  MT5_GRANTS_READ:"select private.application_mt5_grants($1::jsonb) as result",
  MT5_WORKFLOW_WRITE:"select private.application_mt5_workflow_write($1::jsonb,$2::jsonb) as result",
  INTEGRATION_READ:"select private.application_integration_read($1::jsonb) as result",
  MT5_REVIEW_WRITE:"select private.application_mt5_review_write($1::jsonb,$2::jsonb) as result",
  PROFILE_READ:"select private.application_profile_read($1::jsonb) as result",
  PROFILE_WRITE:"select private.application_profile_write($1::jsonb) as result",
  REPORTING_DATA:"select private.application_reporting_data($1::jsonb) as result",
  REFERENCE_READ:"select private.application_reference_read($1::jsonb) as result",
  REFERENCE_WRITE:"select private.application_reference_write($1::jsonb) as result",
  TRADE_TAG_WRITE:"select private.application_trade_tag_write($1::jsonb) as result",
  PROGRESS_READ:"select private.application_progress_read($1::jsonb) as result",
  PROGRESS_DATA:"select private.application_progress_data($1::jsonb) as result",
  PROGRESS_WRITE:"select private.application_progress_write($1::jsonb,$2::jsonb) as result",
  JOURNAL_READ:"select private.application_journal_read($1::jsonb) as result",
  JOURNAL_WRITE:"select private.application_journal_write($1::jsonb) as result",
  CONFIGURATION_READ:"select private.configuration_read($1::jsonb) as result",
  CONFIGURATION_WRITE:"select private.configuration_write($1::jsonb) as result",
  ACCOUNT_READ:"select private.application_account_read($1::jsonb) as result",
  ACCOUNT_LEDGER:"select private.application_account_ledger($1::jsonb) as result",
  ACCOUNT_WRITE:"select private.application_account_write($1::jsonb) as result",
  ACCOUNT_EVENT_READ:"select private.application_account_event_read($1::jsonb) as result",
  ACCOUNT_EVENT_WRITE:"select private.application_account_event_write($1::jsonb,$2::jsonb) as result",
  TRADE_READ:"select private.application_trade_read($1::jsonb) as result",
  TRADE_WRITE:"select private.application_trade_write($1::jsonb,$2::jsonb) as result",
  TRADE_REFERENCES:"select private.application_trade_references($1::jsonb) as result",
} as const;
const preparedStatements={FILE_WRITE:"select private.application_file_prepare($1::jsonb) as result",
  MT5_WORKFLOW_WRITE:"select private.application_mt5_workflow_prepare($1::jsonb) as result",
  MT5_REVIEW_WRITE:"select private.application_mt5_review_prepare($1::jsonb) as result",
  PROGRESS_WRITE:"select private.application_progress_prepare($1::jsonb) as result",
  ACCOUNT_EVENT_WRITE:"select private.application_account_event_prepare($1::jsonb) as result",
  TRADE_WRITE:"select private.application_trade_prepare($1::jsonb) as result"} as const;

/** Fixed allowlist, verified runtime provenance, fresh database authorization. */
export async function applicationTransaction(context:ApplicationContext, workflow:keyof typeof statements, request:object, prepare?:(snapshot:unknown)=>object) {
  const claims="actor" in context ? verifiedIntegrationClaims(context) : verifiedBrowserClaims(context);
  if("actor" in context && context.actor.purpose!=="MCP")throw new IntegrationAuthorizationError();
  if(!Object.hasOwn(statements,workflow))throw new IntegrationAuthorizationError();
  let database:Client|undefined;
  try {
    database=new Client({...publicationDatabaseConfig(process.env),application_name:"trade-os-application"});
    // Authorization takes a shared grant lock so revocation is serialized with
    // each request. PostgreSQL forbids FOR SHARE in a READ ONLY transaction.
    // Reads still execute only fixed SELECT workflows, with a consistent snapshot.
    await database.connect();await database.query(workflow.endsWith("WRITE")?"begin":"begin isolation level repeatable read");
    await database.query("set local time zone 'UTC'");
    await database.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
    let proposal:object|undefined;
    if(workflow in preparedStatements) {
      if(!prepare)throw new ApplicationWorkflowError("UNAVAILABLE");
      const source=await database.query(preparedStatements[workflow as keyof typeof preparedStatements],[JSON.stringify(request)]);
      const snapshot=source.rows[0]?.result;
      if(snapshot?.receipt) {await database.query("commit");return snapshot.receipt;}
      proposal=prepare(snapshot);
    }
    const response=await database.query(statements[workflow],proposal?[JSON.stringify(request),JSON.stringify(proposal)]:[JSON.stringify(request)]);
    await database.query("commit");return response.rows[0]?.result;
  } catch(error) {
    await database?.query("rollback").catch(()=>{});
    if(error instanceof ApplicationWorkflowError)throw error;
    if(error instanceof RangeError || error instanceof ZodError)throw new ApplicationWorkflowError("INVALID_REFERENCE");
    const state=typeof error==="object" && error!==null && "code" in error ? String(error.code):"";
    const constraint=typeof error==="object" && error!==null && "constraint" in error ? String(error.constraint):"";
    const duplicateName=["strategies_owner_name_unique","setups_strategy_name_unique","trading_accounts_owner_name_unique",
      "tags_owner_normalized_name_unique","instruments_user_symbol_unique"].includes(constraint);
    const unavailable=workflow.endsWith("WRITE")?"UNAVAILABLE":"READ_UNAVAILABLE";
    const configurationFailure=error instanceof Error && error.message==="MT5_PUBLICATION_DATABASE_UNAVAILABLE";
    throw new ApplicationWorkflowError(configurationFailure?"DATABASE_NOT_CONFIGURED"
      :["42883","42P01","42703"].includes(state)?"SCHEMA_NOT_READY"
      :state==="40001"?"VERSION_CONFLICT":state==="23505"?(duplicateName?"DUPLICATE_NAME":"OPERATION_CONFLICT")
      :state==="P0002"?"NOT_FOUND":state==="42501"?"ACCESS_DENIED"
      :state==="22003"?(workflow.startsWith("TRADE")||workflow.startsWith("PROGRESS")?"NUMERIC_STORAGE_LIMIT":"MONEY_STORAGE_LIMIT")
      :["22023","23514","23503","23502","22P02","22007","22008"].includes(state)?"INVALID_REFERENCE":unavailable);
  } finally {await database?.end().catch(()=>{});}
}
