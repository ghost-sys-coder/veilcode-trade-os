import { z } from "zod";
import { recordVersionSchema } from "@/domain/configuration/commands";

export const JOURNAL_KINDS=["DAILY","WEEKLY","MONTHLY"] as const;
const text=z.string().trim().max(4000).nullable();
const daily={market_conditions:text,mental_state:text,followed_daily_plan:z.boolean().nullable(),
  hit_daily_loss_threshold:z.boolean().nullable(),stopped_when_required:z.boolean().nullable(),daily_rating:z.number().int().min(1).max(5).nullable(),lessons:text,notes:text};
const weekly={what_worked:text,what_did_not:text,change_next_week:text,behavior_to_stop:text,behavior_to_continue:text,notes:text};
const monthly={what_worked:text,what_did_not:text,lessons:text,focus_next_month:text,notes:text};
const key={kind:z.enum(JOURNAL_KINDS),accountId:z.string().uuid(),period:z.iso.date()};
function validPeriod(input:{kind:typeof JOURNAL_KINDS[number];period:string},context:z.RefinementCtx) {
  if(input.kind==="WEEKLY" && new Date(`${input.period}T00:00:00Z`).getUTCDay()!==1
    || input.kind==="MONTHLY" && !input.period.endsWith("-01"))context.addIssue({code:"custom",path:["period"],message:"Weekly periods start Monday; monthly periods start on day one."});
}
export const journalGetSchema=z.object(key).strict().superRefine(validPeriod);
export const journalListSchema=z.object({kind:key.kind,accountId:key.accountId,afterId:z.string().uuid().optional(),
  limit:z.number().int().min(1).max(100).default(50)}).strict();
const mutation={accountId:key.accountId,period:key.period,operationId:z.string().uuid(),
  expectedVersion:z.union([z.literal("0"),recordVersionSchema])};
const patch=(fields:typeof daily|typeof weekly|typeof monthly)=>z.object(fields).partial().strict().refine(value=>Object.keys(value).length>0,"Submit at least one reflection field.");
export const journalSaveSchema=z.discriminatedUnion("kind",[
  z.object({...mutation,kind:z.literal("DAILY"),values:patch(daily)}).strict(),
  z.object({...mutation,kind:z.literal("WEEKLY"),values:patch(weekly)}).strict(),
  z.object({...mutation,kind:z.literal("MONTHLY"),values:patch(monthly)}).strict(),
]).superRefine(validPeriod);
const numeric=z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable();
const storedText=z.string().nullable(); // Read legacy reflection text without truncation.
export const journalRecordSchema=z.object({id:z.string().uuid(),user_id:z.string().uuid(),account_id:z.string().uuid(),record_version:recordVersionSchema,
  created_at:z.iso.datetime({offset:true}),updated_at:z.iso.datetime({offset:true}),
  trading_date:z.iso.date().optional(),week_start:z.iso.date().optional(),month:z.iso.date().optional(),
  starting_balance:numeric.optional(),ending_balance:numeric.optional(),
  market_conditions:storedText.optional(),mental_state:storedText.optional(),followed_daily_plan:z.boolean().nullable().optional(),
  hit_daily_loss_threshold:z.boolean().nullable().optional(),stopped_when_required:z.boolean().nullable().optional(),daily_rating:z.number().int().min(1).max(5).nullable().optional(),
  lessons:storedText.optional(),notes:storedText.optional(),what_worked:storedText.optional(),what_did_not:storedText.optional(),
  change_next_week:storedText.optional(),behavior_to_stop:storedText.optional(),behavior_to_continue:storedText.optional(),focus_next_month:storedText.optional(),
}).strict();
export const journalResultSchema=z.object({kind:key.kind,record:journalRecordSchema.nullable()}).strict();
export const journalPageSchema=z.object({records:z.array(journalRecordSchema),nextCursor:z.string().uuid().nullable()}).strict();
