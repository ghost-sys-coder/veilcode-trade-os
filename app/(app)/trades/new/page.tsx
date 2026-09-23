import Link from "next/link";
import { BookOpenText, Landmark } from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { TradeForm } from "@/features/trades/trade-form";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTradeFormReferences } from "@/services/trades/get-trade-form-data";

interface NewTradePageProps { searchParams: Promise<{ error?: string; message?: string }> }

export default async function NewTradePage({ searchParams }: NewTradePageProps) {
  const [status, userId, supabase] = await Promise.all([searchParams, requireUserId(), createClient()]);
  const references = await getTradeFormReferences(supabase);
  const activeReferences = {
    ...references,
    strategies: references.strategies.filter((strategy) => strategy.active),
    setups: references.setups.filter((setup) => setup.active),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Manual trade logging"
        title="Record a trade"
        description="Build one canonical record from the original idea through execution, result, psychology, rules, evidence, and review. Save a draft whenever the record is incomplete."
        actions={<div className="flex items-center gap-2 text-xs text-muted-foreground"><BookOpenText className="size-4 text-primary" /> Phase 02 workflow</div>}
      />
      {status.error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{status.error}</p> : null}
      {status.message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{status.message}</p> : null}
      {activeReferences.accounts.length ? (
        <TradeForm {...activeReferences} userId={userId} />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Landmark className="mx-auto size-8 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">Create an account first</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Every trade belongs to an account so balance, risk, and currency precision remain reproducible.</p>
          <Button render={<Link href="/accounts" />} className="mt-5">Go to accounts</Button>
        </div>
      )}
    </div>
  );
}
