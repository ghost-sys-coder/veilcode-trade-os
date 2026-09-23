import { saveAccount } from "@/features/accounts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACCOUNT_PLATFORMS, ACCOUNT_STATUSES, ACCOUNT_TYPES } from "@/types/domain";
import type { TradingAccountRow } from "@/types/database-helpers";

interface AccountFormProps {
  account?: TradingAccountRow;
}

export function AccountForm({ account }: AccountFormProps) {
  return (
    <form action={saveAccount} className="grid gap-4 sm:grid-cols-2">
      {account ? <input type="hidden" name="id" value={account.id} /> : null}
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`name-${account?.id ?? "new"}`}>Account name</Label>
        <Input id={`name-${account?.id ?? "new"}`} name="name" defaultValue={account?.name} placeholder="100K Demo Practice" required />
        <p className="text-xs text-muted-foreground">Use a name that clearly distinguishes this account from your other accounts.</p>
      </div>
      <div className="space-y-2">
        <Label>Account type</Label>
        <Select name="accountType" defaultValue={account?.account_type ?? "DEMO"}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACCOUNT_TYPES.map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Platform</Label>
        <Select name="platform" defaultValue={account?.platform ?? "OTHER"}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACCOUNT_PLATFORMS.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`broker-${account?.id ?? "new"}`}>Broker or firm</Label>
        <Input id={`broker-${account?.id ?? "new"}`} name="brokerName" defaultValue={account?.broker_name ?? ""} placeholder="Optional" />
      </div>
      <div className="space-y-2">
        <Label>Status</Label>
        <Select name="status" defaultValue={account?.status ?? "ACTIVE"}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACCOUNT_STATUSES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`currency-${account?.id ?? "new"}`}>Account currency</Label>
        <Input id={`currency-${account?.id ?? "new"}`} name="currencyCode" defaultValue={account?.currency_code ?? "USD"} minLength={3} maxLength={3} required />
        <p className="text-xs text-muted-foreground">Three-letter ISO 4217 code, such as USD, EUR, GBP, or JPY.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`precision-${account?.id ?? "new"}`}>Currency decimal places</Label>
        <Input id={`precision-${account?.id ?? "new"}`} name="currencyPrecision" type="number" min={0} max={20} defaultValue={account?.currency_precision ?? 2} required />
        <p className="text-xs text-muted-foreground">Controls final money normalization; it does not control price precision.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`balance-${account?.id ?? "new"}`}>Starting balance</Label>
        <Input id={`balance-${account?.id ?? "new"}`} name="startingBalance" inputMode="decimal" defaultValue={account?.starting_balance ?? "100000.00"} required />
        <p className="text-xs text-muted-foreground">The account balance before any tracked trades or adjustments.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`leverage-${account?.id ?? "new"}`}>Leverage</Label>
        <Input id={`leverage-${account?.id ?? "new"}`} name="leverage" inputMode="decimal" defaultValue={account?.leverage ?? ""} placeholder="For example, 100" />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`started-${account?.id ?? "new"}`}>Started date</Label>
        <Input id={`started-${account?.id ?? "new"}`} name="startedAt" type="date" defaultValue={account?.started_at ?? new Date().toISOString().slice(0, 10)} required />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`notes-${account?.id ?? "new"}`}>Notes</Label>
        <Textarea id={`notes-${account?.id ?? "new"}`} name="notes" defaultValue={account?.notes ?? ""} placeholder="Optional account context" />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit">{account ? "Save account" : "Create account"}</Button>
      </div>
    </form>
  );
}
