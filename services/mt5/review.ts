import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { IntegrationDatabase } from "@/types/integration-database";
import { mt5ReviewRequestSchema,mt5PolicyRequestSchema } from "@/domain/mt5/review";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { mt5ReviewTransaction } from "@/services/integrations/publication-database";
import { getMt5OnboardingSnapshot } from "@/services/mt5/onboarding";
import {prepareMt5Review} from "@/domain/mt5/prepare-review";
import { getIntegrationConfig } from "@/config/integrations";

const resultSchema=z.object({connectionId:z.string().uuid(),version:z.string(),reviewKind:z.string()});
export async function reviewMt5Conflict(client:SupabaseClient<IntegrationDatabase>,input:unknown) {
  if(!getIntegrationConfig("MT5").enabled)throw new Error("MT5_REVIEW_UNAVAILABLE");
  const request=mt5ReviewRequestSchema.parse(input),context=await getVerifiedBrowserContext(client);
  const receipt=await mt5ReviewTransaction(context,request);
  if(receipt!=null)return resultSchema.parse(receipt);
  const snapshot=await getMt5OnboardingSnapshot(client,request.connectionId);
  let proposal:object;
  try {proposal=prepareMt5Review(snapshot,request);} catch {throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");}
  return resultSchema.parse(await mt5ReviewTransaction(context,request,proposal));
}
export async function setMt5PublicationPolicy(client:SupabaseClient<IntegrationDatabase>,input:unknown) {
  if(!getIntegrationConfig("MT5").enabled)throw new Error("MT5_REVIEW_UNAVAILABLE");
  const request={...mt5PolicyRequestSchema.parse(input),reviewKind:"POLICY" as const};
  return resultSchema.parse(await mt5ReviewTransaction(await getVerifiedBrowserContext(client),request,{}));
}
