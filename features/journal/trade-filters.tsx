"use client";

import { Search } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/features/trades/select-field";
import { TRADE_DIRECTIONS, TRADE_GRADES, TRADE_OUTCOMES, TRADE_STATUSES, TRADING_SESSIONS } from "@/types/domain";

interface TradeFiltersProps {
  values: Record<string, string | undefined>;
  accounts: Array<{ id: string; name: string }>;
  instruments: Array<{ id: string; symbol: string }>;
  strategies: Array<{ id: string; name: string }>;
  setups: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
}

const any = { label: "Any", value: "ANY" };

export function TradeFilters({ values, accounts, instruments, strategies, setups, tags }: TradeFiltersProps) {
  return (
    <form action="/trades" className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <div className="space-y-2 md:col-span-2 xl:col-span-2">
        <Label htmlFor="search">Search journal</Label>
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="search" name="search" defaultValue={values.search} className="pl-9" placeholder="Instrument, strategy, thesis, notes or tag" /></div>
      </div>
      <SelectField name="account" label="Account" items={[any, ...accounts.map((item) => ({ label: item.name, value: item.id }))]} defaultValue={values.account ?? "ANY"} />
      <SelectField name="instrument" label="Instrument" items={[any, ...instruments.map((item) => ({ label: item.symbol, value: item.id }))]} defaultValue={values.instrument ?? "ANY"} />
      <SelectField name="direction" label="Direction" items={[any, ...TRADE_DIRECTIONS.map((value) => ({ label: value, value }))]} defaultValue={values.direction ?? "ANY"} />
      <SelectField name="strategy" label="Strategy" items={[any, ...strategies.map((item) => ({ label: item.name, value: item.id }))]} defaultValue={values.strategy ?? "ANY"} />
      <SelectField name="setup" label="Setup" items={[any, ...setups.map((item) => ({ label: item.name, value: item.id }))]} defaultValue={values.setup ?? "ANY"} />
      <SelectField name="session" label="Session" items={[any, ...TRADING_SESSIONS.map((value) => ({ label: value.replaceAll("_", " "), value }))]} defaultValue={values.session ?? "ANY"} />
      <SelectField name="status" label="Status" items={[any, ...TRADE_STATUSES.map((value) => ({ label: value, value }))]} defaultValue={values.status ?? "ANY"} />
      <SelectField name="outcome" label="Outcome" items={[any, ...TRADE_OUTCOMES.map((value) => ({ label: value.replaceAll("_", " "), value }))]} defaultValue={values.outcome ?? "ANY"} />
      <SelectField name="grade" label="Grade" items={[any, ...TRADE_GRADES.map((value) => ({ label: value, value }))]} defaultValue={values.grade ?? "ANY"} />
      <SelectField name="ruleCompliance" label="Rule review" items={[any, { label: "Fully compliant", value: "FULLY_COMPLIANT" }, { label: "Violations present", value: "VIOLATIONS_PRESENT" }, { label: "Not reviewed", value: "NOT_REVIEWED" }]} defaultValue={values.ruleCompliance ?? "ANY"} />
      <SelectField name="tag" label="Tag" items={[any, ...tags.map((item) => ({ label: item.name, value: item.id }))]} defaultValue={values.tag ?? "ANY"} />
      <SelectField name="sort" label="Sort" items={[{ label: "Newest journal date", value: "date_desc" }, { label: "Oldest journal date", value: "date_asc" }, { label: "Highest net PnL", value: "pnl_desc" }, { label: "Lowest net PnL", value: "pnl_asc" }]} defaultValue={values.sort ?? "date_desc"} />
      <div className="space-y-2"><Label htmlFor="from">Journal date from</Label><Input id="from" name="from" type="date" defaultValue={values.from} /></div>
      <div className="space-y-2"><Label htmlFor="to">Journal date to</Label><Input id="to" name="to" type="date" defaultValue={values.to} /></div>
      <div className="flex items-end gap-2 md:col-span-2 xl:col-span-5">
        <Button type="submit">Apply filters</Button>
        <Button render={<Link href="/trades" />} nativeButton={false} variant="outline">Clear</Button>
      </div>
    </form>
  );
}
