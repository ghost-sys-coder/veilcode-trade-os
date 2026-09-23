import type {
  InstrumentRow,
  SetupRow,
  StrategyRow,
  TradeExecutionReviewRow,
  TradePlanCorrectionRow,
  TradePsychologyRow,
  TradeReviewRow,
  TradeRow,
  TradeRuleResultRow,
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
  screenshots: TradeScreenshotRow[];
  corrections: TradePlanCorrectionRow[];
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
