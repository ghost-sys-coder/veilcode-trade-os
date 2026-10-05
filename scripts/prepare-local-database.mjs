import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { databaseTestConnection } from "./lib/database-test-safety.mjs";

try {
  const options = { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 };
  const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], options));
  databaseTestConnection(status.DB_URL); // No remote opt-in or production environment fallback.
  const connection = new URL(status.DB_URL);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(connection.password) };
  const sql = (query) => execFileSync("docker", ["exec", "-e", "PGPASSWORD", "supabase_db_trade-os", "psql",
    "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", query], { ...options, env });
  // Supautils' enhanced permission hints can SIGSEGV instead of returning 42501.
  // Disable diagnostics only, never permissions, RLS, roles or authentication.
  sql("alter system set supautils.hint_roles = '';");
  sql("select pg_reload_conf();");
  if (sql("select current_setting('supautils.hint_roles');").trim() !== "") throw new Error("Local diagnostic setting was not applied.");
  console.log("Local database permission-hint workaround verified. EXECUTE permissions and RLS are unchanged.");
} catch {
  console.error("Local database preparation failed; private connection details suppressed.");
  process.exitCode = 1;
}
