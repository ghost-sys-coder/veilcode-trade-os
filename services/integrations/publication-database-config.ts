import { X509Certificate } from "node:crypto";
import type { ClientConfig } from "pg";

function certificateAuthority(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > 16384) throw new Error();
  if (!value.trim()) return undefined;
  const pem = value.replace(/\\n/g,"\n").trim();
  if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----$/.test(pem)) throw new Error();
  const certificate = new X509Certificate(pem);
  const now = Date.now();
  const validFrom = Date.parse(certificate.validFrom), validTo = Date.parse(certificate.validTo);
  if (!certificate.ca || !certificate.checkIssued(certificate) || !certificate.verify(certificate.publicKey)
    || !Number.isFinite(validFrom) || !Number.isFinite(validTo) || validFrom > now || validTo <= now) throw new Error();
  return certificate.toString();
}

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
    // Keep the existing secret URL intact in configuration stores. Only the
    // explicitly configured official pooler endpoint is substituted in memory.
    const poolerHost = env.SUPABASE_DATABASE_POOLER_HOST?.trim();
    const poolerPort = env.SUPABASE_DATABASE_POOLER_PORT?.trim();
    if (!local && (poolerHost || poolerPort)) {
      if (!poolerHost || poolerPort !== "5432" || !/^aws-\d+-[a-z]+-[a-z]+-\d+\.pooler\.supabase\.com$/.test(poolerHost)) throw new Error();
      const directProject = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
      const pooledProject = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(url.username));
      const project = directProject && url.username === "postgres" ? directProject[1]
        : url.hostname.endsWith(".pooler.supabase.com") && pooledProject ? pooledProject[1] : null;
      if (!project) throw new Error();
      url.hostname = poolerHost; url.port = poolerPort; url.username = `postgres.${project}`;
    }
    // The operator supplies the provider's downloaded public root CA. Trust is
    // confined to this server connection; node-postgres retains hostname checks.
    const ca = local ? undefined : certificateAuthority(env.SUPABASE_DATABASE_CA_CERT);
    return { connectionString: !local && poolerHost ? url.href : value,ssl: local ? false : { rejectUnauthorized: true,...(ca ? {ca} : {}) },connectionTimeoutMillis: 5000,
      query_timeout: 20000,statement_timeout: 15000,application_name: "trade-os-mt5-publication" };
  } catch { throw new Error("MT5_PUBLICATION_DATABASE_UNAVAILABLE"); }
}
