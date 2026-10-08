"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { InstrumentRow } from "@/types/database-helpers";

interface SearchableInstrumentSelectProps {
  instruments: InstrumentRow[];
  defaultValue?: string;
  disabled?: boolean;
}

export function SearchableInstrumentSelect({ instruments, defaultValue,disabled }: SearchableInstrumentSelectProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(defaultValue ?? instruments[0]?.id ?? "");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return instruments;
    return instruments.filter((instrument) =>
      `${instrument.symbol} ${instrument.display_name} ${instrument.asset_class}`.toLowerCase().includes(needle),
    );
  }, [instruments, query]);
  const selected = instruments.find((instrument) => instrument.id === selectedId);
  const visible = selected && !filtered.some((instrument) => instrument.id === selected.id)
    ? [selected, ...filtered]
    : filtered;
  const items = visible.map((instrument) => ({
    label: `${instrument.symbol} — ${instrument.display_name}`,
    value: instrument.id,
  }));

  return (
    <div className="space-y-2">
      <Label htmlFor="instrumentId">Instrument <span className="text-destructive">*</span></Label>
      <Input
        id="instrument-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search EURUSD, gold, forex…"
        aria-label="Search instruments"
        disabled={disabled}
      />
      {disabled?<input type="hidden" name="instrumentId" value={selectedId} />:null}
      <Select name="instrumentId" value={selectedId} onValueChange={(value) => setSelectedId(value ?? "")} items={items} required disabled={disabled}>
        <SelectTrigger id="instrumentId" aria-label="Instrument" className="w-full"><SelectValue placeholder="Choose an instrument" /></SelectTrigger>
        <SelectContent>
          {visible.map((instrument) => (
            <SelectItem key={instrument.id} value={instrument.id}>
              {instrument.symbol} — {instrument.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs leading-5 text-muted-foreground">Choose the market you traded, for example EURUSD, GBPUSD or XAUUSD.</p>
    </div>
  );
}
