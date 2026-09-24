"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import { decimalStringSchema } from "@/domain/validation/schemas";
import { firstValidationError } from "@/lib/action-errors";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ACCOUNT_FAILURE_REASONS,
  ACCOUNT_PLATFORMS,
  ACCOUNT_STATUSES,
  GOAL_TYPES,
  PROP_CONSISTENCY_FORMULAS,
  PROP_DAILY_BASELINES,
  PROP_DRAWDOWN_TYPES,
  PROP_LOSS_MEASURES,
  PROP_TOTAL_BASELINES,
  PROP_VALUE_MODES,
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
const optionalInteger = z.preprocess((item) => item === "" ? undefined : item, z.coerce.number().int().min(0).optional());

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

const configSchema = z.object({
  accountId: z.string().uuid(), firmName: z.string().trim().min(2).max(120), modelName: z.string().trim().max(120).optional(),
  phaseName: z.string().trim().max(120).optional(), profitTargetMode: z.enum(PROP_VALUE_MODES).optional(), profitTargetValue: optionalDecimal,
  dailyLossMode: z.enum(PROP_VALUE_MODES).optional(), dailyLossValue: optionalDecimal, dailyLossBaseline: z.enum(PROP_DAILY_BASELINES).optional(), dailyLossMeasure: z.enum(PROP_LOSS_MEASURES).optional(),
  totalLossMode: z.enum(PROP_VALUE_MODES).optional(), totalLossValue: optionalDecimal, totalLossBaseline: z.enum(PROP_TOTAL_BASELINES).optional(), totalLossMeasure: z.enum(PROP_LOSS_MEASURES).optional(),
  drawdownType: z.enum(PROP_DRAWDOWN_TYPES), consistencyFormula: z.enum(PROP_CONSISTENCY_FORMULAS).optional(), consistencyLimitPercent: optionalDecimal,
  minimumTradingDays: optionalInteger, maximumTradingDays: optionalInteger, tradingDayTimezone: z.string().trim().min(1).max(100).refine(validTimezone, "Enter a valid IANA timezone, such as Africa/Kampala or UTC."), profitableDayMinPnl: decimalStringSchema,
  notes: z.string().trim().max(4000).optional(),
}).superRefine((item, context) => {
  const groups = [
    [item.profitTargetMode, item.profitTargetValue, "profitTargetValue"],
    [item.dailyLossMode, item.dailyLossValue, "dailyLossValue", item.dailyLossBaseline, item.dailyLossMeasure],
    [item.totalLossMode, item.totalLossValue, "totalLossValue", item.totalLossBaseline, item.totalLossMeasure],
    [item.consistencyFormula, item.consistencyLimitPercent, "consistencyLimitPercent"],
  ] as const;
  for (const group of groups) {
    const fields = group.filter((_, index) => index !== 2);
    if (fields.some(Boolean) && !fields.every(Boolean)) context.addIssue({ code: "custom", path: [group[2]], message: "Complete every field in this optional rule, or leave the whole rule blank." });
  }
});

export async function savePropConfig(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/prop");
  const parsed = configSchema.safeParse({
    accountId: value(formData, "accountId"), firmName: value(formData, "firmName"), modelName: optional(formData, "modelName"), phaseName: optional(formData, "phaseName"),
    profitTargetMode: optional(formData, "profitTargetMode"), profitTargetValue: value(formData, "profitTargetValue"),
    dailyLossMode: optional(formData, "dailyLossMode"), dailyLossValue: value(formData, "dailyLossValue"), dailyLossBaseline: optional(formData, "dailyLossBaseline"), dailyLossMeasure: optional(formData, "dailyLossMeasure"),
    totalLossMode: optional(formData, "totalLossMode"), totalLossValue: value(formData, "totalLossValue"), totalLossBaseline: optional(formData, "totalLossBaseline"), totalLossMeasure: optional(formData, "totalLossMeasure"),
    drawdownType: value(formData, "drawdownType"), consistencyFormula: optional(formData, "consistencyFormula"), consistencyLimitPercent: value(formData, "consistencyLimitPercent"),
    minimumTradingDays: value(formData, "minimumTradingDays"), maximumTradingDays: value(formData, "maximumTradingDays"), tradingDayTimezone: value(formData, "tradingDayTimezone"),
    profitableDayMinPnl: value(formData, "profitableDayMinPnl"), notes: optional(formData, "notes"),
  });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  const userId = await requireUserId();
  const supabase = await createClient();
  const item = parsed.data;
  const { error } = await supabase.from("prop_firm_configs").upsert({
    user_id: userId, account_id: item.accountId, firm_name: item.firmName, model_name: item.modelName ?? null, phase_name: item.phaseName ?? null,
    profit_target_mode: item.profitTargetMode ?? null, profit_target_value: item.profitTargetValue ?? null,
    daily_loss_mode: item.dailyLossMode ?? null, daily_loss_value: item.dailyLossValue ?? null, daily_loss_baseline: item.dailyLossBaseline ?? null, daily_loss_measure: item.dailyLossMeasure ?? null,
    total_loss_mode: item.totalLossMode ?? null, total_loss_value: item.totalLossValue ?? null, total_loss_baseline: item.totalLossBaseline ?? null, total_loss_measure: item.totalLossMeasure ?? null,
    drawdown_type: item.drawdownType, consistency_formula: item.consistencyFormula ?? null, consistency_limit_percent: item.consistencyLimitPercent ?? null,
    minimum_trading_days: item.minimumTradingDays ?? null, maximum_trading_days: item.maximumTradingDays ?? null,
    trading_day_timezone: item.tradingDayTimezone, profitable_day_min_pnl: item.profitableDayMinPnl, notes: item.notes ?? null,
  }, { onConflict: "account_id" });
  if (error) finish(path, "error", error.message);
  revalidatePath("/prop");
  finish(path, "message", "Prop rules saved.");
}

export async function recordAccountSnapshot(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/prop");
  const schema = z.object({ accountId: z.string().uuid(), balance: decimalStringSchema, equity: optionalDecimal, unrealizedPnl: optionalDecimal, capturedAt: z.string().min(1), notes: z.string().trim().max(1000).optional() });
  const parsed = schema.safeParse({ accountId: value(formData, "accountId"), balance: value(formData, "balance"), equity: value(formData, "equity"), unrealizedPnl: value(formData, "unrealizedPnl"), capturedAt: value(formData, "capturedAt"), notes: optional(formData, "notes") });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  if (!parsed.data.equity && !parsed.data.unrealizedPnl) finish(path, "error", "Enter either equity or unrealized PnL.");
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data: account, error: accountError } = await supabase.from("trading_accounts").select("currency_precision").eq("id", parsed.data.accountId).eq("user_id", userId).maybeSingle();
  if (accountError || !account) finish(path, "error", accountError?.message ?? "Account not found.");
  const balance = normalizeMoney(parsed.data.balance, account.currency_precision);
  const equity = normalizeMoney(parsed.data.equity ?? parseDecimal(balance).plus(parsed.data.unrealizedPnl!), account.currency_precision);
  const unrealized = normalizeMoney(parseDecimal(equity).minus(balance), account.currency_precision);
  if (parsed.data.unrealizedPnl && normalizeMoney(parsed.data.unrealizedPnl, account.currency_precision) !== unrealized) finish(path, "error", "Equity must equal balance plus unrealized PnL.");
  const { error } = await supabase.from("account_snapshots").insert({ user_id: userId, account_id: parsed.data.accountId, captured_at: new Date(parsed.data.capturedAt).toISOString(), balance, equity, unrealized_pnl: unrealized, notes: parsed.data.notes ?? null });
  if (error) finish(path, "error", error.message);
  revalidatePath("/prop"); revalidatePath(`/accounts/${parsed.data.accountId}`);
  finish(path, "message", "Account snapshot recorded.");
}

export async function createGoal(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/goals");
  const schema = z.object({ accountId: z.string().uuid(), title: z.string().trim().min(2).max(120), goalType: z.enum(GOAL_TYPES), targetValue: decimalStringSchema, targetDate: z.string().optional(), customUnit: z.string().trim().max(40).optional(), notes: z.string().trim().max(1000).optional() }).superRefine((item, context) => {
    if (item.goalType === "CUSTOM" && !item.customUnit) context.addIssue({ code: "custom", path: ["customUnit"], message: "Custom goals require a unit." });
  });
  const parsed = schema.safeParse({ accountId: value(formData, "accountId"), title: value(formData, "title"), goalType: value(formData, "goalType"), targetValue: value(formData, "targetValue"), targetDate: optional(formData, "targetDate"), customUnit: optional(formData, "customUnit"), notes: optional(formData, "notes") });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  const userId = await requireUserId(); const supabase = await createClient(); const item = parsed.data;
  const { error } = await supabase.from("account_goals").insert({ user_id: userId, account_id: item.accountId, title: item.title, goal_type: item.goalType, target_value: item.targetValue, target_date: item.targetDate ?? null, custom_unit: item.goalType === "CUSTOM" ? item.customUnit ?? null : null, notes: item.notes ?? null });
  if (error) finish(path, "error", error.message);
  revalidatePath("/goals"); finish(path, "message", "Goal created.");
}

export async function recordCustomGoalProgress(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/goals");
  const parsed = z.object({ goalId: z.string().uuid(), progressValue: decimalStringSchema, recordedAt: z.string().min(1), notes: z.string().trim().max(1000).optional() }).safeParse({ goalId: value(formData, "goalId"), progressValue: value(formData, "progressValue"), recordedAt: value(formData, "recordedAt"), notes: optional(formData, "notes") });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  const userId = await requireUserId(); const supabase = await createClient();
  const { error } = await supabase.from("account_goal_progress_events").insert({ user_id: userId, goal_id: parsed.data.goalId, progress_value: parsed.data.progressValue, recorded_at: new Date(parsed.data.recordedAt).toISOString(), notes: parsed.data.notes ?? null });
  if (error) finish(path, "error", error.message);
  revalidatePath("/goals"); finish(path, "message", "Custom progress recorded.");
}

export async function transitionAccountStatus(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/prop");
  const parsed = z.object({ accountId: z.string().uuid(), status: z.enum(ACCOUNT_STATUSES), effectiveAt: z.string().min(1), failureReason: z.enum(ACCOUNT_FAILURE_REASONS).optional(), notes: z.string().trim().max(2000).optional() }).safeParse({ accountId: value(formData, "accountId"), status: value(formData, "status"), effectiveAt: value(formData, "effectiveAt"), failureReason: optional(formData, "failureReason"), notes: optional(formData, "notes") });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  if (parsed.data.status === "FAILED" && !parsed.data.failureReason) finish(path, "error", "A failure reason is required.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_account_status", { p_account_id: parsed.data.accountId, p_new_status: parsed.data.status, p_effective_at: new Date(parsed.data.effectiveAt).toISOString(), p_failure_reason: parsed.data.status === "FAILED" ? parsed.data.failureReason : null, p_notes: parsed.data.notes ?? null });
  if (error) finish(path, "error", error.message);
  revalidatePath("/prop"); revalidatePath("/accounts"); revalidatePath(`/accounts/${parsed.data.accountId}`);
  finish(path, "message", `Account marked ${parsed.data.status.toLowerCase()}.`);
}

export async function createLinkedFundedAccount(formData: FormData): Promise<void> {
  const path = pathFor(formData, "/prop");
  const parsed = z.object({ challengeId: z.string().uuid(), name: z.string().trim().min(2).max(80), startingBalance: decimalStringSchema, platform: z.enum(ACCOUNT_PLATFORMS), startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse({ challengeId: value(formData, "challengeId"), name: value(formData, "name"), startingBalance: value(formData, "startingBalance"), platform: value(formData, "platform"), startedAt: value(formData, "startedAt") });
  if (!parsed.success) finish(path, "error", firstValidationError(parsed.error));
  const userId = await requireUserId(); const supabase = await createClient();
  const { data: challenge, error: challengeError } = await supabase.from("trading_accounts").select("*").eq("id", parsed.data.challengeId).eq("user_id", userId).eq("account_type", "PROP_CHALLENGE").eq("status", "PASSED").maybeSingle();
  if (challengeError || !challenge) finish(path, "error", challengeError?.message ?? "Only a passed challenge can create a linked funded account.");
  const { error } = await supabase.from("trading_accounts").insert({ user_id: userId, name: parsed.data.name, account_type: "FUNDED", broker_name: challenge.broker_name, platform: parsed.data.platform, currency_code: challenge.currency_code, currency_precision: challenge.currency_precision, starting_balance: normalizeMoney(parsed.data.startingBalance, challenge.currency_precision), leverage: challenge.leverage, started_at: parsed.data.startedAt, status: "ACTIVE", previous_account_id: challenge.id, notes: `Linked from passed challenge: ${challenge.name}` });
  if (error) finish(path, "error", error.message);
  revalidatePath("/prop"); revalidatePath("/accounts");
  finish(path, "message", "Linked funded account created. The challenge history remains separate.");
}
