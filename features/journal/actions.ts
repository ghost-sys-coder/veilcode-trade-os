"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { writeAccountEvent } from "@/services/application/account-events";
import { saveJournal } from "@/services/application/journals";
import { writeReference,writeTradeTag } from "@/services/application/references";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { ApplicationWorkflowError } from "@/services/application/transaction";
import {
  adjustmentClassificationSchema,
  accountAdjustmentSchema,
  tagSchema,
} from "@/domain/validation/schemas";
import { firstValidationError } from "@/lib/action-errors";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optional(formData: FormData, name: string): string | undefined {
  return text(formData, name) || undefined;
}

function booleanValue(formData: FormData, name: string): boolean | undefined {
  const value = optional(formData, name);
  return value === "YES" ? true : value === "NO" ? false : undefined;
}

function integerValue(formData: FormData, name: string): number | undefined {
  const value = optional(formData, name);
  return value ? Number.parseInt(value, 10) : undefined;
}

function returnPath(formData: FormData, fallback: string): string {
  const path = text(formData, "returnPath");
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

function finish(path: string, kind: "error" | "message", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${kind}=${encodeURIComponent(message)}`);
}

async function saveReflection(formData:FormData,kind:"DAILY"|"WEEKLY"|"MONTHLY",path:string,period:string,values:object,message:string) {
  await requireUserId();
  try {await saveJournal(await getVerifiedBrowserContext(await createClient()),{kind,accountId:text(formData,"accountId"),period,
    operationId:text(formData,"operationId"),expectedVersion:text(formData,"expectedVersion"),values});}
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid journal values or period. Reload before retrying.");}
  revalidatePath(path.split("?")[0]);
  if(kind==="DAILY")revalidatePath("/calendar");
  finish(path,"message",message);
}
export async function saveDailyLog(formData: FormData): Promise<void> {
  await saveReflection(formData,"DAILY",returnPath(formData,"/journal/daily"),text(formData,"tradingDate"),{
    market_conditions:optional(formData,"marketConditions")??null,mental_state:optional(formData,"mentalState")??null,
    followed_daily_plan:booleanValue(formData,"followedDailyPlan")??null,hit_daily_loss_threshold:booleanValue(formData,"hitDailyLossThreshold")??null,
    stopped_when_required:booleanValue(formData,"stoppedWhenRequired")??null,daily_rating:integerValue(formData,"dailyRating")??null,
    lessons:optional(formData,"lessons")??null,notes:optional(formData,"notes")??null,
  },"Daily journal saved.");
}
export async function saveWeeklyReview(formData: FormData): Promise<void> {
  await saveReflection(formData,"WEEKLY",returnPath(formData,"/journal/weekly"),text(formData,"weekStart"),{
    what_worked:optional(formData,"whatWorked")??null,what_did_not:optional(formData,"whatDidNot")??null,
    change_next_week:optional(formData,"changeNextWeek")??null,behavior_to_stop:optional(formData,"behaviorToStop")??null,
    behavior_to_continue:optional(formData,"behaviorToContinue")??null,notes:optional(formData,"notes")??null,
  },"Weekly review saved.");
}
export async function saveMonthlyReview(formData: FormData): Promise<void> {
  await saveReflection(formData,"MONTHLY",returnPath(formData,"/journal/monthly"),text(formData,"month"),{
    what_worked:optional(formData,"whatWorked")??null,what_did_not:optional(formData,"whatDidNot")??null,
    lessons:optional(formData,"lessons")??null,focus_next_month:optional(formData,"focusNextMonth")??null,notes:optional(formData,"notes")??null,
  },"Monthly review saved.");
}

export async function createAccountAdjustment(formData: FormData): Promise<void> {
  await requireUserId();
  const supabase = await createClient();
  const accountId = text(formData, "accountId");
  const path = returnPath(formData, `/accounts/${accountId}`);
  const rawOccurredAt = text(formData, "occurredAt");
  const occurredAt = rawOccurredAt && !Number.isNaN(Date.parse(rawOccurredAt)) ? new Date(rawOccurredAt).toISOString() : "";
  const result = accountAdjustmentSchema.safeParse({
    accountId,
    type: text(formData, "type"),
    amount: text(formData, "amount"),
    occurredAt,
    notes: optional(formData, "notes"),
    isPerformanceNeutral: booleanValue(formData, "isPerformanceNeutral"),
    classificationReason: optional(formData, "classificationReason"),
  });
  if (!result.success) finish(path, "error", firstValidationError(result.error));
  const value = result.data;
  try { await writeAccountEvent(await getVerifiedBrowserContext(supabase),"ADJUSTMENT",{...value,operationId:text(formData,"operationId"),
    ...(value.type!=="OTHER"?{isPerformanceNeutral:true}: {})}); }
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid adjustment. Reload and check the values.");}
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/analytics", "layout");
  revalidatePath("/dashboard");
  finish(path, "message", "Account adjustment recorded.");
}

export async function classifyAccountAdjustment(formData: FormData): Promise<void> {
  await requireUserId();
  const supabase = await createClient();
  const accountId = text(formData, "accountId");
  const path = returnPath(formData, `/accounts/${accountId}`);
  const result = adjustmentClassificationSchema.safeParse({
    adjustmentId: text(formData, "adjustmentId"),
    isPerformanceNeutral: booleanValue(formData, "isPerformanceNeutral"),
    reason: text(formData, "reason"),
  });
  if (!result.success) finish(path, "error", firstValidationError(result.error));
  try {await writeAccountEvent(await getVerifiedBrowserContext(supabase),"CLASSIFY",{operationId:text(formData,"operationId"),id:result.data.adjustmentId,
    expectedVersion:text(formData,"expectedVersion"),isPerformanceNeutral:result.data.isPerformanceNeutral,reason:result.data.reason});}
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid classification. Reload and check the values.");}
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/analytics", "layout");
  revalidatePath("/dashboard");
  finish(path, "message", "Adjustment performance classification updated.");
}

export async function saveTag(formData: FormData): Promise<void> {
  await requireUserId();
  const supabase = await createClient();
  const path = returnPath(formData, "/trades");
  const result = tagSchema.safeParse({ id: optional(formData, "id"), name: text(formData, "name"), color: optional(formData, "color") });
  if (!result.success) finish(path, "error", firstValidationError(result.error));
  try {await writeReference(await getVerifiedBrowserContext(supabase),result.data.id?"PATCH":"CREATE",{
    entity:"TAG",operationId:text(formData,"operationId"),...(result.data.id?{id:result.data.id,expectedVersion:text(formData,"expectedVersion")}:{}),
    values:{name:result.data.name,color:result.data.color??null},
  });} catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid tag values. Reload before retrying.");}
  revalidatePath("/trades");
  finish(path, "message", result.data.id ? "Tag updated." : "Tag created.");
}

async function changeTradeTag(formData:FormData,action:"ASSIGN"|"REMOVE") {
  await requireUserId();
  const supabase = await createClient();
  const tradeId = text(formData, "tradeId");
  const [tagId,selectedVersion] = text(formData, "tagId").split(":");
  const path = returnPath(formData, `/trades/${tradeId}`);
  try {await writeTradeTag(await getVerifiedBrowserContext(supabase),action,{tradeId,tagId,operationId:text(formData,"operationId"),
    expectedVersion:text(formData,"expectedVersion"),expectedTagVersion:text(formData,"expectedTagVersion")||selectedVersion});}
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid tag assignment. Reload before retrying.");}
  revalidatePath("/trades");
  revalidatePath(`/trades/${tradeId}`);
  finish(path, "message",action==="ASSIGN"?"Tag assigned.":"Tag removed from trade.");
}

export async function assignTag(formData: FormData): Promise<void> {await changeTradeTag(formData,"ASSIGN");}
export async function removeTag(formData: FormData): Promise<void> {
  await changeTradeTag(formData,"REMOVE");
}
