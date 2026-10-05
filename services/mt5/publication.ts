import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { mt5PublicationRequestSchema,prepareMt5Publication } from "@/domain/mt5/publication";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { mt5PublicationTransaction } from "@/services/integrations/publication-database";
import { getMt5OnboardingSnapshot } from "@/services/mt5/onboarding";
import { getIntegrationConfig } from "@/config/integrations";

const resultSchema = z.object({ connectionId: z.string().uuid(),version: z.string().regex(/^[1-9][0-9]*$/),
  tradeIds: z.array(z.string().uuid()),importBatchId: z.string().uuid(),reconciliationState: z.literal("NOT_APPROVED") });

export async function publishMt5Trades(client: SupabaseClient<IntegrationDatabase>, input: unknown) {
  if (!getIntegrationConfig("MT5").enabled) throw new Error("MT5_PUBLICATION_UNAVAILABLE");
  const request = mt5PublicationRequestSchema.parse(input);
  const context = await getVerifiedBrowserContext(client);
  // Recover a committed-but-unacknowledged operation before loading a now-changed ledger.
  const receipt = await mt5PublicationTransaction(context,request);
  if (receipt != null) return resultSchema.parse(receipt);
  const snapshot = await getMt5OnboardingSnapshot(client,request.connectionId);
  const proposal = prepareMt5Publication({ ...snapshot,startingBalance: snapshot.account.startingBalance,
    ledgerBalance: snapshot.account.ledgerBalance },request);
  return resultSchema.parse(await mt5PublicationTransaction(context,request,proposal));
}
