import { notFound } from "next/navigation";
import { LockKeyhole } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { TradeForm } from "@/features/trades/trade-form";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getManualTradeRecord, getTradeFormReferences } from "@/services/trades/get-trade-form-data";

interface EditTradePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; message?: string }>;
}

export default async function EditTradePage({ params, searchParams }: EditTradePageProps) {
  const [{ id }, status, userId, supabase] = await Promise.all([params, searchParams, requireUserId(), createClient()]);
  const [references, record] = await Promise.all([
    getTradeFormReferences(supabase),
    getManualTradeRecord(supabase, id, userId),
  ]);
  if (!record) notFound();
  const editableReferences = {
    ...references,
    strategies: references.strategies.filter((strategy) => strategy.active || strategy.id === record.trade.strategy_id),
    setups: references.setups.filter((setup) => setup.active || setup.id === record.trade.setup_id),
  };
  const locked = record.trade.status === "OPEN" || record.trade.status === "CLOSED";
  const instrument = references.instruments.find((item) => item.id === record.trade.instrument_id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Manual trade logging"
        title={`${instrument?.symbol ?? "Trade"} record`}
        description="Update execution facts and reviews without rewriting the original plan. Corrections to opened plans remain append-only evidence."
        actions={<div className="flex items-center gap-2"><Badge>{record.trade.status}</Badge>{locked ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3.5" /> Plan locked</span> : null}</div>}
      />
      {status.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{status.error}</p> : null}
      {status.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{status.message}</p> : null}
      <TradeForm {...editableReferences} record={record} userId={userId} />
    </div>
  );
}
