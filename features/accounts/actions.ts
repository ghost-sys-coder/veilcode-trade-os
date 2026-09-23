"use server";

import { revalidatePath } from "next/cache";

import { tradingAccountSchema } from "@/domain/validation/schemas";
import { firstValidationError, redirectWithStatus } from "@/lib/action-errors";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveAccount(formData: FormData): Promise<void> {
  const result = tradingAccountSchema.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name"),
    accountType: formData.get("accountType"),
    brokerName: formData.get("brokerName") ?? "",
    platform: formData.get("platform"),
    currencyCode: formData.get("currencyCode"),
    currencyPrecision: formData.get("currencyPrecision"),
    startingBalance: formData.get("startingBalance"),
    leverage: formData.get("leverage") ?? "",
    startedAt: formData.get("startedAt"),
    status: formData.get("status"),
    notes: formData.get("notes") ?? "",
  });

  if (!result.success) {
    redirectWithStatus("/accounts", "error", firstValidationError(result.error));
  }

  const userId = await requireUserId();
  const supabase = await createClient();
  const values = result.data;
  const payload = {
    name: values.name,
    account_type: values.accountType,
    broker_name: values.brokerName ?? null,
    platform: values.platform,
    currency_code: values.currencyCode,
    currency_precision: values.currencyPrecision,
    starting_balance: values.startingBalance,
    leverage: values.leverage ?? null,
    started_at: values.startedAt,
    status: values.status,
    notes: values.notes ?? null,
  };

  if (values.id) {
    const { data, error } = await supabase
      .from("trading_accounts")
      .update(payload)
      .eq("id", values.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      redirectWithStatus("/accounts", "error", error.message);
    }

    if (!data) {
      redirectWithStatus("/accounts", "error", "Account not found or no longer available.");
    }
  } else {
    const { error } = await supabase
      .from("trading_accounts")
      .insert({ ...payload, user_id: userId });

    if (error) {
      redirectWithStatus("/accounts", "error", error.message);
    }
  }

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  redirectWithStatus("/accounts", "message", values.id ? "Account updated." : "Account created.");
}
