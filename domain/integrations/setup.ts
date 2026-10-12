import { z } from "zod";
import { localMcpConfigSchema } from "./local-mcp-config";

export const setupKinds = ["MT5_WINDOWS", "CODEX", "CLAUDE_CODE", "GEMINI_CLI"] as const;
export const setupKindSchema = z.enum(setupKinds);
export type SetupKind = z.infer<typeof setupKindSchema>;
export const setupLabels: Record<SetupKind, string> = {
  MT5_WINDOWS: "MetaTrader 5", CODEX: "Codex", CLAUDE_CODE: "Claude Code", GEMINI_CLI: "Gemini CLI",
};
export const setupRequestSchema = z.object({ operationId: z.string().uuid(), clientKind: setupKindSchema,
  accountId: z.string().uuid().nullable() }).strict().superRefine((value, ctx) => {
  if ((value.clientKind === "MT5_WINDOWS") !== (value.accountId !== null))
    ctx.addIssue({ code: "custom", path: ["accountId"], message: "MT5 requires an owned account; MCP is account-free" });
});
export const setupProfileSchema = z.object({ id: z.string().uuid(), purpose: z.enum(["MT5", "MCP"]),
  clientKind: setupKindSchema, accountId: z.string().uuid().nullable(), resource: z.string().url(),
  callbackUri: z.string().url(), clientId: z.string().uuid().nullable(), status: z.enum(["REGISTERING", "READY"]),
  version: z.string().regex(/^[1-9][0-9]*$/), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  const ports = { MT5_WINDOWS: 9876, CODEX: 9878, CLAUDE_CODE: 9880, GEMINI_CLI: 9882 };
  if (value.callbackUri !== `http://127.0.0.1:${ports[value.clientKind]}/callback`
    || (value.purpose === "MT5") !== (value.clientKind === "MT5_WINDOWS")
    || (value.purpose === "MT5") !== (value.accountId !== null)
    || (value.status === "READY") !== (value.clientId !== null))
    ctx.addIssue({ code: "custom", message: "Invalid setup binding" });
  const resource = new URL(value.resource);
  if (resource.username || resource.password || resource.search || resource.hash
    || resource.pathname !== (value.purpose === "MCP" ? "/mcp" : "/api/integrations/v1")
    || (resource.protocol !== "https:" && !(resource.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(resource.hostname))))
    ctx.addIssue({ code: "custom", message: "Invalid setup resource" });
});
export type SetupProfile = z.infer<typeof setupProfileSchema>;
export function setupClientName(profile: SetupProfile) {
  return `Trade OS ${profile.clientKind} setup ${profile.id}`;
}
export function mcpSetupConfiguration(profile: SetupProfile, issuer: string, allowLoopback = false) {
  if (profile.purpose !== "MCP" || profile.status !== "READY" || !profile.clientId) throw new Error("Setup not ready");
  return localMcpConfigSchema.parse({ version: 1, profile: `tradeos-${profile.id}`, resource: profile.resource,
    issuer, clientId: profile.clientId, redirectUri: profile.callbackUri, allowLoopback });
}

/** Configured is not authorized, and authorization alone is not observed health. */
export function setupProgress(profile: SetupProfile, grant?: { status: string; revoked_at: string | null }) {
  if (profile.status !== "READY") return { step: "REGISTRATION", label: "Registration needs verification" } as const;
  if (grant?.status === "REVOKED" || grant?.revoked_at) return { step: "CONSENT", label: "Access revoked — reconnect required" } as const;
  if (grant?.status === "ACTIVE") return { step: "VERIFICATION", label: "Authorized — verify in the client" } as const;
  return { step: "INSTALLATION", label: "Configuration ready — installation and consent required" } as const;
}
