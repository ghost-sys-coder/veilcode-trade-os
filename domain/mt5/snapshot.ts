import {z} from "zod";
import {mt5ConnectionViewSchema,mt5StoredSourceSchema} from "./onboarding";
import {mt5IdentitySchema} from "./source";
import {mt5SymbolMappingSchema} from "./symbol-mapping";
import {mt5CashDecisionSchema} from "./cash";
import {mt5ManualDecisionSchema} from "./review";

export const mt5SourcePageSchema=z.object({
  connectionId:z.string().uuid(),snapshotToken:z.string().regex(/^[a-f0-9]{64}$/),
  version:z.string().regex(/^[1-9][0-9]*$/),identity:mt5IdentitySchema,captureCheckpoint:z.iso.datetime({offset:true}).nullable(),
  ledgerToken:z.string().regex(/^[a-f0-9]{64}$/),
  account:z.object({name:z.string(),currencyCode:z.string(),currencyPrecision:z.number().int(),startingBalance:z.string(),ledgerBalance:z.string()}),
  tradeCount:z.number().int().nonnegative(),trades:z.array(z.object({id:z.string().uuid(),symbol:z.string(),direction:z.enum(["BUY","SELL"]),
    openedAt:z.string().nullable(),closedAt:z.string().nullable(),canonicalIdentity:z.string().nullable(),closedNetPnl:z.string().nullable(),reviewToken:z.string().optional()})),
  events:z.array(mt5StoredSourceSchema),sourceFactCount:z.number().int().nonnegative(),incompleteCollections:z.number().int().nonnegative(),
  symbolMappings:z.array(mt5SymbolMappingSchema).default([]),symbolMappingCount:z.number().int().nonnegative().default(0),
  manualDecisions:z.array(mt5ManualDecisionSchema).default([]),manualDecisionCount:z.number().int().nonnegative().default(0),
  automaticPublicationEnabled:z.boolean().default(false),cashDecisions:z.array(mt5CashDecisionSchema).default([]),cashDecisionCount:z.number().int().nonnegative().default(0),
  adjustments:z.array(z.object({id:z.string().uuid(),type:z.enum(["DEPOSIT","WITHDRAWAL","BALANCE_CORRECTION","OTHER"]),amount:z.string(),
    occurredAt:z.iso.datetime({offset:true}),isPerformanceNeutral:z.boolean().nullable()})).default([]),adjustmentCount:z.number().int().nonnegative().default(0),
  onboardingApproval:z.object({createdAt:z.iso.datetime({offset:true}),captureCheckpoint:z.iso.datetime({offset:true}),state:z.enum(["APPROVED_SNAPSHOT","STALE_APPROVAL"])}).nullable().default(null),
});
const dataSchema=z.object({connection:mt5ConnectionViewSchema,page:mt5SourcePageSchema,
  instruments:z.array(z.object({id:z.string().uuid(),symbol:z.string(),display_name:z.string(),user_id:z.string().uuid().nullable()}))});
export function decodeMt5Snapshot(input:unknown) {
  const {connection,page,instruments}=dataSchema.parse(input);
  if(connection.id!==page.connectionId||connection.version!==page.version||connection.captureCheckpoint!==page.captureCheckpoint
    ||JSON.stringify(connection.identity)!==JSON.stringify(page.identity)
    ||connection.sourceFactCount!==page.sourceFactCount||connection.incompleteCollections!==page.incompleteCollections
    ||connection.identity.currencyCode!==page.account.currencyCode||connection.identity.currencyPrecision!==page.account.currencyPrecision
    ||page.events.length!==page.sourceFactCount||page.trades.length!==page.tradeCount||page.symbolMappings.length!==page.symbolMappingCount
    ||page.cashDecisions.length!==page.cashDecisionCount||page.adjustments.length!==page.adjustmentCount||page.manualDecisions.length!==page.manualDecisionCount)
    throw new RangeError("Incomplete or inconsistent MT5 snapshot.");
  return {connection,account:page.account,sources:page.events,instruments,symbolMappings:page.symbolMappings,cashDecisions:page.cashDecisions,
    adjustments:page.adjustments,onboardingApproval:page.onboardingApproval,manualDecisions:page.manualDecisions,
    automaticPublicationEnabled:page.automaticPublicationEnabled,existingTrades:page.trades,snapshotToken:page.snapshotToken,ledgerToken:page.ledgerToken};
}
export type Mt5Snapshot=ReturnType<typeof decodeMt5Snapshot>;
