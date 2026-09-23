"use client";

import { useMemo, useState } from "react";

import { parseDecimal } from "@/domain/money/decimal";
import {
  calculateHoldingDurationSeconds,
  calculateNetPnl,
  calculatePlannedRiskPercentage,
  calculateRiskMultiple,
  calculateStopDistance,
  classifyClosedTradeOutcome,
} from "@/domain/trades/financials";
import { ExecutionQualitySection } from "@/features/trades/execution-quality-section";
import { DraftNavigationGuard } from "@/features/trades/draft-navigation-guard";
import { ExecutionSection } from "@/features/trades/execution-section";
import { IdentificationSection } from "@/features/trades/identification-section";
import { PlanCorrectionPanel } from "@/features/trades/plan-correction-panel";
import { PlanSection } from "@/features/trades/plan-section";
import { PsychologySection } from "@/features/trades/psychology-section";
import { ResultSection } from "@/features/trades/result-section";
import { ReviewSection } from "@/features/trades/review-section";
import { RiskSection } from "@/features/trades/risk-section";
import { RuleComplianceSection } from "@/features/trades/rule-compliance-section";
import { saveManualTrade } from "@/features/trades/actions";
import { ScreenshotUploader } from "@/features/trades/screenshot-uploader";
import { SetupSection } from "@/features/trades/setup-section";
import { SubmitBar } from "@/features/trades/submit-bar";
import type { CalculationPreview, TradeFormProps } from "@/features/trades/types";
import type { TradeStatus } from "@/types/domain";

const emptyPreview: CalculationPreview = {
  riskPercentage: null,
  plannedRiskReward: null,
  netPnl: null,
  actualR: null,
  outcome: null,
  holdingDurationSeconds: null,
  stopDistance: null,
};

function value(formData: FormData, name: string): string {
  const result = formData.get(name);
  return typeof result === "string" ? result.trim() : "";
}

export function TradeForm({ accounts, instruments, strategies, setups, rules, record, userId, timezone }: TradeFormProps) {
  const trade = record?.trade;
  const lockedPlan = trade?.status === "OPEN" || trade?.status === "CLOSED";
  const [accountId, setAccountId] = useState(trade?.account_id ?? accounts[0]?.id ?? "");
  const [status, setStatus] = useState<TradeStatus>(trade?.status ?? "DRAFT");
  const [preview, setPreview] = useState<CalculationPreview>(emptyPreview);
  const [dirty, setDirty] = useState(false);
  const account = accounts.find((item) => item.id === accountId);
  const applicableRules = useMemo(
    () => rules.filter((rule) => rule.active && (rule.account_id === null || rule.account_id === accountId)),
    [rules, accountId],
  );

  function updatePreview(form: HTMLFormElement) {
    const formData = new FormData(form);
    const currentAccount = accounts.find((item) => item.id === value(formData, "accountId")) ?? account;
    const instrument = instruments.find((item) => item.id === value(formData, "instrumentId"));
    const risk = value(formData, "plannedRiskAmount");
    const reward = value(formData, "plannedRewardAmount");
    const gross = value(formData, "grossPnl");
    const balance = value(formData, "accountBalanceBefore") || trade?.account_balance_before || currentAccount?.derived_balance;
    const currentStatus = value(formData, "status") || status;
    const actualPercentages = formData.getAll("targetActualPercentage").map(String);
    const usedPartials = actualPercentages.some((amount) => {
      try { const percentage = parseDecimal(amount); return percentage.gt(0) && percentage.lt(100); } catch { return false; }
    });
    const next = { ...emptyPreview };

    try { if (risk && balance) next.riskPercentage = calculatePlannedRiskPercentage(risk, balance); } catch {}
    try { if (risk && reward) next.plannedRiskReward = calculateRiskMultiple(reward, risk); } catch {}
    try {
      if (gross && currentAccount) {
        next.netPnl = calculateNetPnl({ grossPnl: gross, commission: value(formData, "commission") || "0", swap: value(formData, "swap") || "0", otherFees: value(formData, "otherFees") || "0", currencyPrecision: currentAccount.currency_precision });
        if (risk) next.actualR = calculateRiskMultiple(next.netPnl, risk);
        if (currentStatus === "CLOSED") next.outcome = classifyClosedTradeOutcome(next.netPnl, currentAccount.currency_precision, usedPartials);
      }
    } catch {}
    try {
      const entry = value(formData, "plannedEntry");
      const stop = value(formData, "plannedStopLoss");
      if (entry && stop) {
        const distance = calculateStopDistance(entry, stop, instrument?.pip_size);
        next.stopDistance = `${distance.value} ${distance.unit}`;
      }
    } catch {}
    next.holdingDurationSeconds = calculateHoldingDurationSeconds(value(formData, "openedAt"), value(formData, "closedAt"));
    setPreview(next);
  }

  async function submit(formData: FormData) {
    setDirty(false);
    for (const name of ["plannedAt", "openedAt", "closedAt", "targetHitAt"]) {
      const entries = formData.getAll(name);
      if (entries.length > 1) {
        formData.delete(name);
        for (const entry of entries) formData.append(name, typeof entry === "string" && entry ? new Date(entry).toISOString() : "");
      } else {
        const entry = entries[0];
        if (typeof entry === "string" && entry) formData.set(name, new Date(entry).toISOString());
      }
    }
    await saveManualTrade(formData);
  }

  return (
    <div className="space-y-6">
      <DraftNavigationGuard dirty={dirty} />
      <form
        action={submit}
        onInput={(event) => { setDirty(true); updatePreview(event.currentTarget); }}
        onChange={(event) => { setDirty(true); updatePreview(event.currentTarget); }}
        className="space-y-6"
      >
        {trade ? <input type="hidden" name="id" value={trade.id} /> : null}
        <input type="hidden" name="timezone" value={timezone} />
        <IdentificationSection accounts={accounts} instruments={instruments} trade={trade} accountId={accountId} status={status} onAccountChange={setAccountId} onStatusChange={setStatus} />
        <SetupSection strategies={strategies} setups={setups} trade={trade} locked={Boolean(lockedPlan)} />
        <PlanSection trade={trade} initialTargets={record?.targets ?? []} locked={Boolean(lockedPlan)} />
        <RiskSection account={account} trade={trade} locked={Boolean(lockedPlan)} preview={preview} />
        <ExecutionSection trade={trade} />
        <ResultSection trade={trade} preview={preview} visible={status === "CLOSED" || Boolean(trade?.gross_pnl)} />
        <ExecutionQualitySection review={record?.executionReview} />
        <PsychologySection psychology={record?.psychology} />
        <RuleComplianceSection rules={applicableRules} results={record?.ruleResults ?? []} />
        <ReviewSection review={record?.review} visible={status === "CLOSED"} />
        <SubmitBar editing={Boolean(trade)} canSaveDraft={!lockedPlan} />
      </form>

      <ScreenshotUploader tradeId={trade?.id} userId={userId} screenshots={record?.screenshots ?? []} />
      {trade && lockedPlan ? <PlanCorrectionPanel trade={trade} targets={record?.targets ?? []} corrections={record?.corrections ?? []} /> : null}
    </div>
  );
}
