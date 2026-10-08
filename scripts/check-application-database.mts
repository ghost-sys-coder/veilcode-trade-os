import nextEnv from "@next/env";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { APPLICATION_DATABASE_COLUMNS, APPLICATION_DATABASE_FUNCTIONS } from "../domain/application/database-contract.ts";
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
    env={TRADE_OS_LOCAL_TEST_APP:"true",TRADE_OS_LOCAL_DATABASE_URL:status.DB_URL};
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
  const functions=await database.query<{name:string;ready:boolean}>(
    "select name,to_regprocedure(name) is not null as ready from unnest($1::text[]) name",[APPLICATION_DATABASE_FUNCTIONS]);
  const columns=await database.query<{table:string;column:string;ready:boolean}>(
    `select x.table_name as "table",x.column_name as "column",exists(select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=x.table_name and c.column_name=x.column_name and c.data_type='bigint') as ready
      from jsonb_to_recordset($1::jsonb) x(table_name text,column_name text)`,
    [JSON.stringify(APPLICATION_DATABASE_COLUMNS.map(item=>({table_name:item.table,column_name:item.column})))]);
  const missing=[...functions.rows.filter(row=>!row.ready).map(row=>row.name),
    ...columns.rows.filter(row=>!row.ready).map(row=>`public.${row.table}.${row.column}`)];
  if(functions.rows.length!==APPLICATION_DATABASE_FUNCTIONS.length || columns.rows.length!==APPLICATION_DATABASE_COLUMNS.length)throw new Error("Incomplete prerequisite inventory");
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
