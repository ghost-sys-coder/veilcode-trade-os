import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { assessTapMessages, databaseTestConnection } from "./lib/database-test-safety.mjs";

let connectionString = process.env.TRADE_OS_TEST_DATABASE_URL;

if (!connectionString) {
  try {
    // Capture status privately: it contains local-only keys that must not be logged.
    const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000,
    }));
    const local = databaseTestConnection(status.DB_URL);
    connectionString = local.connectionString;
    console.log("Using the running disposable local Supabase database.");
  } catch {
    console.error("Start local Supabase or configure TRADE_OS_TEST_DATABASE_URL for a disposable database. Production .env is never used.");
    process.exit(1);
  }
}

const connection = databaseTestConnection(connectionString, process.env.TRADE_OS_TEST_DATABASE_IS_DISPOSABLE === "true");
const directory = new URL("../supabase/tests/", import.meta.url);
const suites = (await readdir(directory)).filter((file) => file.endsWith(".test.sql")).sort();
if (!suites.length) throw new Error("No database suites found.");
const client = new pg.Client({ ...connection, connectionTimeoutMillis: 15_000, statement_timeout: 60_000 });
let connectionLost = false;
client.on("error", () => {
  connectionLost = true;
  process.exitCode = 1;
  console.error("Disposable database connection was interrupted; details suppressed.");
});

try {
  await client.connect();
  // Share the OAuth/browser fixture lock: those checks temporarily configure the
  // same local resource rows. The session lock survives each suite's rollback
  // and is released on disconnect, including errors; never race these fixtures.
  await client.query("select pg_advisory_lock(670051234)");
  for (const suite of suites) {
    const sql = await readFile(new URL(suite, directory), "utf8");
    if (!/^\s*begin\s*;/i.test(sql) || !/rollback\s*;\s*$/i.test(sql)) {
      throw new Error(`Database suite must be rollback-isolated: ${suite}`);
    }
    console.log(`Suite: ${suite}`);
    try {
      const results = await client.query(sql);
      const statements = Array.isArray(results) ? results : [results];
      const messages = statements.flatMap((result) =>
        result.rows.flatMap((row) => Object.values(row).filter((value) => typeof value === "string")),
      );
      for (const message of messages) {
        if (/^(?:ok|not ok|1\.\.|#|Bail out!)/.test(message)) console.log(message);
      }
      const assessment = assessTapMessages(messages);
      console.log(`${assessment.passed ? "PASS" : "FAIL"}: ${assessment.executed}/${assessment.expected} assertions`);
      if (!assessment.passed) process.exitCode = 1;
    } catch (error) {
      console.error(`FAIL: ${suite}; SQLSTATE ${typeof error.code === "string" ? error.code : "unavailable"}. Details suppressed.`);
      process.exitCode = 1;
    } finally {
      if (!connectionLost) {
        try { await client.query("rollback"); }
        catch { connectionLost = true; process.exitCode = 1; }
      }
    }
    if (connectionLost) break;
  }
} catch {
  console.error("Disposable database tests could not complete; connection details suppressed.");
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch { process.exitCode = 1; }
}
