import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { localMcpConfigSchema } from "../../domain/integrations/local-mcp-config.ts";

export class LocalMcpError extends Error {
  readonly code: string;
  readonly refreshStage?: "PRE_CLEAR" | "PROVIDER_REQUEST" | "TOKEN_RESPONSE" | "TOKEN_VERIFICATION" | "CREDENTIAL_SAVE";
  constructor(code: string, refreshStage?: LocalMcpError["refreshStage"]) {
    super(code); this.code=code; this.refreshStage=refreshStage; this.name = "LocalMcpError";
  }
}
export const configSchema = localMcpConfigSchema;
export type LocalMcpConfig = z.infer<typeof configSchema>;
export async function readConfig(path: string): Promise<LocalMcpConfig> {
  try {
    const bytes = await readFile(path);
    if (bytes.length > 8192) throw new Error();
    return configSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch { throw new LocalMcpError("INVALID_CONFIG"); }
}
export function credentialContext(config: LocalMcpConfig): string {
  return ["Trade OS MCP credentials v1", config.profile, config.resource, config.issuer, config.clientId].join("\n");
}
export function vaultId(config: LocalMcpConfig): string {
  const digest = createHash("sha256").update(credentialContext(config)).digest("hex");
  return `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
}
export function safeMessage(error: unknown): string {
  const code = error instanceof LocalMcpError ? error.code : "UNAVAILABLE";
  const messages: Record<string,string> = {
    INVALID_CONFIG: "Invalid public configuration. Use the documented example; never put secrets in it.",
    LOGIN_REQUIRED: "Run the adapter's login command in a terminal, then restart this client.",
    ACCESS_DENIED: "Access denied or integration disabled. Check the application grant/flag; reconnect with login if needed.",
    PROFILE_BUSY: "This profile is already in use. Stop that adapter, or give each client a separate profile and consent.",
    VAULT_UNAVAILABLE: "Windows-protected credentials unavailable. Check Python 3.13+, Windows login and local storage.",
    INVALID_DISCOVERY: "Discovery does not match the configured resource/issuer. Check the deployment; do not weaken validation.",
    LOGIN_TIMEOUT: "Browser consent timed out. Run login again; no authorization code was saved.",
    BROWSER_UNAVAILABLE: "Windows could not open the consent browser. Check the default browser and retry approval.",
    REFRESH_UNCERTAIN: "Token refresh outcome uncertain. Run login again; no automatic refresh retry was made.",
    UNAVAILABLE: "Application or network unavailable. For an uncertain write, check tradeos_operation_status before retrying with the SAME operation ID.",
  };
  const stage=error instanceof LocalMcpError && code==="REFRESH_UNCERTAIN" &&
    ["PRE_CLEAR","PROVIDER_REQUEST","TOKEN_RESPONSE","TOKEN_VERIFICATION","CREDENTIAL_SAVE"].includes(error.refreshStage??"")
    ? ` Verification stage: ${error.refreshStage}.` : "";
  return `Trade OS MCP: ${messages[code] ?? messages.UNAVAILABLE}${stage}`;
}
