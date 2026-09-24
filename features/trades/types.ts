import type {
  InstrumentRow,
  SetupRow,
  StrategyRow,
  TradeExecutionReviewRow,
  TradeManagementEventRow,
  TradePlanCorrectionRow,
  TradePsychologyRow,
  TradeReviewRow,
  TradeRow,
  TradeRuleResultRow,
  TradeRuleReviewItemRow,
  TradeRuleReviewRow,
  TradeScreenshotRow,
  TradeTargetRow,
  TradingAccountRow,
  TradingRuleRow,
} from "@/types/database-helpers";

export interface TradeFormAccount extends TradingAccountRow {
  derived_balance: string;
}

export interface ManualTradeRecord {
  trade: TradeRow;
  targets: TradeTargetRow[];
  executionReview: TradeExecutionReviewRow | null;
  psychology: TradePsychologyRow | null;
  review: TradeReviewRow | null;
  ruleResults: TradeRuleResultRow[];
  ruleReview: TradeRuleReviewRow | null;
  ruleReviewItems: TradeRuleReviewItemRow[];
  screenshots: TradeScreenshotRow[];
  corrections: TradePlanCorrectionRow[];
  managementEvents: TradeManagementEventRow[];
}

export interface TradeFormProps {
  accounts: TradeFormAccount[];
  instruments: InstrumentRow[];
  strategies: StrategyRow[];
  setups: SetupRow[];
  rules: TradingRuleRow[];
  record?: ManualTradeRecord;
  userId: string;
  timezone: string;
}

export interface CalculationPreview {
  riskPercentage: string | null;
  plannedRiskReward: string | null;
  netPnl: string | null;
  actualR: string | null;
  outcome: string | null;
  holdingDurationSeconds: number | null;
  stopDistance: string | null;
}
