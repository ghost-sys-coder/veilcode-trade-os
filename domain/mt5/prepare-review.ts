import {buildMt5OnboardingPreview} from "./onboarding";
import {prepareMt5Publication} from "./publication";
import {cashMovementAmount,supportedCashTypes} from "./cash";
import type {Mt5ReviewRequest} from "./review";
import type {Mt5Snapshot} from "./snapshot";

/** Shared browser/MCP decision preparation; no new financial writer or inferred plan. */
export function prepareMt5Review(snapshot:Mt5Snapshot,request:Mt5ReviewRequest):object {
  if(snapshot.connection.id!==request.connectionId||snapshot.connection.version!==request.version||snapshot.snapshotToken!==request.snapshotToken||snapshot.ledgerToken!==request.ledgerToken)
    throw new RangeError("MT5 review evidence changed.");
  if(request.reviewKind==="SOURCE") {
    if(!snapshot.sources.some(s=>s.kind===request.sourceKind&&s.sourceId===request.sourceId&&s.revisionId===request.sourceRevisionId&&s.requiresReview))
      throw new RangeError("Changed source review required.");
    return {};
  }
  if(request.reviewKind==="CASH") {
    const source=snapshot.sources.find(s=>s.kind==="DEAL"&&s.sourceId===request.sourceId&&s.revisionId===request.sourceRevisionId&&!s.requiresReview);
    if(!source||source.event.kind!=="DEAL"||source.event.payload.positionId!==null||!supportedCashTypes.includes(source.event.payload.type)
      ||!snapshot.cashDecisions.some(d=>d.sourceTicket===request.sourceId))throw new RangeError("Reviewed supported cash revision required.");
    return {amount:cashMovementAmount(source.event.payload,snapshot.connection.identity.currencyPrecision)};
  }
  const domainInput={...snapshot,startingBalance:snapshot.account.startingBalance,ledgerBalance:snapshot.account.ledgerBalance};
  const match=buildMt5OnboardingPreview(domainInput).episodes.find(e=>e.episode.canonicalIdentity===request.canonicalIdentity);
  if(request.reviewKind==="REOPEN") {
    const previous=snapshot.manualDecisions.filter(d=>d.canonicalIdentity===request.canonicalIdentity&&d.tradeId===request.tradeId).at(-1);
    if(!match||previous?.decision!=="DISTINCT")throw new RangeError("Existing distinct decision required.");
    return {episodes:[match.episode]};
  }
  if(!match?.matchingTradeIds.includes(request.tradeId))throw new RangeError("Exact manual match required.");
  if(request.reviewKind==="DISTINCT")return {episodes:[match.episode]};
  const proposal=prepareMt5Publication({...domainInput,existingTrades:snapshot.existingTrades.filter(t=>t.id!==request.tradeId)},
    {...request,openingBaseline:snapshot.account.startingBalance,episodeIdentities:[request.canonicalIdentity]});
  return {...proposal,episodes:proposal.episodes.map(e=>({...e,linkTradeId:request.tradeId}))};
}
