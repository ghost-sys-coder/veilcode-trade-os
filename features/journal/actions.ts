"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { normalizeAdjustmentAmount } from "@/domain/journal/analytics";
import { normalizeMoney } from "@/domain/money/decimal";
import {
  accountAdjustmentSchema,
  dailyLogSchema,
  monthlyReviewSchema,
  tagSchema,
  weeklyReviewSchema,
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

export async function saveDailyLog(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const path = returnPath(formData, "/journal/daily");
  const result = dailyLogSchema.safeParse({
    accountId: text(formData, "accountId"),
    tradingDate: text(formData, "tradingDate"),
    marketConditions: optional(formData, "marketConditions"),
    mentalState: optional(formData, "mentalState"),
    followedDailyPlan: booleanValue(formData, "followedDailyPlan"),
    hitDailyLossThreshold: booleanValue(formData, "hitDailyLossThreshold"),
    stoppedWhenRequired: booleanValue(formData, "stoppedWhenRequired"),
    dailyRating: integerValue(formData, "dailyRating"),
    lessons: optional(formData, "lessons"),
    notes: optional(formData, "notes"),
  });
  if (!result.success) finish(path, "error", firstValidationError(result.error));
  const value = result.data;
  const { error } = await supabase.from("daily_logs").upsert({
    user_id: userId,
    account_id: value.accountId,
    trading_date: value.tradingDate,
    market_conditions: value.marketConditions ?? null,
    mental_state: value.mentalState ?? null,
    followed_daily_plan: value.followedDailyPlan ?? null,
    hit_daily_loss_threshold: value.hitDailyLossThreshold ?? null,
    stopped_when_required: value.stoppedWhenRequired ?? null,
    daily_rating: value.dailyRating ?? null,
    lessons: value.lessons ?? null,
    notes: value.notes ?? null,
  }, { onConflict: "account_id,trading_date" });
  if (error) finish(path, "error", error.message);
  revalidatePath("/journal/daily");
  revalidatePath("/calendar");
  finish(path, "message", "Daily journal saved.");
}

export async function saveWeeklyReview(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const path = returnPath(formData, "/journal/weekly");
  const result = weeklyReviewSchema.safeParse({
    accountId: text(formData, "accountId"),
    weekStart: text(formData, "weekStart"),
    whatWorked: optional(formData, "whatWorked"),
    whatDidNot: optional(formData, "whatDidNot"),
    changeNextWeek: optional(formData, "changeNextWeek"),
    behaviorToStop: optional(formData, "behaviorToStop"),
    behaviorToContinue: optional(formData, "behaviorToContinue"),
    notes: optional(formData, "notes"),
  });
  if (!result.success) finish(path, "error", firstValidationError(result.error));
  const value = result.data;
  const { error } = await supabase.from("weekly_reviews").upsert({
    user_id: userId,
    account_id: value.accountId,
    week_start: value.weekStart,
    what_worked: value.whatWorked ?? null,
    what_did_not: value.whatDidNot ?? null,
    change_next_week: value.changeNextWeek ?? null,
    behavior_to_stop: value.behaviorToStop ?? null,
    behavior_to_continue: value.behaviorToContinue ?? null,
    notes: value.notes ?? null,
  }, { onConflict: "account_id,week_start" });
  if (error) finish(path, "error", error.message);
  revalidatePath("/journal/weekly");
  finish(path, "message", "Weekly review saved.");
}

export async function saveMonthlyReview(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const path = returnPath(formData, "/journal/monthly");
  const result = monthlyReviewSchema.safeParse({
    accountId: text(formData, "accountId"),
    month: text(formData, "month"),
    whatWorked: optional(formData, "whatWorked"),
    whatDidNot: optional(formData, "whatDidNot"),
    lessons: optional(formData, "lessons"),
    focusNextMonth: optional(formData, "focusNextMonth"),
    notes: optional(formData, "notes"),
  });
  if (!result.success) finish(path, "error", firstValidationError(result.error));
  const value = result.data;
  const { error } = await supabase.from("monthly_reviews").upsert({
    user_id: userId,
    account_id: value.accountId,
    month: value.month,
    what_worked: value.whatWorked ?? null,
    what_did_not: value.whatDidNot ?? null,
    lessons: value.lessons ?? null,
    focus_next_month: value.focusNextMonth ?? null,
    notes: value.notes ?? null,
  }, { onConflict: "account_id,month" });
  if (error) finish(path, "error", error.message);
  revalidatePath("/journal/monthly");
  finish(path, "message", "Monthly review saved.");
}

export async function createAccountAdjustment(formData: FormData): Promise<void> {
  const userId = await requireUserId();
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
  });
  if (!result.success) finish(path, "error", firstValidationError(result.error));
  const value = result.data;
  const { data: account, error: accountError } = await supabase.from("trading_accounts").select("currency_precision").eq("id", value.accountId).eq("user_id", userId).maybeSingle();
  if (accountError || !account) finish(path, "error", accountError?.message ?? "Account not found.");
  const amount = normalizeMoney(normalizeAdjustmentAmount(value.type, value.amount), account.currency_precision);
  const { error } = await supabase.from("account_adjustments").insert({
    user_id: userId,
    account_id: value.accountId,
    type: value.type,
    amount,
    occurred_at: value.occurredAt,
    notes: value.notes ?? null,
  });
  if (error) finish(path, "error", error.message);
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  finish(path, "message", "Account adjustment recorded.");
}

export async function saveTag(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const path = returnPath(formData, "/trades");
  const result = tagSchema.safeParse({ id: optional(formData, "id"), name: text(formData, "name"), color: optional(formData, "color") });
  if (!result.success) finish(path, "error", firstValidationError(result.error));
  const payload = { user_id: userId, name: result.data.name, color: result.data.color ?? null };
  const mutation = result.data.id
    ? supabase.from("tags").update(payload).eq("id", result.data.id).eq("user_id", userId)
    : supabase.from("tags").insert(payload);
  const { error } = await mutation;
  if (error) finish(path, "error", error.code === "23505" ? "A tag with that name already exists." : error.message);
  revalidatePath("/trades");
  finish(path, "message", result.data.id ? "Tag updated." : "Tag created.");
}

export async function assignTag(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const tradeId = text(formData, "tradeId");
  const tagId = text(formData, "tagId");
  const path = returnPath(formData, `/trades/${tradeId}`);
  const { error } = await supabase.from("trade_tags").upsert({ user_id: userId, trade_id: tradeId, tag_id: tagId }, { onConflict: "trade_id,tag_id" });
  if (error) finish(path, "error", error.message);
  revalidatePath("/trades");
  revalidatePath(`/trades/${tradeId}`);
  finish(path, "message", "Tag assigned.");
}

export async function removeTag(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const tradeId = text(formData, "tradeId");
  const tagId = text(formData, "tagId");
  const path = returnPath(formData, `/trades/${tradeId}`);
  const { error } = await supabase.from("trade_tags").delete().eq("trade_id", tradeId).eq("tag_id", tagId).eq("user_id", userId);
  if (error) finish(path, "error", error.message);
  revalidatePath("/trades");
  revalidatePath(`/trades/${tradeId}`);
  finish(path, "message", "Tag removed from trade.");
}
