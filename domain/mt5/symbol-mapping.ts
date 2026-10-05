import { z } from "zod";

export const mt5SymbolMappingRequestSchema = z.object({
  connectionId: z.string().uuid(),
  operationId: z.string().uuid(),
  version: z.string().regex(/^[1-9][0-9]*$/),
  snapshotToken: z.string().regex(/^[a-f0-9]{64}$/),
  brokerSymbol: z.string().min(1).max(128).refine(value => value === value.trim()),
  instrumentId: z.string().uuid(),
  reason: z.string().trim().min(8).max(1000),
}).strict();
export type Mt5SymbolMappingRequest = z.infer<typeof mt5SymbolMappingRequestSchema>;

export const mt5SymbolMappingSchema = z.object({
  brokerSymbol: z.string(),
  instrumentId: z.string().uuid(),
  version: z.string().regex(/^[1-9][0-9]*$/),
  reason: z.string(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Mt5SymbolMapping = z.infer<typeof mt5SymbolMappingSchema>;
