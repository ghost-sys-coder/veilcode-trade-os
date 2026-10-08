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

export interface TradeFormAccount extends Omit<TradingAccountRow,"record_version"> {
  record_version: string;
  derived_balance: string;
}

export interface ManualTradeRecord {
  recordVersion: string;
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
  operationId: string;
  correctionOperationId: string;
  managementOperationId: string;
  accounts: TradeFormAccount[];
  instruments: InstrumentRow[];
  strategies: StrategyRow[];
  setups: SetupRow[];
  rules: TradingRuleRow[];
  record?: ManualTradeRecord;
  userId: string;
  timezone: string;
  initialValues?: TradeFormInitialValues;
  calculatorTransfer?: boolean;
}

export interface TradeFormInitialValues {
  accountId: string;
  instrumentId: string;
  direction: "BUY" | "SELL";
  plannedEntry: string;
  plannedStopLoss: string;
  plannedTakeProfit?: string;
  plannedLotSize: string;
  plannedRiskAmount: string;
  plannedRewardAmount?: string;
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
