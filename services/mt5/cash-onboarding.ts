import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { getIntegrationConfig } from "@/config/integrations";
import { mt5CashRequestSchema, prepareMt5CashDecision } from "@/domain/mt5/cash";
import { mt5OnboardingRequestSchema, prepareMt5OnboardingApproval } from "@/domain/mt5/onboarding-approval";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { mt5CashTransaction, mt5OnboardingTransaction } from "@/services/integrations/publication-database";
import { getMt5OnboardingSnapshot } from "@/services/mt5/onboarding";

const common = { connectionId:z.string().uuid(), version:z.string().regex(/^[1-9][0-9]*$/) };
const cashResult = z.object({ ...common, sourceTicket:z.string(), adjustmentId:z.string().uuid().nullable() });
const onboardingResult = z.object({ ...common, approvalId:z.string().uuid(), reconciliationState:z.literal("APPROVED_SNAPSHOT") });
type Client = SupabaseClient<IntegrationDatabase>;

export async function classifyMt5Cash(client:Client,input:unknown) {
  if (!getIntegrationConfig("MT5").enabled) throw new Error("MT5_PUBLICATION_UNAVAILABLE");
  const request = mt5CashRequestSchema.parse(input);
  const actor = await getVerifiedBrowserContext(client);
  const receipt = await mt5CashTransaction(actor,request);
  if (receipt !== null) return cashResult.parse(receipt);
  const snapshot = await getMt5OnboardingSnapshot(client,request.connectionId);
  if (snapshot.connection.version !== request.version || snapshot.snapshotToken !== request.snapshotToken || snapshot.ledgerToken !== request.ledgerToken)
    throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
  const proposal = prepareMt5CashDecision(snapshot.sources,request,snapshot.account.currencyPrecision);
  return cashResult.parse(await mt5CashTransaction(actor,request,proposal));
}
export async function approveMt5Onboarding(client:Client,input:unknown) {
  if (!getIntegrationConfig("MT5").enabled) throw new Error("MT5_PUBLICATION_UNAVAILABLE");
  const request = mt5OnboardingRequestSchema.parse(input);
  const actor = await getVerifiedBrowserContext(client);
  const receipt = await mt5OnboardingTransaction(actor,request);
  if (receipt !== null) return onboardingResult.parse(receipt);
  const snapshot = await getMt5OnboardingSnapshot(client,request.connectionId);
  const proposal = prepareMt5OnboardingApproval({ ...snapshot,startingBalance:snapshot.account.startingBalance,ledgerBalance:snapshot.account.ledgerBalance },request);
  return onboardingResult.parse(await mt5OnboardingTransaction(actor,request,proposal));
}
