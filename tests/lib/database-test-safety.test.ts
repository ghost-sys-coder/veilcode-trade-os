import { describe, expect, it } from "vitest";

import { assessTapMessages, databaseTestConnection } from "../../scripts/lib/database-test-safety.mjs";

describe("disposable database test safety", () => {
  it("uses plaintext only on loopback, never a production environment fallback", () => {
    expect(databaseTestConnection("postgresql://postgres:fixture@127.0.0.1:54322/postgres").ssl).toBe(false);
    expect(() => databaseTestConnection("postgresql://postgres:fixture@db.remote.example/postgres")).toThrow("IS_DISPOSABLE");
    expect(() => databaseTestConnection(undefined)).toThrow("details suppressed");
  });

  it("requires explicit remote disposal and retains certificate verification", () => {
    expect(databaseTestConnection("postgresql://postgres:fixture@db.test.example/postgres", true).ssl).toEqual({ rejectUnauthorized: true });
  });

  it.each(["sslmode=disable", "sslmode=no-verify", "ssl=true"])("rejects TLS overrides %s", (query) => {
    expect(() => databaseTestConnection(`postgresql://postgres:fixture@db.test.example/postgres?${query}`, true)).toThrow();
  });

  it.each(["host=db.remote.example", "hostaddr=203.0.113.1", "port=6543", "sslnegotiation=direct", "uselibpqcompat=true"])("rejects connection overrides %s even for loopback URLs", (query) => {
    expect(() => databaseTestConnection(`postgresql://postgres:fixture@127.0.0.1/postgres?${query}`)).toThrow("overrides");
  });

  it("rejects non-PostgreSQL URLs and doesn't print credentials", () => {
    expect(() => databaseTestConnection("https://user:SENSITIVE_FIXTURE_VALUE@test.example")).toThrow("PostgreSQL");
  });

  it("requires one complete, ordered non-empty assertion plan", () => {
    expect(assessTapMessages(["1..2", "ok 1 - fixture", "ok 2 - fixture"]).passed).toBe(true);
    for (const messages of [[], ["1..0"], ["1..2", "ok 1 - fixture"], ["1..1", "not ok 1 - fixture"], ["1..1", "ok 1 - fixture # SKIP pending"], ["1..1", "ok 1 - fixture", "Bail out!"], ["1..1", "1..1", "ok 1 - fixture"], ["1..2", "ok 2 - fixture", "ok 1 - fixture"]]) {
      expect(assessTapMessages(messages).passed).toBe(false);
    }
  });
});
