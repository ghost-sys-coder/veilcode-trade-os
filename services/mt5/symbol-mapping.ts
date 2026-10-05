import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { getIntegrationConfig } from "@/config/integrations";
import { mt5SymbolMappingRequestSchema } from "@/domain/mt5/symbol-mapping";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { mt5SymbolMappingTransaction } from "@/services/integrations/publication-database";

export async function saveMt5SymbolMapping(client: SupabaseClient<IntegrationDatabase>, input: unknown) {
  if (!getIntegrationConfig("MT5").enabled) throw new Error("MT5_PUBLICATION_UNAVAILABLE");
  const request = mt5SymbolMappingRequestSchema.parse(input);
  const result = await mt5SymbolMappingTransaction(await getVerifiedBrowserContext(client), request);
  return z.object({
    connectionId: z.string().uuid(),
    version: z.string().regex(/^[1-9][0-9]*$/),
    brokerSymbol: z.string(),
    instrumentId: z.string().uuid(),
    mappingVersion: z.string().regex(/^[1-9][0-9]*$/),
  }).parse(result);
}
