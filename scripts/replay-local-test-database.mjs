import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseTestConnection } from "./lib/database-test-safety.mjs";

const options = { cwd: fileURLToPath(new URL("..",import.meta.url)),encoding: "utf8",stdio: ["ignore","pipe","pipe"],timeout: 180_000 };
let connection;
let stage="local discovery";
try {
  const status = JSON.parse(execFileSync("supabase",["status","--output","json"],options));
  connection = new pg.Client(databaseTestConnection(status.DB_URL));
  connection.on("error",() => { process.exitCode = 1; });
  await connection.connect();
  stage="empty-database guard";
  // Refuse to reset even one user's local workspace. Never read production .env.
  // An interrupted empty reset may not have recreated every table yet. Missing
  // tables contain no rows, but every existing evidence table must still be empty.
  // This fixed inventory is internal, never caller-controlled SQL identifiers.
  await connection.query("begin read only");
  for(const table of ["auth.users","public.trades","public.trading_accounts","private.integration_grants","private.mt5_connections",
    "private.integration_operations","private.integration_mutation_audits","private.mt5_source_revisions",
    "private.application_operations","private.application_mutation_audits"]) {
    const exists=await connection.query("select to_regclass($1) is not null as exists",[table]);
    if(exists.rows[0].exists && (await connection.query(`select count(*)::text as count from ${table}`)).rows[0].count!=="0")throw new Error("Local fixture database is not empty");
  }
  await connection.query("commit");
  await connection.end(); connection = undefined;
  console.log("Verified empty local users, trades and integration grants before replay.");
  stage="local migration replay";
  execFileSync("supabase",["db","reset","--local"],{...options,timeout:300_000});
  console.log("All local migrations replayed; hosted Supabase untouched. CLI credentials suppressed.");
} catch(error) {
  const code=typeof error?.code==="string" && /^[A-Z0-9_]{2,40}$/.test(error.code)?error.code:"unavailable";
  console.error(`Local empty-database replay refused or failed during ${stage} (${code}); private details suppressed. Never substitute hosted credentials.`);
  if(stage==="local migration replay") {
    const output=String(error?.stderr??"")+String(error?.stdout??"");
    const migrations=[...output.matchAll(/Applying migration (\d{14}_[a-z0-9_]+\.sql)/g)];
    const state=output.match(/SQLSTATE ([A-Z0-9]{5})/)?.[1];
    console.error(`Last migration: ${migrations.at(-1)?.[1]??"unavailable"}; SQLSTATE: ${state??"unavailable"}.`);
  }
  process.exitCode = 1;
} finally { try { await connection?.end(); } catch { process.exitCode = 1; } }
