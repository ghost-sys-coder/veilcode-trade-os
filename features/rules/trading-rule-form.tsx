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

export function TradingRuleForm({ accounts, rule }: TradingRuleFormProps) {
  return (
    <form action={saveTradingRule} className="space-y-4">
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
          <Select name="ruleType" defaultValue={rule?.rule_type ?? "DESCRIPTIVE"}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{RULE_TYPES.map((value) => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Account scope</Label>
          <Select name="accountId" defaultValue={rule?.account_id ?? "ALL"}>
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
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div><Label htmlFor={`rule-active-${rule?.id ?? "new"}`}>Active</Label><p className="text-xs text-muted-foreground">Only active rules are reviewed against new trades.</p></div>
        <Switch id={`rule-active-${rule?.id ?? "new"}`} name="active" defaultChecked={rule?.active ?? true} />
      </div>
      <Button type="submit">{rule ? "Save rule" : "Create rule"}</Button>
    </form>
  );
}
