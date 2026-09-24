import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AnalyticsDataset } from "@/services/analytics/get-performance-analytics";
import { ACCOUNT_TYPES, TRADE_DIRECTIONS, TRADING_SESSIONS } from "@/types/domain";

const selectClassName = "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

export function AnalyticsFilters({ dataset, path }: { dataset: AnalyticsDataset; path: string }) {
  const { filters } = dataset;
  return (
    <form action={path} method="get" className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <div className="grid gap-2"><Label htmlFor="analytics-account">Account</Label><select id="analytics-account" name="account" defaultValue={filters.account ?? ""} className={selectClassName}><option value="">All accounts</option>{dataset.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="grid gap-2"><Label htmlFor="analytics-account-type">Account type</Label><select id="analytics-account-type" name="accountType" defaultValue={filters.accountType ?? ""} className={selectClassName}><option value="">All types</option>{ACCOUNT_TYPES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></div>
        <div className="grid gap-2"><Label htmlFor="analytics-from">Closed from</Label><Input id="analytics-from" name="from" type="date" defaultValue={filters.from} /></div>
        <div className="grid gap-2"><Label htmlFor="analytics-to">Closed through</Label><Input id="analytics-to" name="to" type="date" defaultValue={filters.to} /></div>
        <div className="grid gap-2"><Label htmlFor="analytics-instrument">Instrument</Label><select id="analytics-instrument" name="instrument" defaultValue={filters.instrument ?? ""} className={selectClassName}><option value="">All instruments</option>{dataset.instruments.map((item) => <option key={item.id} value={item.id}>{item.symbol}</option>)}</select></div>
        <div className="grid gap-2"><Label htmlFor="analytics-strategy">Strategy</Label><select id="analytics-strategy" name="strategy" defaultValue={filters.strategy ?? ""} className={selectClassName}><option value="">All strategies</option>{dataset.strategies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="grid gap-2"><Label htmlFor="analytics-setup">Setup</Label><select id="analytics-setup" name="setup" defaultValue={filters.setup ?? ""} className={selectClassName}><option value="">All setups</option>{dataset.setups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="grid gap-2"><Label htmlFor="analytics-session">Session</Label><select id="analytics-session" name="session" defaultValue={filters.session ?? ""} className={selectClassName}><option value="">All sessions</option>{TRADING_SESSIONS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></div>
        <div className="grid gap-2"><Label htmlFor="analytics-direction">Direction</Label><select id="analytics-direction" name="direction" defaultValue={filters.direction ?? ""} className={selectClassName}><option value="">Both directions</option>{TRADE_DIRECTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-xs text-muted-foreground">Realized performance uses final <code>closed_at</code> in {dataset.timezone}. Open trades never enter realized metrics.</p>
        <div className="flex gap-2"><Button variant="ghost" nativeButton={false} render={<Link href={path}>Reset</Link>} /><Button type="submit">Apply filters</Button></div>
      </div>
    </form>
  );
}
