import nextEnv from "@next/env";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { APPLICATION_DATABASE_COLUMNS, applicationDatabaseFunctions } from "../domain/application/database-contract.ts";
import { publicationDatabaseConfig } from "../services/integrations/publication-database-config.ts";
import { databaseTestConnection } from "./lib/database-test-safety.mjs";

// Explicit read-only release gate. Never applies migrations or uses user records.
let database:pg.Client|undefined;
let stage="configuration";
try {
  let env:Record<string,string|undefined>;
  if(process.argv.includes("--local")) {
    const status=JSON.parse(execFileSync("supabase",["status","--output","json"],{
      cwd:fileURLToPath(new URL("..",import.meta.url)),encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:15000,
    })) as {DB_URL:string};
    databaseTestConnection(status.DB_URL);
    env={TRADE_OS_LOCAL_TEST_APP:"true",TRADE_OS_LOCAL_DATABASE_URL:status.DB_URL,
      TRADE_OS_INTEGRATION_SETUP_ENABLED:process.env.TRADE_OS_INTEGRATION_SETUP_ENABLED,
      TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED:process.env.TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED};
  } else {
    nextEnv.loadEnvConfig(fileURLToPath(new URL("..",import.meta.url)));
    env=process.env;
  }
  database=new pg.Client({...publicationDatabaseConfig(env),connectionTimeoutMillis:15000});
  database.on("error",()=>{process.exitCode=1;console.error("Application database preflight connection interrupted; details suppressed.");});
  stage="connection";
  await database.connect();
  stage="schema catalog";
  await database.query("begin read only");
  const requiredFunctions=applicationDatabaseFunctions(env);
  const functions=await database.query<{name:string;ready:boolean}>(
    "select name,to_regprocedure(name) is not null as ready from unnest($1::text[]) name",[requiredFunctions]);
  const columns=await database.query<{table:string;column:string;ready:boolean}>(
    `select x.table_name as "table",x.column_name as "column",exists(select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=x.table_name and c.column_name=x.column_name and c.data_type='bigint') as ready
      from jsonb_to_recordset($1::jsonb) x(table_name text,column_name text)`,
    [JSON.stringify(APPLICATION_DATABASE_COLUMNS.map(item=>({table_name:item.table,column_name:item.column})))]);
  const missing=[...functions.rows.filter(row=>!row.ready).map(row=>row.name),
    ...columns.rows.filter(row=>!row.ready).map(row=>`public.${row.table}.${row.column}`)];
  if(env.TRADE_OS_INTEGRATION_SETUP_ENABLED==="true") {
    const guards=await database.query<{name:string;ready:boolean}>(`select name,exists(select 1 from pg_catalog.pg_trigger
      where not tgisinternal and tgenabled='O' and tgname=name and tgrelid=to_regclass(relation)) as ready
      from (values ('integration_setup_grant_binding','private.integration_grants'),
        ('integration_setup_events_immutable','private.integration_setup_events')) required(name,relation)`);
    if(guards.rows.length!==2)throw new Error("Incomplete setup guard inventory");
    missing.push(...guards.rows.filter(row=>!row.ready).map(row=>row.name));
    if(env.TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED==="true") {
      const desktop=await database.query<{name:string;ready:boolean}>(`select 'private.integration_setup_policies.claude_desktop_enabled' as name,
        exists(select 1 from information_schema.columns where table_schema='private' and table_name='integration_setup_policies'
          and column_name='claude_desktop_enabled' and data_type='boolean' and is_nullable='NO') as ready
        union all select name,exists(select 1 from pg_catalog.pg_constraint where conname=name and convalidated
          and conrelid='private.integration_setup_profiles'::regclass)
        from unnest(array['integration_setup_client_kind','integration_setup_callback_binding']) name`);
      if(desktop.rows.length!==3)throw new Error("Incomplete Desktop prerequisite inventory");
      missing.push(...desktop.rows.filter(row=>!row.ready).map(row=>row.name));
    }
  }
  if(functions.rows.length!==requiredFunctions.length || columns.rows.length!==APPLICATION_DATABASE_COLUMNS.length)throw new Error("Incomplete prerequisite inventory");
  await database.query("commit");
  if(missing.length) {
    console.error(`Application database prerequisites missing: ${missing.join(", ")}. Apply the reviewed migrations before deploying browser adapters.`);
    process.exitCode=1;
  } else console.log(`Application database preflight PASS: ${functions.rows.length} functions and ${columns.rows.length} version/order columns.`);
} catch(error) {
  const code=typeof error==="object" && error!==null && "code" in error && typeof error.code==="string" && /^[A-Z0-9_]{2,40}$/.test(error.code)?error.code:"unavailable";
  console.error(`Application database preflight failed during ${stage} (${code}). Check server-only connection/TLS settings and database availability; private details suppressed.`);
  process.exitCode=1;
} finally {await database?.end().catch(()=>{});}
