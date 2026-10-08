import { z } from "zod";
import { ACCOUNT_PLATFORMS, ACCOUNT_STATUSES, ACCOUNT_TYPES } from "@/types/domain";
import { tradingAccountSchema } from "@/domain/validation/schemas";
import { recordVersionSchema } from "@/domain/configuration/commands";
import { deriveAccountBalance } from "@/domain/accounts/balance";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import { ACCOUNT_CURRENCY_CODES } from "@/domain/money/currency-codes";

const decimal=z.string().max(40).regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,20})?$/);
const positive=decimal.refine(value=>parseDecimal(value).gt(0),"A positive decimal string is required.");
const text=z.string().trim().max(4000).nullable();
const fields={name:tradingAccountSchema.shape.name,account_type:z.enum(ACCOUNT_TYPES),broker_name:text,
  platform:z.enum(ACCOUNT_PLATFORMS),currency_code:z.string().regex(/^[A-Z]{3}$/),currency_precision:z.number().int().min(0).max(20),
  starting_balance:positive,leverage:positive.nullable(),started_at:z.iso.date(),notes:text};
const values=z.object(fields).strict();
export const accountCreateSchema=z.object({operationId:z.string().uuid(),values:values.extend({currency_code:z.enum(ACCOUNT_CURRENCY_CODES),
  status:z.enum(ACCOUNT_STATUSES).refine(value=>value!=="FAILED","Create the account, then use the explicit lifecycle workflow with a failure reason."),
})}).strict();
export const accountPatchSchema=z.object({operationId:z.string().uuid(),id:z.string().uuid(),expectedVersion:recordVersionSchema,
  reason:z.string().trim().min(5).max(1000).optional(),values:values.partial().refine(value=>Object.keys(value).length>0,"A patch requires at least one field.")}).strict();
export const accountGetSchema=z.object({id:z.string().uuid()}).strict();
export const accountListSchema=z.object({afterId:z.string().uuid().optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
const numeric=z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const accountRecordSchema=z.object({id:z.string().uuid(),user_id:z.string().uuid(),...fields,
  starting_balance:numeric,leverage:numeric.nullable(),status:z.enum(ACCOUNT_STATUSES),previous_account_id:z.string().uuid().nullable(),
  created_at:z.iso.datetime({offset:true}),updated_at:z.iso.datetime({offset:true}),record_version:recordVersionSchema,
  closed_trade_net_pnl:numeric,account_adjustments_total:numeric,closed_trade_count:z.string().regex(/^\d+$/),
  unclassified_other_count:z.string().regex(/^\d+$/),
}).strict();
export const accountWithBalanceSchema=accountRecordSchema.extend({derived_balance:numeric});
export type ApplicationAccount=z.infer<typeof accountWithBalanceSchema>;
export const accountPageSchema=z.object({records:z.array(accountWithBalanceSchema),nextCursor:z.string().uuid().nullable()}).strict();
export const accountResultSchema=z.object({action:z.enum(["CREATE","PATCH"]),record:accountWithBalanceSchema}).strict();

/** Same authoritative balance domain as manual UI, never snapshots/equity. */
export function accountWithBalance(input:unknown) {
  const account=accountRecordSchema.parse(input);
  return {...account,starting_balance:normalizeMoney(account.starting_balance,account.currency_precision),
    closed_trade_net_pnl:normalizeMoney(account.closed_trade_net_pnl,account.currency_precision),
    account_adjustments_total:normalizeMoney(account.account_adjustments_total,account.currency_precision),
    derived_balance:deriveAccountBalance({startingBalance:account.starting_balance,closedTradeNetPnl:[account.closed_trade_net_pnl],
      accountAdjustments:[account.account_adjustments_total],currencyPrecision:account.currency_precision})};
}
