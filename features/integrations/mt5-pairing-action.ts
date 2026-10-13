"use server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { approveMt5SetupPairing } from "@/services/integrations/mt5-pairing";
export async function approvePairingAction(_previous: {message: string; ready: boolean}, form: FormData) {
  await requireUserId();
  try {
    const text = form.get("proposal");
    if (typeof text !== "string" || new TextEncoder().encode(text).length > 8192) throw Error();
    await approveMt5SetupPairing(await createClient() as SupabaseClient<IntegrationDatabase>, {
      profileId: form.get("profile_id"), profileVersion: form.get("profile_version"), operationId: form.get("operation_id"),
      proposal: JSON.parse(text), connectionVersion: form.get("connection_version") || null,
      confirmed: form.get("confirmed") === "on", reason: form.get("reason"),
    });
    revalidatePath("/settings/integrations/setup/" + form.get("profile_id"));
    revalidatePath("/settings/integrations");
    return {ready: true, message: "Mapping approved. Import the approved mapping into the companion; it initializes PAUSED. No collection or publication was started."};
  } catch {
    return {ready: false, message: "Pairing could not be approved. Reload the saved setup after an uncertain response. Check active access, the recent demo proposal and the paused existing collector before retrying."};
  }
}
