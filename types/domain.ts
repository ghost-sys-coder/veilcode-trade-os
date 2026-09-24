export const ACCOUNT_TYPES = [
  "DEMO",
  "PROP_CHALLENGE",
  "FUNDED",
  "PERSONAL_LIVE",
] as const;

export const ACCOUNT_PLATFORMS = [
  "MT4",
  "MT5",
  "TRADINGVIEW",
  "WEB",
  "OTHER",
] as const;

export const ACCOUNT_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "PASSED",
  "FAILED",
  "CLOSED",
] as const;

export const ASSET_CLASSES = [
  "FOREX",
  "METAL",
  "INDEX",
  "CRYPTO",
  "COMMODITY",
  "EQUITY",
  "OTHER",
] as const;

export const TRADE_STATUSES = [
  "DRAFT",
  "PLANNED",
  "OPEN",
  "CLOSED",
  "CANCELED",
] as const;

export const TRADE_OUTCOMES = [
  "WIN",
  "LOSS",
  "BREAK_EVEN",
  "PARTIAL_WIN",
  "PARTIAL_LOSS",
] as const;

export const TRADE_SOURCES = [
  "MANUAL",
  "CSV",
  "MT4",
  "MT5",
  "BROKER_API",
] as const;

export const TRADE_DIRECTIONS = ["BUY", "SELL"] as const;
export const ORDER_TYPES = [
  "MARKET",
  "BUY_LIMIT",
  "SELL_LIMIT",
  "BUY_STOP",
  "SELL_STOP",
  "OTHER",
] as const;
export const TRADING_SESSIONS = [
  "ASIAN",
  "LONDON",
  "NEW_YORK",
  "LONDON_NEW_YORK_OVERLAP",
  "OTHER",
] as const;
export const TIMEFRAMES = ["1W", "1D", "4H", "1H", "30M", "15M", "5M", "1M"] as const;
export const MARKET_BIASES = ["BULLISH", "BEARISH", "NEUTRAL", "MIXED", "NOT_RECORDED"] as const;
export const MARKET_CONDITIONS = [
  "TRENDING",
  "RANGING",
  "BREAKOUT",
  "REVERSAL",
  "HIGH_VOLATILITY",
  "LOW_VOLATILITY",
  "MIXED",
  "OTHER",
] as const;
export const RULE_TYPES = [
  "DESCRIPTIVE",
  "MAX_RISK_PERCENT",
  "MIN_RR",
  "MAX_TRADES_PER_DAY",
  "BEHAVIOR",
] as const;
export const SCREENSHOT_CATEGORIES = [
  "BEFORE_ENTRY",
  "AT_ENTRY",
  "DURING_TRADE",
  "AT_EXIT",
  "POST_TRADE_REVIEW",
] as const;
export const TRADE_GRADES = ["A", "B", "C", "D", "F"] as const;
export const RETAKE_DECISIONS = ["YES", "NO", "ONLY_WITH_CHANGES"] as const;
export const STOP_ACTIONS = ["UNCHANGED", "MOVED_TO_BREAK_EVEN", "TIGHTENED", "WIDENED"] as const;
export const TRADE_EMOTIONS = [
  "CALM",
  "FOCUSED",
  "FEARFUL",
  "EXCITED",
  "FRUSTRATED",
  "IMPATIENT",
  "OVERCONFIDENT",
  "TIRED",
  "OTHER",
] as const;
export const ADJUSTMENT_TYPES = ["DEPOSIT", "WITHDRAWAL", "BALANCE_CORRECTION", "OTHER"] as const;
export const IMPORT_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
export const MANAGEMENT_EVENT_TYPES = ["STOP_MOVED", "TARGET_CHANGED", "SCALE_IN", "SCALE_OUT", "NOTE"] as const;
export const PROP_VALUE_MODES = ["AMOUNT", "PERCENT"] as const;
export const PROP_DRAWDOWN_TYPES = ["STATIC", "TRAILING", "OTHER"] as const;
export const PROP_DAILY_BASELINES = ["STARTING_BALANCE", "START_OF_DAY_BALANCE", "START_OF_DAY_EQUITY"] as const;
export const PROP_TOTAL_BASELINES = ["STARTING_BALANCE", "HIGHEST_BALANCE", "HIGHEST_EQUITY"] as const;
export const PROP_LOSS_MEASURES = ["BALANCE", "EQUITY"] as const;
export const PROP_CONSISTENCY_FORMULAS = ["BEST_DAY_OVER_TOTAL_POSITIVE_PROFIT", "OTHER"] as const;
export const GOAL_TYPES = ["TOTAL_TRADES", "ACCOUNT_RETURN_PERCENT", "ACCOUNT_BALANCE", "CUMULATIVE_R", "RULE_COMPLIANCE_PERCENT", "MAX_DRAWDOWN_AMOUNT", "MAX_DRAWDOWN_PERCENT", "PROFITABLE_DAYS", "CUSTOM"] as const;
export const ACCOUNT_FAILURE_REASONS = ["DAILY_LOSS_LIMIT", "MAXIMUM_LOSS", "TIME_LIMIT", "MANUAL_TERMINATION", "OTHER"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type AssetClass = (typeof ASSET_CLASSES)[number];
export type TradeStatus = (typeof TRADE_STATUSES)[number];
export type TradeOutcome = (typeof TRADE_OUTCOMES)[number];
export type TradeSource = (typeof TRADE_SOURCES)[number];
export type TradeDirection = (typeof TRADE_DIRECTIONS)[number];
export type OrderType = (typeof ORDER_TYPES)[number];
export type TradingSession = (typeof TRADING_SESSIONS)[number];
export type Timeframe = (typeof TIMEFRAMES)[number];
export type MarketBias = (typeof MARKET_BIASES)[number];
export type MarketCondition = (typeof MARKET_CONDITIONS)[number];
export type RuleType = (typeof RULE_TYPES)[number];
export type ScreenshotCategory = (typeof SCREENSHOT_CATEGORIES)[number];
export type TradeGrade = (typeof TRADE_GRADES)[number];
export type RetakeDecision = (typeof RETAKE_DECISIONS)[number];
export type StopAction = (typeof STOP_ACTIONS)[number];
export type TradeEmotion = (typeof TRADE_EMOTIONS)[number];
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export type ManagementEventType = (typeof MANAGEMENT_EVENT_TYPES)[number];
export type PropValueMode = (typeof PROP_VALUE_MODES)[number];
export type PropDrawdownType = (typeof PROP_DRAWDOWN_TYPES)[number];
export type GoalType = (typeof GOAL_TYPES)[number];
export type AccountFailureReason = (typeof ACCOUNT_FAILURE_REASONS)[number];
