import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicationDatabaseConfig } from "@/services/integrations/publication-database-config";

// Public runtime trust anchors are fixture material, not user or broker secrets.
const fixtureRoot = rootCertificates.map(pem => new X509Certificate(pem)).find(certificate =>
  certificate.ca && certificate.checkIssued(certificate) && certificate.verify(certificate.publicKey)
  && Date.parse(certificate.validFrom) < Date.now() && Date.parse(certificate.validTo) > Date.now());
if (!fixtureRoot) throw new Error("A currently valid public fixture root is required");
const pem = fixtureRoot.toString();
const remote = { SUPABASE_DIRECT_CONNECTION_URL: "postgresql://postgres:fixture@database.example.com:5432/postgres" };
const failure = "MT5_PUBLICATION_DATABASE_UNAVAILABLE";
const pooler = { SUPABASE_DATABASE_POOLER_HOST: "aws-1-eu-central-1.pooler.supabase.com", SUPABASE_DATABASE_POOLER_PORT: "5432" };
const project = "abcdefghijklmnopqrst";
const supabase = { SUPABASE_DIRECT_CONNECTION_URL: `postgresql://postgres:fixture%23password@db.${project}.supabase.co:5432/postgres` };

afterEach(() => vi.useRealTimers());

describe("server publication connection configuration", () => {
  it("uses the explicit official pooler while preserving the stored secret and project identity", () => {
    const input = { ...supabase, ...pooler, SUPABASE_DATABASE_CA_CERT: pem };
    const configuration = publicationDatabaseConfig(input);
    const target = new URL(configuration.connectionString!);
    expect(target.hostname).toBe(pooler.SUPABASE_DATABASE_POOLER_HOST);
    expect(target.username).toBe(`postgres.${project}`);
    expect(target.password).toBe("fixture%23password");
    expect(target.port).toBe("5432");
    expect(target.pathname).toBe("/postgres");
    expect(input.SUPABASE_DIRECT_CONNECTION_URL).toBe(supabase.SUPABASE_DIRECT_CONNECTION_URL);
    expect(configuration.ssl).toEqual({ rejectUnauthorized: true, ca: pem });
  });

  it("retains the project suffix of an already-pooled secret URL", () => {
    const configuration = publicationDatabaseConfig({ ...pooler,
      SUPABASE_DIRECT_CONNECTION_URL: `postgresql://postgres.${project}:fixture@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
    });
    expect(new URL(configuration.connectionString!).username).toBe(`postgres.${project}`);
  });

  it.each([
    { SUPABASE_DATABASE_POOLER_HOST: pooler.SUPABASE_DATABASE_POOLER_HOST },
    { SUPABASE_DATABASE_POOLER_PORT: "5432" },
    { ...pooler, SUPABASE_DATABASE_POOLER_HOST: "attacker.example.com" },
    { ...pooler, SUPABASE_DATABASE_POOLER_HOST: "user@" + pooler.SUPABASE_DATABASE_POOLER_HOST },
    { ...pooler, SUPABASE_DATABASE_POOLER_PORT: "6543" },
    { ...pooler, SUPABASE_DATABASE_POOLER_PORT: "0" },
    { ...pooler, SUPABASE_DATABASE_POOLER_HOST: "   " },
  ])("rejects partial, foreign and non-session pooler configuration", override => {
    expect(() => publicationDatabaseConfig({ ...supabase, ...override })).toThrow(failure);
  });

  it("does not redirect generic or differently scoped credentials to a pooler", () => {
    expect(() => publicationDatabaseConfig({ ...remote, ...pooler })).toThrow(failure);
    expect(() => publicationDatabaseConfig({ ...pooler,
      SUPABASE_DIRECT_CONNECTION_URL: `postgresql://other:fixture@db.${project}.supabase.co:5432/postgres`,
    })).toThrow(failure);
  });

  it("keeps verified TLS and hostname verification when no custom CA is configured", () => {
    const configuration = publicationDatabaseConfig(remote);
    expect(configuration.ssl).toEqual({ rejectUnauthorized: true });
    expect(configuration).toMatchObject({ connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 20000 });
  });

  it.each([pem, pem.replace(/\n/g,"\r\n"), pem.replace(/\n/g,"\\n")])(
    "accepts a valid explicit public root without disabling hostname checks", value => {
      const ssl = publicationDatabaseConfig({ ...remote, SUPABASE_DATABASE_CA_CERT: value }).ssl;
      expect(ssl).toEqual({ rejectUnauthorized: true, ca: pem });
      expect(ssl).not.toHaveProperty("checkServerIdentity");
    },
  );

  it.each([undefined, "", "   "])("does not turn an absent root into an insecure fallback", value => {
    expect(publicationDatabaseConfig({ ...remote, SUPABASE_DATABASE_CA_CERT: value }).ssl).toEqual({ rejectUnauthorized: true });
  });

  it.each(["not a certificate", "<html>download failed</html>", "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----",
    "-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----", pem + pem, "a".repeat(16385), " ".repeat(16385)])(
    "rejects malformed, private-key, bundled and oversized CA input without leaking it", value => {
      expect(() => publicationDatabaseConfig({ ...remote, SUPABASE_DATABASE_CA_CERT: value })).toThrow(failure);
    },
  );

  it("rejects a tampered self-signature", () => {
    const der = Buffer.from(fixtureRoot.raw);
    der[der.length - 1] ^= 1;
    const tampered = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----`;
    expect(() => publicationDatabaseConfig({ ...remote, SUPABASE_DATABASE_CA_CERT: tampered })).toThrow(failure);
  });

  it.each(["not yet valid", "expired"])("rejects a %s root", state => {
    vi.useFakeTimers();
    vi.setSystemTime(state === "expired" ? Date.parse(fixtureRoot.validTo) + 1 : Date.parse(fixtureRoot.validFrom) - 1);
    expect(() => publicationDatabaseConfig({ ...remote, SUPABASE_DATABASE_CA_CERT: pem })).toThrow(failure);
  });

  it.each(["?sslmode=disable", "?sslmode=require", "?sslrootcert=untrusted", "?options=-c%20role%3Dpostgres", "#fragment"])(
    "rejects URL settings which could override the strict driver configuration", suffix => {
      expect(() => publicationDatabaseConfig({ ...remote,
        SUPABASE_DIRECT_CONNECTION_URL: remote.SUPABASE_DIRECT_CONNECTION_URL + suffix,
        SUPABASE_DATABASE_CA_CERT: pem,
      })).toThrow(failure);
    },
  );

  it("keeps disposable local verification restricted and independent of remote CA configuration", () => {
    expect(publicationDatabaseConfig({ TRADE_OS_LOCAL_TEST_APP: "true",
      TRADE_OS_LOCAL_DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:54322/postgres",
      SUPABASE_DATABASE_CA_CERT: "invalid remote input",
    }).ssl).toBe(false);
    expect(() => publicationDatabaseConfig({ TRADE_OS_LOCAL_TEST_APP: "true",
      TRADE_OS_LOCAL_DATABASE_URL: remote.SUPABASE_DIRECT_CONNECTION_URL,
    })).toThrow(failure);
    expect(() => publicationDatabaseConfig({ SUPABASE_DIRECT_CONNECTION_URL:
      "postgresql://postgres:fixture@127.0.0.1:54322/postgres" })).toThrow(failure);
  });

  it("fails closed for missing configuration", () => {
    expect(() => publicationDatabaseConfig({})).toThrow(failure);
  });
});
