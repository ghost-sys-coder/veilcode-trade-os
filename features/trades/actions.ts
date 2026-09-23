"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseDecimal, sumDecimals } from "@/domain/money/decimal";
import {
  calculateHoldingDurationSeconds,
  calculateNetPnl,
  calculatePlannedRiskPercentage,
  calculateRiskMultiple,
  classifyClosedTradeOutcome,
} from "@/domain/trades/financials";
import {
  executionReviewSchema,
  psychologyReviewSchema,
  tradeRuleResultSchema,
  tradeReviewSchema,
  tradeSchema,
  tradeTargetSchema,
} from "@/domain/validation/schemas";
import { firstValidationError } from "@/lib/action-errors";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAccountsWithDerivedBalances } from "@/services/accounts/get-account-balances";
import type { Database } from "@/types/database";
import type { TradeStatus } from "@/types/domain";

type TradeInsert = Database["public"]["Tables"]["trades"]["Insert"];
type TradeUpdate = Database["public"]["Tables"]["trades"]["Update"];

function textValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, name: string): string | undefined {
  const value = textValue(formData, name);
  return value && value !== "UNSET" ? value : undefined;
}

function optionalInteger(formData: FormData, name: string): number | undefined {
  const value = optionalText(formData, name);
  return value ? Number.parseInt(value, 10) : undefined;
}

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function isoDateTime(formData: FormData, name: string): string | undefined {
  const value = optionalText(formData, name);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function targetInputs(formData: FormData) {
  const ids = formData.getAll("targetId").map(String);
  const labels = formData.getAll("targetLabel").map(String);
  const prices = formData.getAll("targetPlannedPrice").map(String);
  const plannedPercentages = formData.getAll("targetPlannedPercentage").map(String);
  const fillPrices = formData.getAll("targetActualFillPrice").map(String);
  const actualPercentages = formData.getAll("targetActualPercentage").map(String);
  const contributions = formData.getAll("targetPnlContribution").map(String);
  const hitTimes = formData.getAll("targetHitAt").map(String);

  return labels.map((label, index) => ({
    id: ids[index] || undefined,
    label: label.trim(),
    plannedPrice: prices[index]?.trim() ?? "",
    plannedClosePercentage: plannedPercentages[index]?.trim() || undefined,
    actualFillPrice: fillPrices[index]?.trim() || undefined,
    actualClosePercentage: actualPercentages[index]?.trim() || undefined,
    pnlContribution: contributions[index]?.trim() || undefined,
    hitAt: hitTimes[index]?.trim() ? new Date(hitTimes[index]).toISOString() : undefined,
  })).filter((target) => target.plannedPrice);
}

function redirectToForm(path: string, kind: "error" | "message", message: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

function allowedStatus(previousStatus: TradeStatus | undefined, requested: TradeStatus): boolean {
  if (previousStatus === "CLOSED") return requested === "CLOSED";
  if (previousStatus === "OPEN") return requested === "OPEN" || requested === "CLOSED";
  return true;
}

export async function saveManualTrade(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const tradeId = optionalText(formData, "id");
  const destination = tradeId ? `/trades/${tradeId}/edit` : "/trades/new";

  const currentResult = tradeId
    ? await supabase.from("trades").select("*").eq("id", tradeId).eq("user_id", userId).maybeSingle()
    : { data: null, error: null };

  if (currentResult.error) redirectToForm(destination, "error", currentResult.error.message);
  if (tradeId && !currentResult.data) redirectToForm("/trades/new", "error", "Trade not found or no longer available.");

  const current = currentResult.data;
  const requestedStatus = (textValue(formData, "intent") === "draft"
    ? "DRAFT"
    : textValue(formData, "status")) as TradeStatus;

  if (!allowedStatus(current?.status, requestedStatus)) {
    redirectToForm(destination, "error", "An open or closed trade cannot return to an earlier lifecycle state.");
  }

  const accountId = textValue(formData, "accountId");
  const { data: account, error: accountError } = await supabase
    .from("trading_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (accountError || !account) {
    redirectToForm(destination, "error", accountError?.message ?? "Choose an account you own.");
  }

  const derivedBalance = (await getAccountsWithDerivedBalances(supabase, [account]))[0].derived_balance;
  const submittedBalance = optionalText(formData, "accountBalanceBefore");
  const balance = current?.status === "OPEN" || current?.status === "CLOSED"
    ? current.account_balance_before ?? derivedBalance
    : submittedBalance ?? (current?.account_id === account.id ? current.account_balance_before : null) ?? derivedBalance;
  const targets = targetInputs(formData);
  const usedPartialExits = targets.some((target) => {
    if (!target.actualClosePercentage) return false;
    const percentage = parseDecimal(target.actualClosePercentage);
    return percentage.gt(0) && percentage.lt(100);
  });
  const commission = textValue(formData, "commission") || "0";
  const swap = textValue(formData, "swap") || "0";
  const otherFees = textValue(formData, "otherFees") || "0";
  const grossPnl = optionalText(formData, "grossPnl");
  const netPnl = grossPnl
    ? calculateNetPnl({ grossPnl, commission, swap, otherFees, currencyPrecision: account.currency_precision })
    : undefined;
  const riskAmount = optionalText(formData, "plannedRiskAmount");
  const rewardAmount = optionalText(formData, "plannedRewardAmount");
  const riskPercentage = riskAmount ? calculatePlannedRiskPercentage(riskAmount, balance) ?? undefined : undefined;
  const plannedRiskReward = riskAmount && rewardAmount ? calculateRiskMultiple(rewardAmount, riskAmount) ?? undefined : undefined;
  const actualR = netPnl && riskAmount ? calculateRiskMultiple(netPnl, riskAmount) ?? undefined : undefined;
  const openedAt = isoDateTime(formData, "openedAt");
  const closedAt = isoDateTime(formData, "closedAt");
  const holdingDuration = calculateHoldingDurationSeconds(openedAt, closedAt);
  const outcome = requestedStatus === "CLOSED" && netPnl
    ? classifyClosedTradeOutcome(netPnl, account.currency_precision, usedPartialExits)
    : undefined;

  if (requestedStatus === "CLOSED" && !grossPnl) {
    redirectToForm(destination, "error", "Closed trades require gross PnL so final net PnL can be derived.");
  }

  const lockedPlan = current?.status === "OPEN" || current?.status === "CLOSED";
  const deferFinalStatus = !lockedPlan && (requestedStatus === "OPEN" || requestedStatus === "CLOSED");
  const candidate = {
    id: tradeId,
    accountId,
    instrumentId: textValue(formData, "instrumentId"),
    strategyId: lockedPlan ? current.strategy_id ?? undefined : optionalText(formData, "strategyId"),
    setupId: lockedPlan ? current.setup_id ?? undefined : optionalText(formData, "setupId"),
    status: requestedStatus,
    outcome,
    sourceType: "MANUAL" as const,
    direction: textValue(formData, "direction"),
    orderType: textValue(formData, "orderType"),
    session: textValue(formData, "session"),
    primaryAnalysisTimeframe: optionalText(formData, "primaryAnalysisTimeframe"),
    entryTimeframe: optionalText(formData, "entryTimeframe"),
    higherTimeframeBias: optionalText(formData, "higherTimeframeBias"),
    marketCondition: optionalText(formData, "marketCondition"),
    thesis: lockedPlan ? current.thesis ?? undefined : optionalText(formData, "thesis"),
    entryReason: lockedPlan ? current.entry_reason ?? undefined : optionalText(formData, "entryReason"),
    confirmationNotes: lockedPlan ? current.confirmation_notes ?? undefined : optionalText(formData, "confirmationNotes"),
    plannedAt: isoDateTime(formData, "plannedAt"),
    openedAt,
    closedAt,
    accountBalanceBefore: balance,
    plannedEntry: lockedPlan ? current.planned_entry ?? undefined : optionalText(formData, "plannedEntry"),
    plannedStopLoss: lockedPlan ? current.planned_stop_loss ?? undefined : optionalText(formData, "plannedStopLoss"),
    plannedTakeProfit: lockedPlan ? current.planned_take_profit ?? undefined : optionalText(formData, "plannedTakeProfit"),
    plannedRiskAmount: lockedPlan ? current.planned_risk_amount ?? undefined : riskAmount,
    plannedRiskPercentage: lockedPlan ? current.planned_risk_percentage ?? undefined : riskPercentage,
    plannedRewardAmount: lockedPlan ? current.planned_reward_amount ?? undefined : rewardAmount,
    plannedRiskReward: lockedPlan ? current.planned_risk_reward ?? undefined : plannedRiskReward,
    plannedLotSize: lockedPlan ? current.planned_lot_size ?? undefined : optionalText(formData, "plannedLotSize"),
    actualEntry: optionalText(formData, "actualEntry"),
    actualStopLoss: optionalText(formData, "actualStopLoss"),
    actualExit: optionalText(formData, "actualExit"),
    actualLotSize: optionalText(formData, "actualLotSize"),
    commission,
    swap,
    otherFees,
    grossPnl,
    netPnl,
    currencyPrecision: account.currency_precision,
    usedPartialExits,
  };
  const validated = tradeSchema.safeParse(candidate);

  if (!validated.success) redirectToForm(destination, "error", firstValidationError(validated.error));

  const values = validated.data;
  const payload: TradeInsert | TradeUpdate = {
    user_id: userId,
    account_id: values.accountId,
    instrument_id: values.instrumentId,
    strategy_id: values.strategyId ?? null,
    setup_id: values.setupId ?? null,
    status: current ? (deferFinalStatus ? current.status : values.status) : "DRAFT",
    outcome: current && !deferFinalStatus ? values.outcome ?? null : null,
    source_type: "MANUAL",
    planned_at: values.plannedAt ?? null,
    opened_at: values.openedAt ?? null,
    closed_at: values.closedAt ?? null,
    timezone_at_entry: textValue(formData, "timezone") || "UTC",
    direction: values.direction,
    order_type: values.orderType,
    session: values.session,
    primary_analysis_timeframe: values.primaryAnalysisTimeframe ?? null,
    entry_timeframe: values.entryTimeframe ?? null,
    higher_timeframe_bias: values.higherTimeframeBias ?? null,
    market_condition: values.marketCondition ?? null,
    thesis: values.thesis ?? null,
    entry_reason: values.entryReason ?? null,
    confirmation_notes: values.confirmationNotes ?? null,
    account_balance_before: values.accountBalanceBefore ?? null,
    planned_entry: values.plannedEntry ?? null,
    planned_stop_loss: values.plannedStopLoss ?? null,
    planned_take_profit: values.plannedTakeProfit ?? null,
    planned_risk_amount: values.plannedRiskAmount ?? null,
    planned_risk_percentage: values.plannedRiskPercentage ?? null,
    planned_reward_amount: values.plannedRewardAmount ?? null,
    planned_risk_reward: values.plannedRiskReward ?? null,
    planned_lot_size: values.plannedLotSize ?? null,
    actual_entry: values.actualEntry ?? null,
    actual_stop_loss: values.actualStopLoss ?? null,
    actual_exit: values.actualExit ?? null,
    actual_lot_size: values.actualLotSize ?? null,
    commission: values.commission,
    swap: values.swap,
    other_fees: values.otherFees,
    gross_pnl: values.grossPnl ?? null,
    net_pnl: values.netPnl ?? null,
    pips_result: optionalText(formData, "pipsResult") ?? null,
    actual_r: actualR ?? null,
    mfe_amount: optionalText(formData, "mfeAmount") ?? null,
    mfe_pips: optionalText(formData, "mfePips") ?? null,
    mfe_r: optionalText(formData, "mfeR") ?? null,
    mae_amount: optionalText(formData, "maeAmount") ?? null,
    mae_pips: optionalText(formData, "maePips") ?? null,
    mae_r: optionalText(formData, "maeR") ?? null,
    holding_duration_seconds: holdingDuration,
  };

  let savedTradeId = tradeId;
  if (lockedPlan && current) {
    const executionTargets = targets.map((target) => {
      const result = tradeTargetSchema.safeParse({ ...target, tradeId: current.id });
      if (!result.success) redirectToForm(destination, "error", firstValidationError(result.error));
      if (!result.data.id) redirectToForm(destination, "error", "A saved target is missing its identifier.");
      return {
        id: result.data.id,
        actual_fill_price: result.data.actualFillPrice ?? null,
        actual_close_percentage: result.data.actualClosePercentage ?? null,
        pnl_contribution: result.data.pnlContribution ?? null,
        hit_at: target.hitAt ?? null,
      };
    });
    const actualTotal = sumDecimals(executionTargets.map((target) => target.actual_close_percentage ?? "0"));
    if (actualTotal.gt(100)) redirectToForm(destination, "error", "Actual target percentages cannot exceed 100%.");
    const { error } = await supabase.rpc("update_trade_target_execution", {
      p_trade_id: current.id,
      p_targets: executionTargets,
    });
    if (error) redirectToForm(destination, "error", error.message);
  }

  if (current) {
    if (lockedPlan) {
      delete payload.strategy_id;
      delete payload.setup_id;
      delete payload.thesis;
      delete payload.entry_reason;
      delete payload.confirmation_notes;
      delete payload.planned_entry;
      delete payload.planned_stop_loss;
      delete payload.planned_take_profit;
      delete payload.planned_risk_amount;
      delete payload.planned_risk_percentage;
      delete payload.planned_reward_amount;
      delete payload.planned_risk_reward;
      delete payload.planned_lot_size;
    }
    const { error } = await supabase.from("trades").update(payload).eq("id", current.id).eq("user_id", userId);
    if (error) redirectToForm(destination, "error", error.message);
  } else {
    const { data, error } = await supabase.from("trades").insert(payload as TradeInsert).select("id").single();
    if (error) redirectToForm(destination, "error", error.message);
    savedTradeId = data.id;
  }

  if (!savedTradeId) redirectToForm(destination, "error", "The trade could not be saved.");

  if (!lockedPlan) {
    const targetRows = targets.map((target) => {
      const result = tradeTargetSchema.safeParse({ ...target, tradeId: savedTradeId });
      if (!result.success) redirectToForm(`/trades/${savedTradeId}/edit`, "error", firstValidationError(result.error));
      return {
        label: result.data.label,
        planned_price: result.data.plannedPrice,
        planned_close_percentage: result.data.plannedClosePercentage ?? null,
        actual_fill_price: result.data.actualFillPrice ?? null,
        actual_close_percentage: result.data.actualClosePercentage ?? null,
        pnl_contribution: result.data.pnlContribution ?? null,
        hit_at: target.hitAt ?? null,
      };
    });
    const totalPercentage = sumDecimals(targetRows.map((target) => target.planned_close_percentage ?? "0"));
    if (totalPercentage.gt(100)) redirectToForm(`/trades/${savedTradeId}/edit`, "error", "Planned target percentages cannot exceed 100%.");
    const { error } = await supabase.rpc("replace_trade_targets", {
      p_trade_id: savedTradeId,
      p_targets: targetRows,
    });
    if (error) redirectToForm(`/trades/${savedTradeId}/edit`, "error", error.message);
  }

  const execution = executionReviewSchema.safeParse({
    tradeId: savedTradeId,
    entryAccordingToPlan: optionalText(formData, "entryAccordingToPlan") === "YES" ? true : optionalText(formData, "entryAccordingToPlan") === "NO" ? false : undefined,
    stopAccordingToPlan: optionalText(formData, "stopAccordingToPlan") === "YES" ? true : optionalText(formData, "stopAccordingToPlan") === "NO" ? false : undefined,
    targetAccordingToPlan: optionalText(formData, "targetAccordingToPlan") === "YES" ? true : optionalText(formData, "targetAccordingToPlan") === "NO" ? false : undefined,
    stopAction: optionalText(formData, "stopAction"),
    closedEarly: checked(formData, "closedEarly"),
    enteredEarly: checked(formData, "enteredEarly"),
    enteredLate: checked(formData, "enteredLate"),
    chasedPrice: checked(formData, "chasedPrice"),
    addedToPosition: checked(formData, "addedToPosition"),
    revengeTrade: checked(formData, "revengeTrade"),
    overRisked: checked(formData, "overRisked"),
    executionRating: optionalInteger(formData, "executionRating"),
    notes: optionalText(formData, "executionNotes"),
  });
  if (!execution.success) redirectToForm(`/trades/${savedTradeId}/edit`, "error", firstValidationError(execution.error));
  const { error: executionError } = await supabase.from("trade_execution_reviews").upsert({
    user_id: userId,
    trade_id: savedTradeId,
    entry_according_to_plan: execution.data.entryAccordingToPlan ?? null,
    stop_according_to_plan: execution.data.stopAccordingToPlan ?? null,
    target_according_to_plan: execution.data.targetAccordingToPlan ?? null,
    stop_action: execution.data.stopAction ?? null,
    closed_early: execution.data.closedEarly,
    entered_early: execution.data.enteredEarly,
    entered_late: execution.data.enteredLate,
    chased_price: execution.data.chasedPrice,
    added_to_position: execution.data.addedToPosition,
    revenge_trade: execution.data.revengeTrade,
    over_risked: execution.data.overRisked,
    execution_rating: execution.data.executionRating ?? null,
    notes: execution.data.notes ?? null,
  }, { onConflict: "trade_id" });
  if (executionError) redirectToForm(`/trades/${savedTradeId}/edit`, "error", executionError.message);

  const psychology = psychologyReviewSchema.safeParse({
    tradeId: savedTradeId,
    confidenceBeforeEntry: optionalInteger(formData, "confidenceBeforeEntry"),
    emotionBefore: optionalText(formData, "emotionBefore"),
    emotionDuring: optionalText(formData, "emotionDuring"),
    emotionAfter: optionalText(formData, "emotionAfter"),
    fearInfluenced: checked(formData, "fearInfluenced"),
    greedInfluenced: checked(formData, "greedInfluenced"),
    fomoInfluenced: checked(formData, "fomoInfluenced"),
    notes: optionalText(formData, "psychologyNotes"),
  });
  if (!psychology.success) redirectToForm(`/trades/${savedTradeId}/edit`, "error", firstValidationError(psychology.error));
  const { error: psychologyError } = await supabase.from("trade_psychology").upsert({
    user_id: userId,
    trade_id: savedTradeId,
    confidence_before_entry: psychology.data.confidenceBeforeEntry ?? null,
    emotion_before: psychology.data.emotionBefore ?? null,
    emotion_during: psychology.data.emotionDuring ?? null,
    emotion_after: psychology.data.emotionAfter ?? null,
    fear_influenced: psychology.data.fearInfluenced,
    greed_influenced: psychology.data.greedInfluenced,
    fomo_influenced: psychology.data.fomoInfluenced,
    notes: psychology.data.notes ?? null,
  }, { onConflict: "trade_id" });
  if (psychologyError) redirectToForm(`/trades/${savedTradeId}/edit`, "error", psychologyError.message);

  for (const [name, rawValue] of formData.entries()) {
    if (!name.startsWith("ruleResult:") || (rawValue !== "YES" && rawValue !== "NO")) continue;
    const ruleId = name.slice("ruleResult:".length);
    const ruleResult = tradeRuleResultSchema.safeParse({ tradeId: savedTradeId, tradingRuleId: ruleId, complied: rawValue === "YES", notes: optionalText(formData, `ruleNote:${ruleId}`) });
    if (!ruleResult.success) redirectToForm(`/trades/${savedTradeId}/edit`, "error", firstValidationError(ruleResult.error));
    const { error } = await supabase.from("trade_rule_results").upsert({
      user_id: userId,
      trade_id: savedTradeId,
      trading_rule_id: ruleResult.data.tradingRuleId,
      complied: ruleResult.data.complied,
      notes: ruleResult.data.notes ?? null,
    }, { onConflict: "trade_id,trading_rule_id" });
    if (error) redirectToForm(`/trades/${savedTradeId}/edit`, "error", error.message);
  }

  if (requestedStatus === "CLOSED") {
    const review = tradeReviewSchema.safeParse({
      tradeId: savedTradeId,
      whatWentWell: optionalText(formData, "whatWentWell"),
      whatWentWrong: optionalText(formData, "whatWentWrong"),
      wouldTakeAgain: optionalText(formData, "wouldTakeAgain"),
      improvement: optionalText(formData, "improvement"),
      lessonLearned: optionalText(formData, "lessonLearned"),
      tradeQualityGrade: optionalText(formData, "tradeQualityGrade"),
    });
    if (!review.success) redirectToForm(`/trades/${savedTradeId}/edit`, "error", firstValidationError(review.error));
    const { error } = await supabase.from("trade_reviews").upsert({
      user_id: userId,
      trade_id: savedTradeId,
      what_went_well: review.data.whatWentWell ?? null,
      what_went_wrong: review.data.whatWentWrong ?? null,
      would_take_again: review.data.wouldTakeAgain ?? null,
      improvement: review.data.improvement ?? null,
      lesson_learned: review.data.lessonLearned ?? null,
      trade_quality_grade: review.data.tradeQualityGrade ?? null,
      reviewed_at: new Date().toISOString(),
    }, { onConflict: "trade_id" });
    if (error) redirectToForm(`/trades/${savedTradeId}/edit`, "error", error.message);
  }

  if ((!current || deferFinalStatus) && requestedStatus !== "DRAFT") {
    const { error } = await supabase.from("trades").update({ status: requestedStatus, outcome: outcome ?? null }).eq("id", savedTradeId).eq("user_id", userId);
    if (error) redirectToForm(`/trades/${savedTradeId}/edit`, "error", error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/accounts");
  revalidatePath(`/trades/${savedTradeId}/edit`);
  redirectToForm(`/trades/${savedTradeId}/edit`, "message", requestedStatus === "DRAFT" ? "Draft saved." : "Trade saved.");
}

export async function correctTradePlanValue(tradeId: string, formData: FormData): Promise<void> {
  await requireUserId();
  const supabase = await createClient();
  const fieldName = textValue(formData, "fieldName");
  const rawValue = textValue(formData, "newValue");
  const reason = textValue(formData, "reason");
  const tradeTargetId = optionalText(formData, "tradeTargetId");

  const { error } = await supabase.rpc("correct_trade_plan_value", {
    p_trade_id: tradeId,
    p_field_name: fieldName,
    p_new_value: rawValue,
    p_reason: reason,
    p_trade_target_id: tradeTargetId ?? undefined,
  });

  if (error) redirectToForm(`/trades/${tradeId}/edit`, "error", error.message);

  revalidatePath(`/trades/${tradeId}/edit`);
  redirectToForm(`/trades/${tradeId}/edit`, "message", "Recorded plan value corrected with an audit entry.");
}
