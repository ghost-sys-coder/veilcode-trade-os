"use server";

import { revalidatePath } from "next/cache";

import { setupSchema, strategySchema } from "@/domain/validation/schemas";
import { firstValidationError, redirectWithStatus } from "@/lib/action-errors";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveStrategy(formData: FormData): Promise<void> {
  const result = strategySchema.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    active: formData.get("active") === "on",
  });

  if (!result.success) {
    redirectWithStatus("/strategies", "error", firstValidationError(result.error));
  }

  const userId = await requireUserId();
  const supabase = await createClient();
  const values = result.data;
  const payload = {
    name: values.name,
    description: values.description ?? null,
    active: values.active,
    is_example: false,
  };
  if (values.id) {
    const { data, error } = await supabase
      .from("strategies")
      .update(payload)
      .eq("id", values.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      redirectWithStatus("/strategies", "error", error.message);
    }

    if (!data) {
      redirectWithStatus("/strategies", "error", "Strategy not found or no longer available.");
    }
  } else {
    const { error } = await supabase
      .from("strategies")
      .insert({ ...payload, user_id: userId });

    if (error) {
      redirectWithStatus("/strategies", "error", error.message);
    }
  }

  revalidatePath("/strategies");
  revalidatePath("/dashboard");
  redirectWithStatus("/strategies", "message", values.id ? "Strategy updated." : "Strategy created.");
}

export async function saveSetup(formData: FormData): Promise<void> {
  const result = setupSchema.safeParse({
    id: formData.get("id") ?? "",
    strategyId: formData.get("strategyId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    active: formData.get("active") === "on",
  });

  if (!result.success) {
    redirectWithStatus("/strategies", "error", firstValidationError(result.error));
  }

  const userId = await requireUserId();
  const supabase = await createClient();
  const values = result.data;
  const payload = {
    strategy_id: values.strategyId,
    name: values.name,
    description: values.description ?? null,
    active: values.active,
  };
  if (values.id) {
    const { data, error } = await supabase
      .from("setups")
      .update(payload)
      .eq("id", values.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();

    if (error) {
      redirectWithStatus("/strategies", "error", error.message);
    }

    if (!data) {
      redirectWithStatus("/strategies", "error", "Setup not found or no longer available.");
    }
  } else {
    const { error } = await supabase
      .from("setups")
      .insert({ ...payload, user_id: userId });

    if (error) {
      redirectWithStatus("/strategies", "error", error.message);
    }
  }

  revalidatePath("/strategies");
  revalidatePath("/dashboard");
  redirectWithStatus("/strategies", "message", values.id ? "Setup updated." : "Setup created.");
}
