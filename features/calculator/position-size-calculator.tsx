"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calculator, CheckCircle2, Info, ShieldAlert, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/features/trades/select-field";
import { CALCULATOR_TRANSFER_KEY, CALCULATOR_TRANSFER_VERSION } from "@/domain/trading/calculator-transfer";
import { calculatePositionSize, type PositionSizingResult, type RiskMethod, type TradeDirection } from "@/domain/trading/position-sizing";
import { CURRENCY_PRECISION, getInstrumentSpecification, INSTRUMENT_SPECIFICATIONS, SUPPORTED_ACCOUNT_CURRENCIES, type SupportedAccountCurrency } from "@/domain/trading/instrument-specifications";

export function PositionSizeCalculator() {
  const router = useRouter();
  const [balance, setBalance] = useState("10000");
  const [currency, setCurrency] = useState<SupportedAccountCurrency>("USD");
  const [riskMethod, setRiskMethod] = useState<RiskMethod>("PERCENTAGE");
  const [riskValue, setRiskValue] = useState("1");
  const [symbol, setSymbol] = useState("EURUSD");
  const [direction, setDirection] = useState<TradeDirection>("BUY");
  const [entryPrice, setEntryPrice] = useState("1.10000");
  const [stopLossPrice, setStopLossPrice] = useState("1.09500");
  const [takeProfitPrice, setTakeProfitPrice] = useState("1.11000");
  const [leverage, setLeverage] = useState("100");
  const [manualRate, setManualRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PositionSizingResult | null>(null);
  const instrument = getInstrumentSpecification(symbol)!;
  const needsManualRate = currency !== instrument.quoteCurrency && currency !== instrument.baseCurrency;

  function calculate() {
    try {
      const next = calculatePositionSize({
        balance, currency, currencyPrecision: CURRENCY_PRECISION[currency], riskMethod, riskValue,
        instrument, direction, entryPrice, stopLossPrice,
        takeProfitPrice: takeProfitPrice || undefined,
        leverage: leverage || undefined,
        manualQuoteToAccountRate: manualRate || undefined,
      });
      setResult(next);
      setError(null);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "Unable to calculate this position.");
    }
  }

  function continueToTrade() {
    const payload = {
      version: CALCULATOR_TRANSFER_VERSION,
      createdAt: Date.now(), balance, currency, riskMethod, riskValue, symbol, direction,
      entryPrice, stopLossPrice,
      takeProfitPrice: takeProfitPrice || undefined,
      leverage: leverage || undefined,
      manualQuoteToAccountRate: manualRate || undefined,
    };
    sessionStorage.setItem(CALCULATOR_TRANSFER_KEY, JSON.stringify(payload));
    router.push("/tools/position-size-calculator/continue");
  }

  return (
    <main>
      <section className="border-b border-border/70">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><Sparkles className="size-4" />Free trading tool</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">Position size, anchored to risk.</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">Turn your account balance, stop distance, and risk limit into a practical lot size. Calculations use exact decimal arithmetic and floor volume to the broker step so sizing never silently exceeds your risk.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] lg:px-8 lg:py-10">
        <Card className="surface-shadow">
          <CardHeader className="border-b border-border/70">
            <CardTitle className="flex items-center gap-2"><Calculator className="size-5 text-primary" />Trade parameters</CardTitle>
            <CardDescription>Enter the plan exactly as you intend to execute it.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2" onInput={() => { setResult(null); setError(null); }}>
            <div className="grid gap-2"><Label htmlFor="balance">Account balance</Label><Input id="balance" inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} /></div>
            <SelectField name="currency" label="Account currency" value={currency} onValueChange={(value) => { if (value) { setCurrency(value as SupportedAccountCurrency); setResult(null); setError(null); } }} items={SUPPORTED_ACCOUNT_CURRENCIES.map((value) => ({ label: value, value }))} />
            <SelectField name="riskMethod" label="Risk method" value={riskMethod} onValueChange={(value) => { if (value) { setRiskMethod(value as RiskMethod); setResult(null); setError(null); } }} items={[{ label: "Percentage of balance", value: "PERCENTAGE" }, { label: "Fixed amount", value: "FIXED_AMOUNT" }]} />
            <div className="grid gap-2"><Label htmlFor="riskValue">{riskMethod === "PERCENTAGE" ? "Risk percentage" : `Risk amount (${currency})`}</Label><Input id="riskValue" inputMode="decimal" value={riskValue} onChange={(event) => setRiskValue(event.target.value)} /></div>
            <SelectField name="instrument" label="Instrument" value={symbol} onValueChange={(value) => { if (value) { setSymbol(value); setResult(null); setError(null); } }} items={INSTRUMENT_SPECIFICATIONS.map((item) => ({ label: `${item.symbol} · ${item.displayName}`, value: item.symbol }))} />
            <SelectField name="direction" label="Direction" value={direction} onValueChange={(value) => { if (value) { setDirection(value as TradeDirection); setResult(null); setError(null); } }} items={[{ label: "Buy", value: "BUY" }, { label: "Sell", value: "SELL" }]} />
            <div className="grid gap-2"><Label htmlFor="entry">Entry price</Label><Input id="entry" inputMode="decimal" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="stop">Stop loss</Label><Input id="stop" inputMode="decimal" value={stopLossPrice} onChange={(event) => setStopLossPrice(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="target">Take profit <span className="text-muted-foreground">(optional)</span></Label><Input id="target" inputMode="decimal" value={takeProfitPrice} onChange={(event) => setTakeProfitPrice(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="leverage">Leverage <span className="text-muted-foreground">(optional)</span></Label><Input id="leverage" inputMode="decimal" value={leverage} onChange={(event) => setLeverage(event.target.value)} /></div>
            {needsManualRate ? <div className="grid gap-2 sm:col-span-2"><Label htmlFor="manualRate">{instrument.quoteCurrency} → {currency} conversion rate</Label><Input id="manualRate" inputMode="decimal" value={manualRate} onChange={(event) => setManualRate(event.target.value)} placeholder={`Account currency units per 1 ${instrument.quoteCurrency}`} /><p className="text-xs text-muted-foreground">Required because the account currency is neither the base nor quote currency.</p></div> : null}
            {error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">{error}</p> : null}
            <Button type="button" size="lg" onClick={calculate} className="sm:col-span-2">Calculate position size<ArrowRight data-icon="inline-end" /></Button>
          </CardContent>
        </Card>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden border-primary/25 surface-shadow">
            <CardHeader className="border-b border-border/70 bg-primary/8">
              <CardDescription>Risk-normalized recommendation</CardDescription>
              <CardTitle className="numeric text-4xl tracking-[-0.04em]">{result?.recommendedVolume ?? "—"} <span className="text-base font-medium text-muted-foreground">lots</span></CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              {result ? <>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Planned risk", `${currency} ${result.riskAmount}`],
                    ["Actual risk", result.actualRiskAmount ? `${currency} ${result.actualRiskAmount}` : "Unavailable"],
                    ["Stop distance", `${result.stopDistancePips} pips`],
                    ["Risk / reward", result.riskReward ? `${result.riskReward}R` : "Add a target"],
                    ["Reward", result.rewardAmount ? `${currency} ${result.rewardAmount}` : "—"],
                    ["Est. margin", result.estimatedMargin ? `${currency} ${result.estimatedMargin}` : "—"],
                  ].map(([label, value]) => <div key={label} className="rounded-lg border border-border/70 bg-muted/25 p-3"><p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="numeric mt-1 font-mono text-sm font-semibold">{value}</p></div>)}
                </div>
                {result.warnings.map((warning) => <p key={warning} className="flex gap-2 rounded-lg border border-primary/25 bg-primary/8 p-3 text-sm"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" />{warning}</p>)}
                <div className="space-y-2 border-t border-border pt-5">
                  <Button type="button" size="lg" className="w-full" disabled={!result.recommendedVolume} onClick={continueToTrade}>Log this trade in Trade OS<ArrowRight data-icon="inline-end" /></Button>
                  <p className="text-center text-xs leading-5 text-muted-foreground">Sign in if needed. Your draft stays in this browser for 24 hours and is reconciled against the account you select.</p>
                </div>
              </> : <div className="py-10 text-center"><Info className="mx-auto size-7 text-primary" /><p className="mt-4 font-semibold">Your result will appear here</p><p className="mt-2 text-sm leading-6 text-muted-foreground">We will show the floored lot size, actual normalized risk, reward, margin, and any boundary warnings.</p></div>}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="border-t border-border/70 bg-muted/20">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3 lg:px-8">
          {[ ["Risk-safe rounding", "Volume is floored to the instrument step. A minimum lot is never forced when it would exceed the chosen risk."], ["Currency-aware", "The calculator converts quote-currency loss into account currency and asks for a rate when it cannot derive one safely."], ["Plan, then record", "Move a valid result into the private journal, reconcile it to a real account, and save only when you explicitly submit."] ].map(([title, copy]) => <div key={title}><CheckCircle2 className="size-5 text-profit" /><h2 className="mt-3 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p></div>)}
        </div>
      </section>
    </main>
  );
}
