import {z} from "zod";
import {mt5ConnectionViewSchema} from "@/domain/mt5/onboarding";

const page={afterId:z.string().uuid().optional(),limit:z.number().int().min(1).max(100).default(50)};
export const mt5ConnectionsSchema=z.object({...page,accountId:z.string().uuid().optional()}).strict();
export const mt5GetSchema=z.object({connectionId:z.string().uuid()}).strict();
export const mt5MatchesSchema=mt5GetSchema.extend({...page,canonicalIdentity:z.string().min(1).max(160)}).strict();
export const mt5PreviewSchema=mt5GetSchema.extend({limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(2048).optional()}).strict();
export const mt5SourcesSchema=mt5GetSchema.extend({kind:z.enum(["DEAL","ORDER","POSITION","ACCOUNT"]).optional(),sourceId:z.string().min(1).max(64).optional(),
  afterRevisionId:z.string().regex(/^[1-9][0-9]{0,18}$/).optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
export const importListSchema=z.object({...page,accountId:z.string().uuid().optional()}).strict();
export const importGetSchema=z.object({batchId:z.string().uuid()}).strict();
export const importRowsSchema=importGetSchema.extend(page).strict();
export const connectionPageSchema=z.object({records:z.array(mt5ConnectionViewSchema),nextCursor:z.string().uuid().nullable()});
export const integrationRecordSchema=z.record(z.string(),z.unknown());
export const integrationPageSchema=z.object({records:z.array(integrationRecordSchema),nextCursor:z.string().nullable()});
