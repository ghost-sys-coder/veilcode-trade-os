"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAccountEvent } from "@/services/application/account-events";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { ApplicationWorkflowError } from "@/services/application/transaction";
import { decimalStringSchema } from "@/domain/validation/schemas";
import { firstValidationError } from "@/lib/action-errors";
import { writeProgress } from "@/services/application/progress";
import { createClient } from "@/lib/supabase/server";
import {
  ACCOUNT_FAILURE_REASONS,
  ACCOUNT_PLATFORMS,
  ACCOUNT_STATUSES,
} from "@/types/domain";

function value(formData: FormData, name: string): string {
  const item = formData.get(name);
  return typeof item === "string" ? item.trim() : "";
}

function optional(formData: FormData, name: string): string | undefined {
  return value(formData, name) || undefined;
}

function pathFor(formData: FormData, fallback: string): string {
  const candidate = value(formData, "returnPath");
  return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : fallback;
}

function finish(path: string, kind: "error" | "message", message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
}

const optionalDecimal = z.preprocess((item) => item === "" ? undefined : item, decimalStringSchema.optional());
function utcFormInstant(raw:string):string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)?`${raw}:00Z`:raw;
}

function failure(error:unknown):string {
  return error instanceof ApplicationWorkflowError?error.message:error instanceof z.ZodError?firstValidationError(error):"Application workflow unavailable. Check operation status before retrying an uncertain write.";
}

export async function savePropConfig(formData:FormData):Promise<void> {
  const path=pathFor(formData,"/prop");
  const names={firmName:"firm_name",modelName:"model_name",phaseName:"phase_name",profitTargetMode:"profit_target_mode",profitTargetValue:"profit_target_value",
    dailyLossMode:"daily_loss_mode",dailyLossValue:"daily_loss_value",dailyLossBaseline:"daily_loss_baseline",dailyLossMeasure:"daily_loss_measure",
    totalLossMode:"total_loss_mode",totalLossValue:"total_loss_value",totalLossBaseline:"total_loss_baseline",totalLossMeasure:"total_loss_measure",
    drawdownType:"drawdown_type",consistencyFormula:"consistency_formula",consistencyLimitPercent:"consistency_limit_percent",
    minimumTradingDays:"minimum_trading_days",maximumTradingDays:"maximum_trading_days",tradingDayTimezone:"trading_day_timezone",profitableDayMinPnl:"profitable_day_min_pnl",notes:"notes"};
  const values:Record<string,unknown>={};
  for(const [name,field] of Object.entries(names)) {
    const raw=value(formData,name);
    values[field]=!raw?null:field==="minimum_trading_days"||field==="maximum_trading_days"?(/^\d+$/.test(raw)?Number(raw):raw):raw;
  }
  try {await writeProgress(await getVerifiedBrowserContext(await createClient()),"PROP_SAVE",{accountId:value(formData,"accountId"),
    operationId:value(formData,"operationId"),expectedVersion:value(formData,"expectedVersion"),values});}
  catch(error){finish(path,"error",failure(error));}
  revalidatePath("/prop");finish(path,"message","Prop rules saved.");
}

export async function recordAccountSnapshot(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/prop");
  const schema = z.object({ accountId: z.string().uuid(), balance: decimalStringSchema, equity: optionalDecimal, unrealizedPnl: optionalDecimal, capturedAt: z.string().min(1), notes: z.string().trim().max(1000).optional() });
  const parsed = schema.safeParse({ accountId: value(formData, "accountId"), balance: value(formData, "balance"), equity: value(formData, "equity"), unrealizedPnl: value(formData, "unrealizedPnl"), capturedAt: value(formData, "capturedAt"), notes: optional(formData, "notes") });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  if (!parsed.data.equity && !parsed.data.unrealizedPnl) finish(path, "error", "Enter either equity or unrealized PnL.");
  try {await writeAccountEvent(await getVerifiedBrowserContext(await createClient()),"SNAPSHOT",{...parsed.data,
    operationId:value(formData,"operationId"),capturedAt:utcFormInstant(parsed.data.capturedAt)});}
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid snapshot. Equity must equal balance plus unrealized PnL.");}
  revalidatePath("/prop"); revalidatePath(`/accounts/${parsed.data.accountId}`);
  finish(path, "message", "Account snapshot recorded.");
}

export async function createGoal(formData:FormData):Promise<void> {
  const path=pathFor(formData,"/goals");
  try {await writeProgress(await getVerifiedBrowserContext(await createClient()),"GOAL_CREATE",{operationId:value(formData,"operationId"),
    accountId:value(formData,"accountId"),values:{title:value(formData,"title"),goal_type:value(formData,"goalType"),
      target_value:value(formData,"targetValue"),target_date:value(formData,"targetDate")||null,
      custom_unit:value(formData,"goalType")==="CUSTOM"?value(formData,"customUnit")||null:null,notes:value(formData,"notes")||null,active:true}});}
  catch(error){finish(path,"error",failure(error));}
  revalidatePath("/goals");finish(path,"message","Goal created.");
}

export async function patchGoal(formData:FormData):Promise<void> {
  const path=pathFor(formData,"/goals");
  try {await writeProgress(await getVerifiedBrowserContext(await createClient()),"GOAL_PATCH",{operationId:value(formData,"operationId"),
    id:value(formData,"goalId"),expectedVersion:value(formData,"expectedVersion"),values:{title:value(formData,"title"),
      target_value:value(formData,"targetValue"),target_date:value(formData,"targetDate")||null,notes:value(formData,"notes")||null,
      active:formData.get("active")==="on"}});}
  catch(error){finish(path,"error",failure(error));}
  revalidatePath("/goals");finish(path,"message","Goal updated.");
}

export async function archiveGoal(formData:FormData):Promise<void> {
  const path=pathFor(formData,"/goals");
  try {await writeProgress(await getVerifiedBrowserContext(await createClient()),"GOAL_ARCHIVE",{operationId:value(formData,"operationId"),
    id:value(formData,"goalId"),expectedVersion:value(formData,"expectedVersion"),reason:value(formData,"reason")});}
  catch(error){finish(path,"error",failure(error));}
  revalidatePath("/goals");finish(path,"message","Goal archived. Progress evidence is preserved.");
}

export async function recordCustomGoalProgress(formData:FormData):Promise<void> {
  const path=pathFor(formData,"/goals");
  try {await writeProgress(await getVerifiedBrowserContext(await createClient()),"GOAL_PROGRESS",{operationId:value(formData,"operationId"),
    goalId:value(formData,"goalId"),expectedVersion:value(formData,"expectedVersion"),progressValue:value(formData,"progressValue"),
    recordedAt:utcFormInstant(value(formData,"recordedAt")),notes:value(formData,"notes")||null});}
  catch(error){finish(path,"error",failure(error));}
  revalidatePath("/goals");finish(path,"message","Custom progress recorded.");
}

export async function transitionAccountStatus(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/prop");
  const parsed = z.object({ accountId: z.string().uuid(), status: z.enum(ACCOUNT_STATUSES), effectiveAt: z.string().min(1), failureReason: z.enum(ACCOUNT_FAILURE_REASONS).optional(), notes: z.string().trim().max(2000).optional() }).safeParse({ accountId: value(formData, "accountId"), status: value(formData, "status"), effectiveAt: value(formData, "effectiveAt"), failureReason: optional(formData, "failureReason"), notes: optional(formData, "notes") });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  if (parsed.data.status === "FAILED" && !parsed.data.failureReason) finish(path, "error", "A failure reason is required.");
  try {await writeAccountEvent(await getVerifiedBrowserContext(await createClient()),"TRANSITION",{accountId:parsed.data.accountId,
    operationId:value(formData,"operationId"),expectedVersion:value(formData,"expectedVersion"),status:parsed.data.status,
    effectiveAt:utcFormInstant(parsed.data.effectiveAt),failureReason:parsed.data.status==="FAILED"?parsed.data.failureReason:null,reason:parsed.data.notes});}
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid lifecycle change. A meaningful reason is required.");}
  revalidatePath("/prop"); revalidatePath("/accounts"); revalidatePath(`/accounts/${parsed.data.accountId}`);
  finish(path, "message", `Account marked ${parsed.data.status.toLowerCase()}.`);
}

export async function createLinkedFundedAccount(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/prop");
  const parsed = z.object({ challengeId: z.string().uuid(), name: z.string().trim().min(2).max(80), startingBalance: decimalStringSchema, platform: z.enum(ACCOUNT_PLATFORMS), startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse({ challengeId: value(formData, "challengeId"), name: value(formData, "name"), startingBalance: value(formData, "startingBalance"), platform: value(formData, "platform"), startedAt: value(formData, "startedAt") });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  const {challengeId,...fields}=parsed.data;
  try {await writeAccountEvent(await getVerifiedBrowserContext(await createClient()),"LINK_FUNDED",{...fields,accountId:challengeId,
    operationId:value(formData,"operationId"),expectedVersion:value(formData,"expectedVersion")});}
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Only a current, passed challenge can create a linked funded account.");}
  revalidatePath("/prop"); revalidatePath("/accounts");
  finish(path, "message", "Linked funded account created. The challenge history remains separate.");
}
