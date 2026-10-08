"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableInstrumentSelect } from "@/features/trades/searchable-instrument-select";
import { SelectField } from "@/features/trades/select-field";
import { TradeSection } from "@/features/trades/trade-section";
import type { TradeFormAccount } from "@/features/trades/types";
import { ORDER_TYPES, TRADE_DIRECTIONS, TRADE_STATUSES, TRADING_SESSIONS, type TradeStatus } from "@/types/domain";
import type { InstrumentRow, TradeRow } from "@/types/database-helpers";

interface IdentificationSectionProps {
  accounts: TradeFormAccount[];
  instruments: InstrumentRow[];
  trade?: TradeRow;
  accountId: string;
  status: TradeStatus;
  onAccountChange: (value: string) => void;
  onStatusChange: (value: TradeStatus) => void;
  initialInstrumentId?: string;
  initialDirection?: "BUY" | "SELL";
  lockAccount?: boolean;
}

function localDateTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function IdentificationSection({ accounts, instruments, trade, accountId, status, onAccountChange, onStatusChange, initialInstrumentId, initialDirection, lockAccount }: IdentificationSectionProps) {
  const lockedLifecycle = trade?.status === "OPEN" || trade?.status === "CLOSED";
  const broker=Boolean(trade?.mt5_connection_id)||Boolean(trade&&["MT4","MT5","BROKER_API"].includes(trade.source_type));
  const statuses = TRADE_STATUSES
    .filter((value) => !lockedLifecycle || (trade?.status === "OPEN" ? value === "OPEN" || value === "CLOSED" : value === "CLOSED"))
    .map((value) => ({ label: value.replaceAll("_", " "), value }));

  return (
    <TradeSection eyebrow="01 · Trade" title="Trade identification" description="Anchor this record to the correct account, market, lifecycle state, and timestamps.">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <SelectField
          name="accountId"
          label="Account"
          items={accounts.map((account) => ({ label: `${account.name} · ${account.currency_code}`, value: account.id }))}
          value={accountId}
          onValueChange={(value) => value && onAccountChange(value)}
          help="Account statistics and drawdown calculations use this selection."
          required
          disabled={lockedLifecycle || lockAccount}
        />
        {lockedLifecycle || lockAccount ? <input type="hidden" name="accountId" value={accountId} /> : null}
        <SearchableInstrumentSelect instruments={instruments} defaultValue={trade?.instrument_id ?? initialInstrumentId} disabled={lockedLifecycle||broker} />
        {lockedLifecycle||broker?<input type="hidden" name="direction" value={trade?.direction??initialDirection??"BUY"} />:null}
        <SelectField name="direction" label="Direction" items={TRADE_DIRECTIONS.map((value) => ({ label: value, value }))} defaultValue={trade?.direction ?? initialDirection ?? "BUY"} help="BUY expects price to rise; SELL expects price to fall." required disabled={lockedLifecycle||broker} />
        {broker?<input type="hidden" name="status" value={status} />:null}
        <SelectField name="status" label="Trade status" items={statuses} value={status} onValueChange={(value) => value && onStatusChange(value as TradeStatus)} help="Draft is incomplete, planned is not filled, open is live, closed is final, and canceled was never taken." required disabled={broker} />
        <SelectField name="orderType" label="Order type" items={ORDER_TYPES.map((value) => ({ label: value.replaceAll("_", " "), value }))} defaultValue={trade?.order_type ?? "MARKET"} help="Record how the entry was intended to be triggered." required />
        <SelectField name="session" label="Trading session" items={TRADING_SESSIONS.map((value) => ({ label: value.replaceAll("_", " "), value }))} defaultValue={trade?.session ?? "OTHER"} help="Used to compare performance across market sessions." required />
        <div className="space-y-2"><Label htmlFor="plannedAt">Planned date/time</Label><Input id="plannedAt" name="plannedAt" type="datetime-local" readOnly={lockedLifecycle} defaultValue={localDateTime(trade?.planned_at)} /><p className="text-xs text-muted-foreground">When you identified or planned the trade.</p></div>
        <div className="space-y-2"><Label htmlFor="openedAt">Opened date/time</Label><Input id="openedAt" name="openedAt" type="datetime-local" readOnly={broker} defaultValue={localDateTime(trade?.opened_at)} /><p className="text-xs text-muted-foreground">When the order actually filled.</p></div>
        <div className="space-y-2"><Label htmlFor="closedAt">Closed date/time</Label><Input id="closedAt" name="closedAt" type="datetime-local" readOnly={broker} defaultValue={localDateTime(trade?.closed_at)} /><p className="text-xs text-muted-foreground">When the final part of the position closed.</p></div>
      </div>
    </TradeSection>
  );
}
