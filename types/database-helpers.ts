import type { Database } from "@/types/database";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type TradingAccountRow = Database["public"]["Tables"]["trading_accounts"]["Row"];
export type StrategyRow = Database["public"]["Tables"]["strategies"]["Row"];
export type SetupRow = Database["public"]["Tables"]["setups"]["Row"];
export type TradingRuleRow = Database["public"]["Tables"]["trading_rules"]["Row"];
export type TradeRow = Database["public"]["Tables"]["trades"]["Row"];
export type AccountAdjustmentRow = Database["public"]["Tables"]["account_adjustments"]["Row"];
