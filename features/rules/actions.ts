"use server";

import { revalidatePath } from "next/cache";

import { tradingRuleSchema } from "@/domain/validation/schemas";
import { firstValidationError, redirectWithStatus } from "@/lib/action-errors";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveTradingRule(formData: FormData): Promise<void> {
  const result = tradingRuleSchema.safeParse({
    id: formData.get("id") ?? "",
    accountId:
      formData.get("accountId") === "ALL" ? "" : formData.get("accountId") ?? "",
    name: formData.get("name"),
    description: formData.get("description"),
    ruleType: formData.get("ruleType"),
    numericLimit: formData.get("numericLimit") ?? "",
    active: formData.get("active") === "on",
  });

  if (!result.success) {
    redirectWithStatus("/rules", "error", firstValidationError(result.error));
  }

  const userId = await requireUserId();
  const supabase = await createClient();
  const values = result.data;
  const payload = {
    account_id: values.accountId ?? null,
    name: values.name,
    description: values.description,
    rule_type: values.ruleType,
    numeric_limit: values.numericLimit ?? null,
    active: values.active,
    is_example: false,
  };
  if (values.id) {
    const { data, error } = await supabase
      .from("trading_rules")
      .update(payload)
      .eq("id", values.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      redirectWithStatus("/rules", "error", error.message);
    }

    if (!data) {
      redirectWithStatus("/rules", "error", "Trading rule not found or no longer available.");
    }
  } else {
    const { error } = await supabase
      .from("trading_rules")
      .insert({ ...payload, user_id: userId });

    if (error) {
      redirectWithStatus("/rules", "error", error.message);
    }
  }

  revalidatePath("/rules");
  revalidatePath("/dashboard");
  redirectWithStatus("/rules", "message", values.id ? "Trading rule updated." : "Trading rule created.");
}
