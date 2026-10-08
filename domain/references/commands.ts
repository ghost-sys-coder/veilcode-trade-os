import { z } from "zod";
import { recordVersionSchema } from "@/domain/configuration/commands";
import { parseDecimal } from "@/domain/money/decimal";
import { ASSET_CLASSES } from "@/types/domain";

export const referenceEntitySchema = z.enum(["TAG", "INSTRUMENT"]);
export const tagValuesSchema = z.object({
  name:z.string().trim().min(1).max(40), color:z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
}).strict();
export const instrumentValuesSchema = z.object({
  symbol:z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9._/#-]*$/),
  display_name:z.string().trim().min(1).max(120), asset_class:z.enum(ASSET_CLASSES),
  base_currency:z.string().regex(/^[A-Z]{3}$/).nullable(), quote_currency:z.string().regex(/^[A-Z]{3}$/).nullable(),
  pip_size:z.string().regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,10})?$/)
    .refine(value=>parseDecimal(value).gt(0),"Pip size must be positive.").nullable(),
  price_precision:z.number().int().min(0).max(20), active:z.boolean(),
}).strict();
const operation = {operationId:z.string().uuid()};
const target = {id:z.string().uuid(),expectedVersion:recordVersionSchema};
const nonEmpty = <T extends z.ZodRawShape>(schema:z.ZodObject<T>)=>schema.partial()
  .refine(value=>Object.keys(value).length>0,"Provide at least one field.");
export const referenceCreateSchema = z.discriminatedUnion("entity",[
  z.object({...operation,entity:z.literal("TAG"),values:tagValuesSchema}).strict(),
  z.object({...operation,entity:z.literal("INSTRUMENT"),values:instrumentValuesSchema}).strict(),
]);
export const referencePatchSchema = z.discriminatedUnion("entity",[
  z.object({...operation,...target,entity:z.literal("TAG"),values:nonEmpty(tagValuesSchema)}).strict(),
  z.object({...operation,...target,entity:z.literal("INSTRUMENT"),values:nonEmpty(instrumentValuesSchema)}).strict(),
]);
export const referenceArchiveSchema = z.object({...operation,...target,entity:referenceEntitySchema,
  reason:z.string().trim().min(5).max(1000)}).strict();
export type ReferenceAction = "CREATE"|"PATCH"|"ARCHIVE";
export function parseReferenceCommand(action:ReferenceAction,input:unknown) {
  const parsed=action==="CREATE"?referenceCreateSchema.parse(input):action==="PATCH"?referencePatchSchema.parse(input):referenceArchiveSchema.parse(input);
  return {...parsed,action};
}
export const referenceGetSchema=z.object({entity:referenceEntitySchema,id:z.string().uuid()}).strict();
export const referenceListSchema=z.object({entity:referenceEntitySchema,afterId:z.string().uuid().optional(),
  limit:z.number().int().min(1).max(100).default(50),includeArchived:z.boolean().default(false)}).strict();
export const tradeTagsListSchema=z.object({tradeId:z.string().uuid(),afterId:z.string().uuid().optional(),
  limit:z.number().int().min(1).max(100).default(50)}).strict();
export const tradeTagCommandSchema=z.object({...operation,tradeId:z.string().uuid(),tagId:z.string().uuid(),
  expectedVersion:recordVersionSchema,expectedTagVersion:recordVersionSchema}).strict();
const times={created_at:z.iso.datetime({offset:true}),updated_at:z.iso.datetime({offset:true}),
  record_version:recordVersionSchema,archived_at:z.iso.datetime({offset:true}).nullable()};
export const tagRecordSchema=z.object({id:z.string().uuid(),user_id:z.string().uuid(),name:z.string(),color:z.string().nullable(),
  normalized_name:z.string(),...times}).strict();
export const instrumentRecordSchema=z.object({id:z.string().uuid(),user_id:z.string().uuid().nullable(),
  ...instrumentValuesSchema.shape,...times}).strict();
export const referenceRecordSchema=z.union([tagRecordSchema,instrumentRecordSchema]);
export const referencePageSchema=z.object({records:z.array(referenceRecordSchema),nextCursor:z.string().uuid().nullable()}).strict();
export const referenceResultSchema=z.object({entity:referenceEntitySchema,action:z.enum(["CREATE","PATCH","ARCHIVE"]),record:referenceRecordSchema}).strict();
export const tradeTagResultSchema=z.object({action:z.enum(["ASSIGN","REMOVE"]),tradeId:z.string().uuid(),tagId:z.string().uuid(),
  assigned:z.boolean(),tradeVersion:recordVersionSchema}).strict();
