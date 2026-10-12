"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth";
import { createSetupProfile, reconcileSetupProfile, IntegrationSetupError } from "@/services/integrations/setup-profiles";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";

export type SetupActionState = { message: string; profileId: string | null; ready: boolean };
function message(error: unknown) {
  const code = error instanceof IntegrationSetupError ? error.code : "UNAVAILABLE";
  return ({ DISABLED: "Setup is disabled for this integration. No connection was started.",
    NOT_CONFIGURED: "Connection provisioning is not configured. No registration was attempted.",
    CONFLICT: "This setup changed. Reload its current state before continuing.",
    LIMIT: "The setup-profile limit was reached. Existing profiles and audit evidence are preserved.",
    NOT_READY: "Registration must be verified before configuration is available.",
    UNAVAILABLE: "Setup could not be completed safely. Check the saved profile before retrying an uncertain registration." })[code];
}
export async function prepareIntegrationSetup(_previous: SetupActionState, form: FormData): Promise<SetupActionState> {
  await requireUserId();
  try {
    const client = await createClient() as SupabaseClient<IntegrationDatabase>;
    const profile = await createSetupProfile(client, { operationId: form.get("operation_id"),
      clientKind: form.get("client_kind"), accountId: form.get("account_id") || null });
    revalidatePath("/settings/integrations");
    return { profileId: profile.id, ready: profile.status === "READY", message: profile.status === "READY"
      ? "Public configuration prepared. Installation, consent and connection verification are still required."
      : "Registration response is uncertain. Open the saved setup and check registration; do not create it again." };
  } catch(error) { return { profileId: null, ready: false, message: message(error) }; }
}
export async function checkIntegrationSetup(_previous: SetupActionState, form: FormData): Promise<SetupActionState> {
  await requireUserId();
  try {
    const profile = await reconcileSetupProfile(await createClient() as SupabaseClient<IntegrationDatabase>,
      { id: form.get("profile_id"), version: form.get("version") });
    revalidatePath(`/settings/integrations/setup/${profile.id}`);
    return { profileId: profile.id, ready: profile.status === "READY", message: profile.status === "READY"
      ? "Public registration verified. This does not grant application access."
      : "No matching provider registration is visible yet. No additional registration request was sent." };
  } catch(error) { return { profileId: null, ready: false, message: message(error) }; }
}
