import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationAuthorizationError, IntegrationUnavailableError } from "@/domain/integrations/actor";
import { captureInputSchema, IntegrationWorkflowError, integrationDatabaseError } from "@/domain/mt5/protocol";
import { integrationErrorResponse, readIntegrationJson } from "@/lib/integrations/http";

afterEach(() => vi.unstubAllEnvs());
describe("bounded integration HTTP boundary", () => {
  const request = (body: string, contentType = "application/json") => new Request("https://trade.example/api/integrations/v1/mt5/capture",{ method: "POST",headers: { "Content-Type": contentType },body });
  it("accepts validated JSON media types",async () => { expect(await readIntegrationJson(request('{"amount":"0.1"}',"application/json; charset=utf-8"))).toEqual({ amount: "0.1" }); });
  it.each([["not-json","application/json"],["{}","text/plain"],["x".repeat(1_048_577),"application/json"]])("rejects malformed/oversize input without exposing its content",async (body,type) => {
    await expect(readIntegrationJson(request(body,type))).rejects.toThrow("INVALID_INTEGRATION_INPUT");
  });
  it("counts UTF-8 bytes rather than characters",async () => {
    await expect(readIntegrationJson(request(JSON.stringify("😀".repeat(270_000))))).rejects.toThrow("INVALID_INTEGRATION_INPUT");
  });
  it("publishes resource-bound bearer challenges without accepting caller Host values",async () => {
    vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN","https://trade.example");
    const response = integrationErrorResponse(new IntegrationAuthorizationError());
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("https://trade.example/.well-known/oauth-protected-resource/api/integrations/v1");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("distinguishes transient verification outages from authentication failures",async () => {
    const response = integrationErrorResponse(new IntegrationUnavailableError());
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("15");
    expect(await response.json()).toEqual({ error: "INTEGRATION_UNAVAILABLE" });
  });
  it.each([["23505",409,"OPERATION_CONFLICT"],["55P03",409,"COLLECTOR_LEASE_HELD"],["55000",409,"COLLECTOR_REQUIRES_ATTENTION"],
    ["22023",400,"INVALID_INTEGRATION_INPUT"],["42501",403,"INTEGRATION_ACCESS_DENIED"],["UNKNOWN",503,"INTEGRATION_UNAVAILABLE"]] as const)
  ("maps database code %s to an explicit recovery category",async (code,status,error) => {
    const response = integrationErrorResponse(integrationDatabaseError(code));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
  it("never emits raw exception messages",async () => {
    const response = integrationErrorResponse(new Error("PRIVATE_TEST_VALUE"));
    expect(await response.text()).not.toContain("PRIVATE_TEST_VALUE");
  });
  it("does not allow arbitrary owner IDs or JSON numbers at the source boundary", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(() => captureInputSchema.parse({ connectionId: id,workerId: id,operationId: id,fencingToken: 1,userId: id })).toThrow();
    expect(new IntegrationWorkflowError("COLLECTOR_REQUIRES_ATTENTION").message).toBe("COLLECTOR_REQUIRES_ATTENTION");
  });
});
