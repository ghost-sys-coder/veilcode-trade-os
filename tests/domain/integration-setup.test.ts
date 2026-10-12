import { describe, expect, it } from "vitest";
import { setupRequestSchema, setupProfileSchema, setupProgress, mcpSetupConfiguration } from "@/domain/integrations/setup";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const profile = { id, purpose: "MCP" as const, clientKind: "CODEX" as const, accountId: null,
  clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", resource: "https://app.example/mcp",
  callbackUri: "http://127.0.0.1:9878/callback", status: "READY" as const, version: "2",
  createdAt: "2026-10-12T15:00:00Z", updatedAt: "2026-10-12T15:00:01Z" };
describe("app-led integration setup contracts", () => {
  it("requires account-bound MT5 and account-free MCP", () => {
    expect(setupRequestSchema.safeParse({ operationId: id, clientKind: "CODEX", accountId: id }).success).toBe(false);
    expect(setupRequestSchema.safeParse({ operationId: id, clientKind: "MT5_WINDOWS", accountId: null }).success).toBe(false);
    expect(setupRequestSchema.parse({ operationId: id, clientKind: "MT5_WINDOWS", accountId: id }).accountId).toBe(id);
  });
  it.each(["ownerId", "clientId", "resource", "callbackUri", "secret", "password"])("rejects submitted %s authority", field => {
    expect(setupRequestSchema.safeParse({ operationId: id, clientKind: "CODEX", accountId: null, [field]: id }).success).toBe(false);
  });
  it.each(["https://evil.example/callback", "http://localhost:9878/callback", "http://127.0.0.1:9878/callback?code=x", "http://127.0.0.1:9880/callback"])("rejects callback %s", callbackUri => {
    expect(setupProfileSchema.safeParse({ ...profile, callbackUri }).success).toBe(false);
  });
  it.each(["https://app.example/mcp?token=x", "https://user:password@app.example/mcp", "https://app.example/wrong", "http://app.example/mcp"])("rejects resource %s", resource => {
    expect(setupProfileSchema.safeParse({ ...profile, resource }).success).toBe(false);
  });
  it("rejects impossible ready/identity combinations and extra secrets", () => {
    expect(setupProfileSchema.safeParse({ ...profile, clientId: null }).success).toBe(false);
    expect(setupProfileSchema.safeParse({ ...profile, purpose: "MT5" }).success).toBe(false);
    expect(setupProfileSchema.safeParse({ ...profile, accessToken: "secret" }).success).toBe(false);
  });
  it("emits the existing native adapter public configuration", () => {
    const config = mcpSetupConfiguration(setupProfileSchema.parse(profile), "https://fixture.supabase.co/auth/v1");
    expect(Object.keys(config).sort()).toEqual(["allowLoopback", "clientId", "issuer", "profile", "redirectUri", "resource", "version"].sort());
    expect(config.profile).toBe(`tradeos-${id}`);
    expect(config.allowLoopback).toBe(false);
  });
  it("cannot download an unregistered profile", () => {
    expect(() => mcpSetupConfiguration({ ...profile, status: "REGISTERING", clientId: null }, "https://fixture.supabase.co/auth/v1")).toThrow();
  });
  it("never treats a grant as verified client activity", () => {
    expect(setupProgress(profile).step).toBe("INSTALLATION");
    expect(setupProgress(profile, { status: "ACTIVE", revoked_at: null }).step).toBe("VERIFICATION");
    expect(setupProgress(profile, { status: "REVOKED", revoked_at: "2026-10-12T15:00:05Z" }).step).toBe("CONSENT");
    expect(setupProgress({ ...profile, status: "REGISTERING", clientId: null }).step).toBe("REGISTRATION");
  });
});
