import type { SupabaseClient } from "@supabase/supabase-js";

import { getAccountsWithDerivedBalances } from "@/services/accounts/get-account-balances";
import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import type { Database } from "@/types/database";
import type { ManualTradeRecord } from "@/features/trades/types";

function normalizeNullableNumeric(value: unknown): string | null {
  return value === null || value === undefined ? null : normalizeSupabaseNumeric(value);
}

export async function getTradeFormReferences(supabase: SupabaseClient<Database>) {
  const [accountsResult, instrumentsResult, strategiesResult, setupsResult, rulesResult, profileResult] = await Promise.all([
    supabase.from("trading_accounts").select("*").order("name"),
    supabase.from("instruments").select("*").eq("active", true).order("symbol"),
    supabase.from("strategies").select("*").order("name"),
    supabase.from("setups").select("*").order("name"),
    supabase.from("trading_rules").select("*").order("name"),
    supabase.from("profiles").select("timezone").maybeSingle(),
  ]);
  const error = accountsResult.error ?? instrumentsResult.error ?? strategiesResult.error ?? setupsResult.error ?? rulesResult.error ?? profileResult.error;
  if (error) throw new Error(error.message);

  return {
    accounts: await getAccountsWithDerivedBalances(supabase, accountsResult.data ?? []),
    instruments: (instrumentsResult.data ?? []).map((instrument) => ({
      ...instrument,
      pip_size: instrument.pip_size === null ? null : normalizeSupabaseNumeric(instrument.pip_size),
    })),
    strategies: strategiesResult.data ?? [],
    setups: setupsResult.data ?? [],
    rules: rulesResult.data ?? [],
    timezone: profileResult.data?.timezone ?? "Africa/Kampala",
  };
}

export async function getManualTradeRecord(supabase: SupabaseClient<Database>, tradeId: string, userId: string): Promise<ManualTradeRecord | null> {
  const tradeResult = await supabase.from("trades").select("*").eq("id", tradeId).eq("user_id", userId).maybeSingle();
  if (tradeResult.error) throw new Error(tradeResult.error.message);
  if (!tradeResult.data) return null;

  const [targets, execution, psychology, review, ruleResults, ruleReview, screenshots, corrections, managementEvents] = await Promise.all([
    supabase.from("trade_targets").select("*").eq("trade_id", tradeId).order("created_at"),
    supabase.from("trade_execution_reviews").select("*").eq("trade_id", tradeId).maybeSingle(),
    supabase.from("trade_psychology").select("*").eq("trade_id", tradeId).maybeSingle(),
    supabase.from("trade_reviews").select("*").eq("trade_id", tradeId).maybeSingle(),
    supabase.from("trade_rule_results").select("*").eq("trade_id", tradeId),
    supabase.from("trade_rule_reviews").select("*").eq("trade_id", tradeId).maybeSingle(),
    supabase.from("trade_screenshots").select("*").eq("trade_id", tradeId).order("created_at"),
    supabase.from("trade_plan_corrections").select("*").eq("trade_id", tradeId).order("created_at"),
    supabase.from("trade_management_events").select("*").eq("trade_id", tradeId).order("occurred_at"),
  ]);
  const error = targets.error ?? execution.error ?? psychology.error ?? review.error ?? ruleResults.error ?? ruleReview.error ?? screenshots.error ?? corrections.error ?? managementEvents.error;
  if (error) throw new Error(error.message);

  const ruleReviewItems = ruleReview.data
    ? await supabase.from("trade_rule_review_items").select("*").eq("review_id", ruleReview.data.id).order("display_order")
    : { data: [], error: null };
  if (ruleReviewItems.error) throw new Error(ruleReviewItems.error.message);

  const trade = tradeResult.data;

  return {
    trade: {
      ...trade,
      account_balance_before: normalizeNullableNumeric(trade.account_balance_before),
      planned_entry: normalizeNullableNumeric(trade.planned_entry),
      planned_stop_loss: normalizeNullableNumeric(trade.planned_stop_loss),
      planned_take_profit: normalizeNullableNumeric(trade.planned_take_profit),
      planned_risk_amount: normalizeNullableNumeric(trade.planned_risk_amount),
      planned_risk_percentage: normalizeNullableNumeric(trade.planned_risk_percentage),
      planned_reward_amount: normalizeNullableNumeric(trade.planned_reward_amount),
      planned_risk_reward: normalizeNullableNumeric(trade.planned_risk_reward),
      planned_lot_size: normalizeNullableNumeric(trade.planned_lot_size),
      actual_entry: normalizeNullableNumeric(trade.actual_entry),
      actual_stop_loss: normalizeNullableNumeric(trade.actual_stop_loss),
      actual_exit: normalizeNullableNumeric(trade.actual_exit),
      actual_lot_size: normalizeNullableNumeric(trade.actual_lot_size),
      commission: normalizeSupabaseNumeric(trade.commission),
      swap: normalizeSupabaseNumeric(trade.swap),
      other_fees: normalizeSupabaseNumeric(trade.other_fees),
      gross_pnl: normalizeNullableNumeric(trade.gross_pnl),
      net_pnl: normalizeNullableNumeric(trade.net_pnl),
      pips_result: normalizeNullableNumeric(trade.pips_result),
      actual_r: normalizeNullableNumeric(trade.actual_r),
      mfe_amount: normalizeNullableNumeric(trade.mfe_amount),
      mfe_pips: normalizeNullableNumeric(trade.mfe_pips),
      mfe_r: normalizeNullableNumeric(trade.mfe_r),
      mae_amount: normalizeNullableNumeric(trade.mae_amount),
      mae_pips: normalizeNullableNumeric(trade.mae_pips),
      mae_r: normalizeNullableNumeric(trade.mae_r),
    },
    targets: (targets.data ?? []).map((target) => ({
      ...target,
      planned_price: normalizeSupabaseNumeric(target.planned_price),
      actual_fill_price: normalizeNullableNumeric(target.actual_fill_price),
      planned_close_percentage: normalizeNullableNumeric(target.planned_close_percentage),
      actual_close_percentage: normalizeNullableNumeric(target.actual_close_percentage),
      pnl_contribution: normalizeNullableNumeric(target.pnl_contribution),
    })),
    executionReview: execution.data,
    psychology: psychology.data,
    review: review.data,
    ruleResults: ruleResults.data ?? [],
    ruleReview: ruleReview.data,
    ruleReviewItems: ruleReviewItems.data ?? [],
    screenshots: screenshots.data ?? [],
    corrections: corrections.data ?? [],
    managementEvents: (managementEvents.data ?? []).map((event) => ({
      ...event,
      price: normalizeNullableNumeric(event.price),
      volume: normalizeNullableNumeric(event.volume),
    })),
  };
}
