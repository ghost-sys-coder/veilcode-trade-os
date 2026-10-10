import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { databaseTestConnection } from "./lib/database-test-safety.mjs";

try {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const status = JSON.parse(execFileSync("supabase",["status","--output","json"],{
    cwd: root,encoding: "utf8",stdio:["ignore","pipe","pipe"],timeout:15_000,
  }));
  databaseTestConnection(status.DB_URL);
  const api = new URL(status.API_URL);
  if (!["127.0.0.1","localhost","[::1]"].includes(api.hostname)) throw new Error("Local API required");
  const child = spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","3100"],{
    cwd:root,stdio:"inherit",env:{ ...process.env,
      SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      // Never let a hosted Storage secret from .env leak into disposable tests.
      SUPABASE_SECRET_KEY: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
      TRADE_OS_LOCAL_DATABASE_URL: status.DB_URL,
      TRADE_OS_INTEGRATION_ORIGIN:"http://127.0.0.1:3100", TRADE_OS_MT5_ENABLED:"true", TRADE_OS_MCP_ENABLED:"true", TRADE_OS_LOCAL_TEST_APP:"true",
    },
  });
  child.on("error",()=>{ console.error("Local integration app could not start."); process.exitCode=1; });
  child.on("exit",code=>{ process.exitCode=code ?? 1; });
  process.on("SIGINT",()=>child.kill("SIGINT"));
  process.on("SIGTERM",()=>child.kill("SIGTERM"));
} catch { console.error("Local integration app preparation failed; private configuration suppressed."); process.exitCode=1; }
