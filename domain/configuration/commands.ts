import { z } from "zod";
import { setupSchema, strategySchema, tradingRuleSchema } from "@/domain/validation/schemas";
import { RULE_TYPES } from "@/types/domain";

export const configurationEntitySchema = z.enum(["STRATEGY", "SETUP", "RULE"]);
export const recordVersionSchema = z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine(value => BigInt(value) <= BigInt("9223372036854775807"), "Invalid record version.");
const description = z.string().trim().max(4000).nullable();
const common = { name:strategySchema.shape.name, description, active:z.boolean() };
const strategy = z.object(common).strict();
const setup = z.object({ ...common, name:setupSchema.shape.name, strategy_id:z.string().uuid() }).strict();
const rule = z.object({ name:tradingRuleSchema.shape.name, description:tradingRuleSchema.shape.description,
  active:z.boolean(), account_id:z.string().uuid().nullable(), rule_type:z.enum(RULE_TYPES),
  numeric_limit:z.string().max(27).regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/).nullable() }).strict();
const metadata = { operationId:z.string().uuid() };
const target = { id:z.string().uuid(), expectedVersion:recordVersionSchema };
const nonEmpty = <T extends z.ZodRawShape>(schema:z.ZodObject<T>) => schema.partial()
  .refine(value => Object.keys(value).length > 0, "A patch must include at least one field.");

export const configurationCreateSchema = z.discriminatedUnion("entity",[
  z.object({ ...metadata, entity:z.literal("STRATEGY"), values:strategy }).strict(),
  z.object({ ...metadata, entity:z.literal("SETUP"), values:setup }).strict(),
  z.object({ ...metadata, entity:z.literal("RULE"), values:rule }).strict(),
]);
export const configurationPatchSchema = z.discriminatedUnion("entity",[
  z.object({ ...metadata, ...target, entity:z.literal("STRATEGY"), values:nonEmpty(strategy) }).strict(),
  z.object({ ...metadata, ...target, entity:z.literal("SETUP"), values:nonEmpty(setup) }).strict(),
  z.object({ ...metadata, ...target, entity:z.literal("RULE"), values:nonEmpty(rule) }).strict(),
]);
export const configurationArchiveSchema = z.object({ ...metadata, ...target, entity:configurationEntitySchema,
  reason:z.string().trim().min(5).max(1000) }).strict();
// The action is adapter-owned, not an unknown extra key of the strict public schemas.
export function parseConfigurationCommand(action:"CREATE"|"PATCH"|"ARCHIVE", input:unknown) {
  const parsed = action === "CREATE" ? configurationCreateSchema.parse(input)
    : action === "PATCH" ? configurationPatchSchema.parse(input) : configurationArchiveSchema.parse(input);
  return { ...parsed, action };
}
export type ConfigurationCommand = ReturnType<typeof parseConfigurationCommand>;

export const configurationListSchema = z.object({ entity:configurationEntitySchema,
  afterId:z.string().uuid().optional(), limit:z.number().int().min(1).max(100).default(50),
  includeArchived:z.boolean().default(false) }).strict();
export const configurationGetSchema = z.object({ entity:configurationEntitySchema, id:z.string().uuid() }).strict();
export const configurationRecordSchema = z.object({
  id:z.string().uuid(), user_id:z.string().uuid(), name:z.string(), description:z.string().nullable(), active:z.boolean(),
  record_version:recordVersionSchema, archived_at:z.iso.datetime({offset:true}).nullable(),
  created_at:z.iso.datetime({offset:true}), updated_at:z.iso.datetime({offset:true}),
  strategy_id:z.string().uuid().optional(), account_id:z.string().uuid().nullable().optional(),
  rule_type:z.enum(RULE_TYPES).optional(), numeric_limit:z.string().nullable().optional(), is_example:z.boolean().optional(),
}).strict();
export const configurationPageSchema = z.object({ records:z.array(configurationRecordSchema), nextCursor:z.string().uuid().nullable() }).strict();
export const configurationResultSchema = z.object({ entity:configurationEntitySchema,
  action:z.enum(["CREATE","PATCH","ARCHIVE"]), record:configurationRecordSchema }).strict();
