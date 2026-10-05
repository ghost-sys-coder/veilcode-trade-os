/** Test credentials never fall back to the application's production .env. */
export function databaseTestConnection(value, allowRemote = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid disposable test database URL; connection details suppressed.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) {
    throw new Error("A PostgreSQL disposable test database URL is required.");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!local && !allowRemote) {
    throw new Error("Remote tests require TRADE_OS_TEST_DATABASE_IS_DISPOSABLE=true. Production fallback is forbidden.");
  }
  // pg query parameters can override the URL hostname and supplied TLS object.
  // A loopback-looking URL must never redirect tests to a remote database.
  for (const field of url.searchParams.keys()) {
    if (field !== "application_name") {
      throw new Error("Database routing and TLS query overrides are forbidden in test URLs.");
    }
  }
  return { connectionString: url.href, ssl: local ? false : { rejectUnauthorized: true } };
}

/** Insert literal pending DDL inside a strictly rollback-isolated suite. */
export function injectPendingSchema(sql, schema) {
  if (!/^\s*begin\s*;/i.test(sql) || !/rollback\s*;\s*$/i.test(sql)) {
    throw new Error("Database suite must be rollback-isolated.");
  }
  // A callback is essential: replacement strings interpret PL/pgSQL's $$.
  return schema ? sql.replace(/^(\s*begin\s*;)/i, begin => `${begin}\n${schema}\n`) : sql;
}

/** pgTAP must declare and actually run the entire plan; no empty false passes. */
export function assessTapMessages(messages) {
  const plans = messages.filter((message) => /^1\.\.[0-9]+$/.test(message));
  const assertions = messages.filter((message) => /^(?:ok|not ok) [0-9]+\b/.test(message));
  const expected = plans.length === 1 ? Number(plans[0].slice(3)) : 0;
  const numbers = assertions.map((message) => Number(message.match(/^(?:ok|not ok) ([0-9]+)/)[1]));
  const failures = messages.some((message) => /^not ok\b|^Bail out!|Looks like you (?:failed|planned)|#\s*(?:SKIP|TODO)\b/i.test(message));
  return {
    expected,
    executed: assertions.length,
    passed: expected > 0 && assertions.length === expected && !failures
      && numbers.every((number, index) => number === index + 1),
  };
}
