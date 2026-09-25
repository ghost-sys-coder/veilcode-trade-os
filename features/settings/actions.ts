"use server";

import { revalidatePath } from "next/cache";

import { profileSettingsSchema } from "@/domain/validation/schemas";
import { firstValidationError, redirectWithStatus } from "@/lib/action-errors";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveProfileSettings(formData: FormData): Promise<void> {
  const result = profileSettingsSchema.safeParse({
    displayName: formData.get("displayName") ?? "",
    timezone: formData.get("timezone"),
  });
  if (!result.success) {
    redirectWithStatus("/settings", "error", firstValidationError(result.error));
  }

  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({
    display_name: result.data.displayName ?? null,
    timezone: result.data.timezone,
  }).eq("id", userId).select("id").maybeSingle();

  if (error) redirectWithStatus("/settings", "error", error.message);
  if (!data) redirectWithStatus("/settings", "error", "Profile settings are unavailable.");

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirectWithStatus("/settings", "message", "Workspace settings updated.");
}
