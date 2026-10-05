import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseTestConnection } from "./lib/database-test-safety.mjs";

const options = { cwd: fileURLToPath(new URL("..",import.meta.url)),encoding: "utf8",stdio: ["ignore","pipe","pipe"],timeout: 180_000 };
let connection;
try {
  const status = JSON.parse(execFileSync("supabase",["status","--output","json"],options));
  connection = new pg.Client(databaseTestConnection(status.DB_URL));
  connection.on("error",() => { process.exitCode = 1; });
  await connection.connect();
  // Refuse to reset even one user's local workspace. Never read production .env.
  const result = await connection.query("select (select count(*) from auth.users) as users,(select count(*) from public.trades) as trades,(select count(*) from private.integration_grants) as grants,(select count(*) from private.mt5_connections) as connections,(select count(*) from private.integration_operations) as operations,(select count(*) from private.integration_mutation_audits) as audits,(select count(*) from private.mt5_source_revisions) as revisions");
  if (Object.values(result.rows[0]).some(count => count !== "0")) throw new Error("Local fixture database is not empty");
  await connection.end(); connection = undefined;
  console.log("Verified empty local users, trades and integration grants before replay.");
  execFileSync("supabase",["db","reset","--local"],options);
  console.log("All local migrations replayed; hosted Supabase untouched. CLI credentials suppressed.");
} catch {
  console.error("Local empty-database replay refused or failed; details suppressed. Never substitute hosted credentials.");
  process.exitCode = 1;
} finally { try { await connection?.end(); } catch { process.exitCode = 1; } }
