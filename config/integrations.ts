import { z } from "zod";
import type { IntegrationActor } from "@/domain/integrations/actor";

export function getIntegrationConfig(purpose: IntegrationActor["purpose"]) {
  const origin = new URL(z.string().url().parse(process.env.TRADE_OS_INTEGRATION_ORIGIN));
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
    || (origin.protocol !== "https:" && !(origin.protocol === "http:" && local))) throw new Error("Invalid integration origin.");
  return {
    resource: `${origin.origin}${purpose === "MT5" ? "/api/integrations/v1" : "/mcp"}`,
    enabled: process.env[purpose === "MT5" ? "TRADE_OS_MT5_ENABLED" : "TRADE_OS_MCP_ENABLED"] === "true",
  };
}
