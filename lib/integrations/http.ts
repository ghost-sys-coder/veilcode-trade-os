import { ZodError } from "zod";
import { getIntegrationConfig } from "@/config/integrations";
import { IntegrationAuthorizationError, IntegrationUnavailableError } from "@/domain/integrations/actor";
import { IntegrationWorkflowError } from "@/domain/mt5/protocol";

const MAX_JSON_BYTES = 1_048_576;
/** Enforce the actual streamed size, not a caller-controlled Content-Length. */
export async function readIntegrationJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body)
    throw new IntegrationWorkflowError("INVALID_INTEGRATION_INPUT");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8",{ fatal: true });
  let size = 0, json = "";
  try {
    for (;;) {
      const { done,value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new IntegrationWorkflowError("INVALID_INTEGRATION_INPUT"); }
      json += decoder.decode(value,{ stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json);
  } catch { throw new IntegrationWorkflowError("INVALID_INTEGRATION_INPUT"); }
  finally { reader.releaseLock(); }
}
export function integrationErrorResponse(error: unknown) {
  const code = error instanceof IntegrationAuthorizationError ? "INTEGRATION_ACCESS_DENIED"
    : error instanceof IntegrationUnavailableError ? "INTEGRATION_UNAVAILABLE"
    : error instanceof IntegrationWorkflowError ? error.code : error instanceof ZodError ? "INVALID_INTEGRATION_INPUT" : "INTEGRATION_UNAVAILABLE";
  const status = error instanceof IntegrationAuthorizationError ? 401 : code === "INTEGRATION_ACCESS_DENIED" ? 403
    : code === "INVALID_INTEGRATION_INPUT" ? 400 : code === "INTEGRATION_UNAVAILABLE" ? 503 : 409;
  const headers: Record<string,string> = { "Cache-Control": "no-store" };
  if (status === 401) {
    headers["WWW-Authenticate"] = 'Bearer error="invalid_token"';
    try {
      const { resource } = getIntegrationConfig("MT5");
      headers["WWW-Authenticate"] += `, resource_metadata="${new URL(resource).origin}/.well-known/oauth-protected-resource/api/integrations/v1", scope="email"`;
    } catch { /* No host-header-derived resource or sensitive provider error. */ }
  }
  if (status === 503) headers["Retry-After"] = "15";
  return Response.json({ error: code },{ status,headers });
}
