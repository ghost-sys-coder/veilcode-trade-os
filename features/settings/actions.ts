"use server";

import { revalidatePath } from "next/cache";

import { profilePatchSchema } from "@/domain/profile/commands";
import { patchProfile } from "@/services/application/profile";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { ApplicationWorkflowError } from "@/services/application/transaction";
import { firstValidationError, redirectWithStatus } from "@/lib/action-errors";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function saveProfileSettings(formData: FormData): Promise<void> {
  const displayName = formData.get("displayName");
  const result = profilePatchSchema.safeParse({
    operationId: formData.get("operationId"), expectedVersion: formData.get("expectedVersion"),
    values: { ...(formData.has("displayName") ? { displayName: typeof displayName === "string" && displayName.trim() === "" ? null : displayName } : {}),
      ...(formData.has("timezone") ? { timezone: formData.get("timezone") } : {}) },
  });
  if (!result.success) {
    redirectWithStatus("/settings", "error", firstValidationError(result.error));
  }

  await requireUserId();
  const supabase = await createClient();
  try { await patchProfile(await getVerifiedBrowserContext(supabase), result.data); }
  catch (error) { redirectWithStatus("/settings", "error", error instanceof ApplicationWorkflowError ? error.message : "Invalid preferences or unavailable profile. Reload before retrying."); }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/analytics", "layout");
  revalidatePath("/journal", "layout");
  revalidatePath("/trades");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath("/prop");
  redirectWithStatus("/settings", "message", "Workspace settings updated.");
}
