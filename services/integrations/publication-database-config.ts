import type { ClientConfig } from "pg";

/** No query-string TLS downgrade, implicit .env fallback, or remote test database. */
export function publicationDatabaseConfig(env: Record<string,string | undefined>): ClientConfig {
  const local = env.TRADE_OS_LOCAL_TEST_APP === "true";
  const value = local ? env.TRADE_OS_LOCAL_DATABASE_URL : env.SUPABASE_DIRECT_CONNECTION_URL;
  if (!value) throw new Error("MT5_PUBLICATION_DATABASE_UNAVAILABLE");
  try {
    const url = new URL(value);
    if (!["postgres:","postgresql:"].includes(url.protocol) || url.search || url.hash || !url.username || !url.password)
      throw new Error();
    const loopback = ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
    if (local ? (!loopback || url.pathname !== "/postgres" || url.port !== "54322") : loopback) throw new Error();
    return { connectionString: value,ssl: local ? false : { rejectUnauthorized: true },connectionTimeoutMillis: 5000,
      query_timeout: 20000,statement_timeout: 15000,application_name: "trade-os-mt5-publication" };
  } catch { throw new Error("MT5_PUBLICATION_DATABASE_UNAVAILABLE"); }
}
