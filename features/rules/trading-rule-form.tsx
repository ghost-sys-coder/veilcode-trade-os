import { randomUUID } from "node:crypto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveTradingRule } from "@/features/rules/actions";
import { RULE_TYPES } from "@/types/domain";
import type { TradingAccountRow, TradingRuleRow } from "@/types/database-helpers";

interface TradingRuleFormProps {
  accounts: TradingAccountRow[];
  rule?: TradingRuleRow;
}

const ruleTypeItems = RULE_TYPES.map((value) => ({
  label: value.replaceAll("_", " "),
  value,
}));

export function TradingRuleForm({ accounts, rule }: TradingRuleFormProps) {
  const accountItems = [
    { label: "All accounts", value: "ALL" },
    ...accounts.map((account) => ({ label: account.name, value: account.id })),
  ];

  return (
    <form action={saveTradingRule} className="space-y-4">
      <input type="hidden" name="operationId" value={randomUUID()} />
      {rule ? <input type="hidden" name="expectedVersion" value={Number.isSafeInteger(rule.record_version) ? String(rule.record_version) : ""} /> : null}
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
      <div className="space-y-2">
        <Label htmlFor={`rule-name-${rule?.id ?? "new"}`}>Rule name</Label>
        <Input id={`rule-name-${rule?.id ?? "new"}`} name="name" defaultValue={rule?.name} placeholder="Maximum risk per trade" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`rule-description-${rule?.id ?? "new"}`}>Description</Label>
        <Textarea id={`rule-description-${rule?.id ?? "new"}`} name="description" defaultValue={rule?.description ?? ""} placeholder="Explain exactly what following this rule means." required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Rule type</Label>
          <Select name="ruleType" defaultValue={rule?.rule_type ?? "DESCRIPTIVE"} items={ruleTypeItems}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{RULE_TYPES.map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Account scope</Label>
          <Select name="accountId" defaultValue={rule?.account_id ?? "ALL"} items={accountItems}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All accounts</SelectItem>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`rule-limit-${rule?.id ?? "new"}`}>Numeric limit</Label>
        <Input id={`rule-limit-${rule?.id ?? "new"}`} name="numericLimit" inputMode="decimal" defaultValue={rule?.numeric_limit ?? ""} placeholder="Optional" />
        <p className="text-xs text-muted-foreground">Use this only when the rule has a measurable threshold, such as 1% risk or three trades.</p>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/35 p-4">
        <div><Label htmlFor={`rule-active-${rule?.id ?? "new"}`}>Active</Label><p className="text-xs text-muted-foreground">Only active rules are reviewed against new trades.</p></div>
        <Switch id={`rule-active-${rule?.id ?? "new"}`} name="active" defaultChecked={rule?.active ?? true} />
      </div>
      <Button type="submit" className="w-full sm:w-auto" disabled={Boolean(rule?.archived_at)}>{rule?.archived_at ? "Archived rule" : rule ? "Save rule" : "Create rule"}</Button>
    </form>
  );
}
