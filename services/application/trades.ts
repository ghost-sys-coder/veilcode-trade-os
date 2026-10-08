import "server-only";
import { z } from "zod";
import { tradeCommand,tradeGetSchema,tradeListSchema,tradeResultSchema,tradePageSchema,prepareTrade,type TradeAction } from "@/domain/trades/commands";
import { applicationTransaction,type ApplicationContext } from "@/services/application/transaction";
export async function writeTrade(context:ApplicationContext,action:TradeAction,input:unknown) {
  const request=tradeCommand(action,input);
  return tradeResultSchema.parse(await applicationTransaction(context,"TRADE_WRITE",request,snapshot=>prepareTrade(request,snapshot)));
}
export async function getTrade(context:ApplicationContext,input:unknown) {
  return z.record(z.string(),z.unknown()).parse(await applicationTransaction(context,"TRADE_READ",tradeGetSchema.parse(input)));
}
export async function listTrades(context:ApplicationContext,input:unknown) {
  return tradePageSchema.parse(await applicationTransaction(context,"TRADE_READ",tradeListSchema.parse(input)));
}
export async function listTradeReferences(context:ApplicationContext,input:unknown) {
  const request=z.object({afterId:z.string().uuid().optional(),limit:z.number().int().min(1).max(100).default(50)}).strict().parse(input);
  return tradePageSchema.parse(await applicationTransaction(context,"TRADE_REFERENCES",request));
}
