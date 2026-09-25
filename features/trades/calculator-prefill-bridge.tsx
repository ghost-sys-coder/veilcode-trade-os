"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Calculator, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CALCULATOR_TRANSFER_KEY, parseCalculatorTransfer, type CalculatorTransfer } from "@/domain/trading/calculator-transfer";
import { CURRENCY_PRECISION, getInstrumentSpecification, SUPPORTED_ACCOUNT_CURRENCIES, type SupportedAccountCurrency } from "@/domain/trading/instrument-specifications";
import { calculatePositionSize } from "@/domain/trading/position-sizing";
import { SelectField } from "@/features/trades/select-field";
import { TradeForm } from "@/features/trades/trade-form";
import type { TradeFormProps } from "@/features/trades/types";

export function CalculatorPrefillBridge(props: TradeFormProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<CalculatorTransfer | null | undefined>(undefined);
  const [accountId, setAccountId] = useState("");
  const [manualRate, setManualRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<TradeFormProps["initialValues"]>();
  const account = props.accounts.find((item) => item.id === accountId);
  const specification = draft ? getInstrumentSpecification(draft.symbol) : undefined;
  const accountCurrency = account?.currency_code as SupportedAccountCurrency | undefined;
  const supportedCurrency = accountCurrency && SUPPORTED_ACCOUNT_CURRENCIES.includes(accountCurrency);
  const needsRate = Boolean(accountCurrency && specification && accountCurrency !== specification.quoteCurrency && accountCurrency !== specification.baseCurrency);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CALCULATOR_TRANSFER_KEY);
      queueMicrotask(() => setDraft(raw ? parseCalculatorTransfer(JSON.parse(raw)) : null));
    } catch {
      queueMicrotask(() => setDraft(null));
    }
  }, []);

  function reconcile() {
    if (!draft || !account || !specification || !accountCurrency || !supportedCurrency) {
      setError("Choose a supported trading account before continuing.");
      return;
    }
    const instrument = props.instruments.find((item) => item.symbol.toUpperCase() === draft.symbol);
    if (!instrument) {
      setError(`${draft.symbol} is not available in your private instrument list.`);
      return;
    }
    try {
      const result = calculatePositionSize({
        balance: account.derived_balance,
        currency: accountCurrency,
        currencyPrecision: CURRENCY_PRECISION[accountCurrency],
        riskMethod: draft.riskMethod,
        riskValue: draft.riskValue,
        instrument: specification,
        direction: draft.direction,
        entryPrice: draft.entryPrice,
        stopLossPrice: draft.stopLossPrice,
        takeProfitPrice: draft.takeProfitPrice,
        leverage: account.leverage ?? draft.leverage,
        manualQuoteToAccountRate: needsRate ? manualRate || undefined : undefined,
      });
      if (!result.recommendedVolume || !result.actualRiskAmount) throw new Error(result.warnings[0] ?? "This position cannot be sized for the selected account.");
      setPrefill({
        accountId: account.id,
        instrumentId: instrument.id,
        direction: draft.direction,
        plannedEntry: draft.entryPrice,
        plannedStopLoss: draft.stopLossPrice,
        plannedTakeProfit: draft.takeProfitPrice,
        plannedLotSize: result.recommendedVolume,
        plannedRiskAmount: result.actualRiskAmount,
        plannedRewardAmount: result.rewardAmount ?? undefined,
      });
      setError(null);
    } catch (cause) {
      setPrefill(undefined);
      setError(cause instanceof Error ? cause.message : "Unable to reconcile this draft.");
    }
  }

  function discard() {
    sessionStorage.removeItem(CALCULATOR_TRANSFER_KEY);
    router.push("/trades/new");
  }

  if (draft === undefined) return <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Loading calculator draft…</p>;
  if (!draft) return <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center"><Calculator className="mx-auto size-7 text-primary" /><h2 className="mt-3 font-semibold">Calculator draft unavailable</h2><p className="mt-2 text-sm text-muted-foreground">The draft may be missing, invalid, or more than 24 hours old.</p><Button type="button" className="mt-5" onClick={() => router.push("/tools/position-size-calculator")}>Open calculator</Button></div>;

  if (prefill) return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-profit/25 bg-profit/10 p-4"><div><p className="font-semibold text-profit">Calculator plan reconciled</p><p className="mt-1 text-xs text-muted-foreground">Sizing now uses {account?.name}, its derived balance, currency, and leverage. Saving creates a normal MANUAL trade.</p></div><Button type="button" variant="outline" size="sm" onClick={() => setPrefill(undefined)}><ArrowLeft />Change account</Button></div><TradeForm {...props} initialValues={prefill} calculatorTransfer /></div>;

  return (
    <Card className="surface-shadow">
      <CardHeader className="border-b border-border/70"><CardTitle className="flex items-center gap-2"><RefreshCw className="size-5 text-primary" />Reconcile with a trading account</CardTitle><CardDescription>Your public estimate is not authoritative until it is recalculated from a real account. Select the account explicitly.</CardDescription></CardHeader>
      <CardContent className="grid gap-5 pt-6 md:grid-cols-2">
        <SelectField name="reconcileAccount" label="Trading account" value={accountId} onValueChange={(value) => { setAccountId(value ?? ""); setPrefill(undefined); setError(null); }} items={props.accounts.map((item) => ({ label: `${item.name} · ${item.currency_code} · balance ${item.derived_balance}`, value: item.id }))} placeholder="Choose an account" required />
        <div className="rounded-lg border border-border/70 bg-muted/25 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Preserved risk method</p><p className="mt-2 font-mono text-sm font-semibold">{draft.riskMethod === "PERCENTAGE" ? `${draft.riskValue}% of balance` : `${draft.riskValue} ${draft.currency} fixed`}</p></div>
        {account && !supportedCurrency ? <p className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive md:col-span-2">{account.currency_code} is not supported by the Phase 08 calculator.</p> : null}
        {account && needsRate ? <div className="grid gap-2 md:col-span-2"><Label htmlFor="reconcileRate">{specification?.quoteCurrency} → {account.currency_code} conversion rate</Label><Input id="reconcileRate" inputMode="decimal" value={manualRate} onChange={(event) => setManualRate(event.target.value)} placeholder={`Account currency units per 1 ${specification?.quoteCurrency}`} /><p className="text-xs text-muted-foreground">The original public conversion cannot be reused because this account has a different currency.</p></div> : null}
        {error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive md:col-span-2">{error}</p> : null}
        <div className="flex flex-wrap gap-3 md:col-span-2"><Button type="button" onClick={reconcile} disabled={!accountId}>Recalculate for account<Calculator /></Button><Button type="button" variant="outline" onClick={discard}><Trash2 />Discard calculator draft</Button></div>
      </CardContent>
    </Card>
  );
}
