import { readFile } from "node:fs/promises";
import process from "node:process";

import pg from "pg";

const connectionString = process.env.TRADE_OS_TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TRADE_OS_TEST_DATABASE_URL is required.");
}

const sql = await readFile(
  new URL("../supabase/tests/phase_01_rls.test.sql", import.meta.url),
  "utf8",
);
const client = new pg.Client({
  connectionString,
  // The managed Supavisor pooler currently presents a chain Node does not
  // trust locally. TLS remains enabled; this exception is isolated to tests.
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const results = await client.query(sql);
  const statements = Array.isArray(results) ? results : [results];
  const messages = statements.flatMap((result) =>
    result.rows.flatMap((row) => Object.values(row).filter((value) => typeof value === "string")),
  );

  for (const message of messages) {
    if (/^(?:ok|not ok|1\.\.)/.test(message)) {
      console.log(message);
    }
  }

  if (messages.some((message) => message.startsWith("not ok") || message.includes("Looks like you failed"))) {
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
