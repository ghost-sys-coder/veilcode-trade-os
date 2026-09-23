import { z } from "zod";

import { classifyClosedTradeOutcome } from "@/domain/trades/financials";
import {
  ACCOUNT_PLATFORMS,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  MARKET_BIASES,
  MARKET_CONDITIONS,
  ORDER_TYPES,
  RETAKE_DECISIONS,
  RULE_TYPES,
  STOP_ACTIONS,
  TIMEFRAMES,
  TRADE_DIRECTIONS,
  TRADE_EMOTIONS,
  TRADE_GRADES,
  TRADE_OUTCOMES,
  TRADE_SOURCES,
  TRADE_STATUSES,
  TRADING_SESSIONS,
} from "@/types/domain";

const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export const decimalStringSchema = z
  .string()
  .trim()
  .regex(decimalPattern, "Enter a valid decimal value.");

const nonNegativeDecimalSchema = decimalStringSchema.refine(
  (value) => !value.startsWith("-"),
  "Value cannot be negative.",
);

const positiveDecimalSchema = nonNegativeDecimalSchema.refine(
  (value) => !/^0(?:\.0+)?$/.test(value),
  "Value must be greater than zero.",
);

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalTextSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().optional(),
);

const optionalDecimalSchema = z.preprocess(
  emptyToUndefined,
  decimalStringSchema.optional(),
);

const optionalNonNegativeDecimalSchema = z.preprocess(
  emptyToUndefined,
  nonNegativeDecimalSchema.optional(),
);

const optionalUuidSchema = z.preprocess(
  emptyToUndefined,
  z.string().uuid().optional(),
);

export const tradingAccountSchema = z.object({
  id: optionalUuidSchema,
  name: z.string().trim().min(2).max(80),
  accountType: z.enum(ACCOUNT_TYPES),
  brokerName: optionalTextSchema,
  platform: z.enum(ACCOUNT_PLATFORMS),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  currencyPrecision: z.coerce.number().int().min(0).max(20),
  startingBalance: positiveDecimalSchema,
  leverage: optionalNonNegativeDecimalSchema,
  startedAt: z.string().regex(isoDatePattern),
  status: z.enum(ACCOUNT_STATUSES),
  notes: optionalTextSchema,
});

export const strategySchema = z.object({
  id: optionalUuidSchema,
  name: z.string().trim().min(2).max(100),
  description: optionalTextSchema,
  active: z.boolean(),
});

export const setupSchema = z.object({
  id: optionalUuidSchema,
  strategyId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  description: optionalTextSchema,
  active: z.boolean(),
});

export const tradingRuleSchema = z.object({
  id: optionalUuidSchema,
  accountId: optionalUuidSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(1000),
  ruleType: z.enum(RULE_TYPES),
  numericLimit: optionalNonNegativeDecimalSchema,
  active: z.boolean(),
});

export const tradeSchema = z
  .object({
    id: optionalUuidSchema,
    accountId: z.string().uuid(),
    instrumentId: z.string().uuid(),
    strategyId: optionalUuidSchema,
    setupId: optionalUuidSchema,
    status: z.enum(TRADE_STATUSES),
    outcome: z.enum(TRADE_OUTCOMES).optional(),
    sourceType: z.enum(TRADE_SOURCES).default("MANUAL"),
    direction: z.enum(TRADE_DIRECTIONS),
    orderType: z.enum(ORDER_TYPES),
    session: z.enum(TRADING_SESSIONS),
    primaryAnalysisTimeframe: z.enum(TIMEFRAMES).optional(),
    entryTimeframe: z.enum(TIMEFRAMES).optional(),
    higherTimeframeBias: z.enum(MARKET_BIASES).optional(),
    marketCondition: z.enum(MARKET_CONDITIONS).optional(),
    thesis: optionalTextSchema,
    entryReason: optionalTextSchema,
    confirmationNotes: optionalTextSchema,
    plannedAt: z.string().datetime().optional(),
    openedAt: z.string().datetime().optional(),
    closedAt: z.string().datetime().optional(),
    accountBalanceBefore: optionalNonNegativeDecimalSchema,
    plannedEntry: optionalDecimalSchema,
    plannedStopLoss: optionalDecimalSchema,
    plannedTakeProfit: optionalDecimalSchema,
    plannedRiskAmount: optionalNonNegativeDecimalSchema,
    plannedRiskPercentage: optionalNonNegativeDecimalSchema,
    plannedRewardAmount: optionalNonNegativeDecimalSchema,
    plannedRiskReward: optionalNonNegativeDecimalSchema,
    plannedLotSize: optionalNonNegativeDecimalSchema,
    actualEntry: optionalDecimalSchema,
    actualStopLoss: optionalDecimalSchema,
    actualExit: optionalDecimalSchema,
    actualLotSize: optionalNonNegativeDecimalSchema,
    commission: nonNegativeDecimalSchema.default("0"),
    swap: nonNegativeDecimalSchema.default("0"),
    otherFees: nonNegativeDecimalSchema.default("0"),
    grossPnl: optionalDecimalSchema,
    netPnl: optionalDecimalSchema,
    currencyPrecision: z.coerce.number().int().min(0).max(20).optional(),
    usedPartialExits: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.setupId && !value.strategyId) {
      context.addIssue({
        code: "custom",
        path: ["setupId"],
        message: "A setup requires a strategy.",
      });
    }

    if (value.openedAt && value.closedAt && value.closedAt < value.openedAt) {
      context.addIssue({
        code: "custom",
        path: ["closedAt"],
        message: "Close time cannot precede open time.",
      });
    }

    if (value.status === "CLOSED" && (!value.outcome || value.netPnl === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Closed trades require an outcome and net PnL.",
      });
    }

    if (value.status === "CLOSED" && value.currencyPrecision === undefined) {
      context.addIssue({
        code: "custom",
        path: ["currencyPrecision"],
        message: "Closed-trade validation requires the account currency precision.",
      });
    }

    if (value.status === "CLOSED" && value.usedPartialExits === undefined) {
      context.addIssue({
        code: "custom",
        path: ["usedPartialExits"],
        message: "Closed-trade validation requires partial-exit history.",
      });
    }

    if (
      value.status === "CLOSED" &&
      value.outcome &&
      value.netPnl !== undefined &&
      value.currencyPrecision !== undefined &&
      value.usedPartialExits !== undefined &&
      value.outcome !==
        classifyClosedTradeOutcome(
          value.netPnl,
          value.currencyPrecision,
          value.usedPartialExits,
        )
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Outcome conflicts with normalized net PnL or partial-exit history.",
      });
    }
  });

export const tradeTargetSchema = z.object({
  id: optionalUuidSchema,
  tradeId: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  plannedPrice: decimalStringSchema,
  actualFillPrice: optionalDecimalSchema,
  plannedClosePercentage: optionalNonNegativeDecimalSchema,
  actualClosePercentage: optionalNonNegativeDecimalSchema,
  pnlContribution: optionalDecimalSchema,
});

export const executionReviewSchema = z.object({
  tradeId: z.string().uuid(),
  entryAccordingToPlan: z.boolean().optional(),
  stopAccordingToPlan: z.boolean().optional(),
  targetAccordingToPlan: z.boolean().optional(),
  stopAction: z.enum(STOP_ACTIONS).optional(),
  closedEarly: z.boolean(),
  enteredEarly: z.boolean(),
  enteredLate: z.boolean(),
  chasedPrice: z.boolean(),
  addedToPosition: z.boolean(),
  revengeTrade: z.boolean(),
  overRisked: z.boolean(),
  executionRating: z.number().int().min(1).max(5).optional(),
  notes: optionalTextSchema,
});

export const psychologyReviewSchema = z.object({
  tradeId: z.string().uuid(),
  confidenceBeforeEntry: z.number().int().min(1).max(5).optional(),
  emotionBefore: z.enum(TRADE_EMOTIONS).optional(),
  emotionDuring: z.enum(TRADE_EMOTIONS).optional(),
  emotionAfter: z.enum(TRADE_EMOTIONS).optional(),
  fearInfluenced: z.boolean(),
  greedInfluenced: z.boolean(),
  fomoInfluenced: z.boolean(),
  notes: optionalTextSchema,
});

export const tradeReviewSchema = z.object({
  tradeId: z.string().uuid(),
  whatWentWell: optionalTextSchema,
  whatWentWrong: optionalTextSchema,
  wouldTakeAgain: z.enum(RETAKE_DECISIONS).optional(),
  improvement: optionalTextSchema,
  lessonLearned: optionalTextSchema,
  tradeQualityGrade: z.enum(TRADE_GRADES).optional(),
});

export const dailyLogSchema = z.object({
  accountId: z.string().uuid(),
  tradingDate: z.string().regex(isoDatePattern),
  startingBalance: optionalNonNegativeDecimalSchema,
  endingBalance: optionalNonNegativeDecimalSchema,
  marketConditions: optionalTextSchema,
  mentalState: optionalTextSchema,
  followedDailyPlan: z.boolean().optional(),
  hitDailyLossThreshold: z.boolean().optional(),
  stoppedWhenRequired: z.boolean().optional(),
  dailyRating: z.number().int().min(1).max(5).optional(),
  lessons: optionalTextSchema,
  notes: optionalTextSchema,
});

export const weeklyReviewSchema = z.object({
  accountId: z.string().uuid(),
  weekStart: z.string().regex(isoDatePattern),
  whatWorked: optionalTextSchema,
  whatDidNot: optionalTextSchema,
  changeNextWeek: optionalTextSchema,
  behaviorToStop: optionalTextSchema,
  behaviorToContinue: optionalTextSchema,
  notes: optionalTextSchema,
});

export const monthlyReviewSchema = z.object({
  accountId: z.string().uuid(),
  month: z.string().regex(isoDatePattern),
  whatWorked: optionalTextSchema,
  whatDidNot: optionalTextSchema,
  lessons: optionalTextSchema,
  focusNextMonth: optionalTextSchema,
  notes: optionalTextSchema,
});

export type TradingAccountInput = z.infer<typeof tradingAccountSchema>;
export type StrategyInput = z.infer<typeof strategySchema>;
export type SetupInput = z.infer<typeof setupSchema>;
export type TradingRuleInput = z.infer<typeof tradingRuleSchema>;
