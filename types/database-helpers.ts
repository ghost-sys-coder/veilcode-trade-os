import type { Database } from "@/types/database";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type TradingAccountRow = Database["public"]["Tables"]["trading_accounts"]["Row"];
export type StrategyRow = Database["public"]["Tables"]["strategies"]["Row"];
export type SetupRow = Database["public"]["Tables"]["setups"]["Row"];
export type TradingRuleRow = Database["public"]["Tables"]["trading_rules"]["Row"];
export type TradeRow = Database["public"]["Tables"]["trades"]["Row"];
export type InstrumentRow = Database["public"]["Tables"]["instruments"]["Row"];
export type TradeTargetRow = Database["public"]["Tables"]["trade_targets"]["Row"];
export type TradeExecutionReviewRow = Database["public"]["Tables"]["trade_execution_reviews"]["Row"];
export type TradePsychologyRow = Database["public"]["Tables"]["trade_psychology"]["Row"];
export type TradeReviewRow = Database["public"]["Tables"]["trade_reviews"]["Row"];
export type TradeRuleResultRow = Database["public"]["Tables"]["trade_rule_results"]["Row"];
export type TradeScreenshotRow = Database["public"]["Tables"]["trade_screenshots"]["Row"];
export type TradePlanCorrectionRow = Database["public"]["Tables"]["trade_plan_corrections"]["Row"];
export type TradeManagementEventRow = Database["public"]["Tables"]["trade_management_events"]["Row"];
export type AccountAdjustmentRow = Database["public"]["Tables"]["account_adjustments"]["Row"];
