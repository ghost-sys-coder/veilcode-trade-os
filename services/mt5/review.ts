import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { IntegrationDatabase } from "@/types/integration-database";
import { mt5ReviewRequestSchema,mt5PolicyRequestSchema } from "@/domain/mt5/review";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { mt5ReviewTransaction } from "@/services/integrations/publication-database";
import { getMt5OnboardingSnapshot } from "@/services/mt5/onboarding";
import { prepareMt5Publication } from "@/domain/mt5/publication";
import { buildMt5OnboardingPreview } from "@/domain/mt5/onboarding";
import { getIntegrationConfig } from "@/config/integrations";
import {cashMovementAmount,supportedCashTypes} from "@/domain/mt5/cash";

const resultSchema=z.object({connectionId:z.string().uuid(),version:z.string(),reviewKind:z.string()});
export async function reviewMt5Conflict(client:SupabaseClient<IntegrationDatabase>,input:unknown) {
  if(!getIntegrationConfig("MT5").enabled)throw new Error("MT5_REVIEW_UNAVAILABLE");
  const request=mt5ReviewRequestSchema.parse(input),context=await getVerifiedBrowserContext(client);
  const receipt=await mt5ReviewTransaction(context,request);
  if(receipt!=null)return resultSchema.parse(receipt);
  const snapshot=await getMt5OnboardingSnapshot(client,request.connectionId);
  if(snapshot.connection.version!==request.version||snapshot.snapshotToken!==request.snapshotToken||snapshot.ledgerToken!==request.ledgerToken)
    throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
  if(request.reviewKind==="SOURCE") {
    if(!snapshot.sources.some(source=>source.kind===request.sourceKind&&source.sourceId===request.sourceId
      &&source.revisionId===request.sourceRevisionId&&source.requiresReview))throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
    return resultSchema.parse(await mt5ReviewTransaction(context,request,{}));
  }
  const domainInput={...snapshot,startingBalance:snapshot.account.startingBalance,ledgerBalance:snapshot.account.ledgerBalance};
  if(request.reviewKind==="CASH") {
    const source=snapshot.sources.find(s=>s.kind==="DEAL"&&s.sourceId===request.sourceId&&s.revisionId===request.sourceRevisionId&&!s.requiresReview);
    if(!source||source.event.kind!=="DEAL"||source.event.payload.positionId!==null
      ||!supportedCashTypes.includes(source.event.payload.type)||!snapshot.cashDecisions.some(d=>d.sourceTicket===request.sourceId))
      throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
    return resultSchema.parse(await mt5ReviewTransaction(context,request,{amount:cashMovementAmount(source.event.payload,snapshot.connection.identity.currencyPrecision)}));
  }
  const preview=buildMt5OnboardingPreview(domainInput);
  const match=preview.episodes.find(item=>item.episode.canonicalIdentity===request.canonicalIdentity);
  if(request.reviewKind==="REOPEN") {
    const previous=snapshot.manualDecisions.filter(d=>d.canonicalIdentity===request.canonicalIdentity&&d.tradeId===request.tradeId).at(-1);
    if(!match||previous?.decision!=="DISTINCT")throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
    return resultSchema.parse(await mt5ReviewTransaction(context,request,{episodes:[match.episode]}));
  }
  if(!match?.matchingTradeIds.includes(request.tradeId))throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
  if(request.reviewKind==="DISTINCT")return resultSchema.parse(await mt5ReviewTransaction(context,request,{episodes:[match.episode]}));
  // Only the explicitly selected manual match is removed from the simulation;
  // every other overlap and source blocker remains authoritative.
  const proposal=prepareMt5Publication({...domainInput,existingTrades:snapshot.existingTrades.filter(t=>t.id!==request.tradeId)},
    {...request,openingBaseline:snapshot.account.startingBalance,episodeIdentities:[request.canonicalIdentity]});
  return resultSchema.parse(await mt5ReviewTransaction(context,request,{...proposal,
    episodes:proposal.episodes.map(item=>({...item,linkTradeId:request.tradeId}))}));
}
export async function setMt5PublicationPolicy(client:SupabaseClient<IntegrationDatabase>,input:unknown) {
  if(!getIntegrationConfig("MT5").enabled)throw new Error("MT5_REVIEW_UNAVAILABLE");
  const request={...mt5PolicyRequestSchema.parse(input),reviewKind:"POLICY" as const};
  return resultSchema.parse(await mt5ReviewTransaction(await getVerifiedBrowserContext(client),request,{}));
}
