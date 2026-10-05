"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { revokeConnectedGrant } from "@/services/integrations/grant-management";

export async function revokeClientAccess(formData: FormData): Promise<void> {
  let status = "failed";
  try {
    const result = await revokeConnectedGrant(await createClient(), { id: formData.get("grant_id"), version: formData.get("version") });
    status = result.providerRevocationPending ? "revoked-provider-pending" : "revoked";
  } catch { /* Only fixed, non-sensitive status values reach the browser. */ }
  revalidatePath("/settings/integrations");
  redirect(`/settings/integrations?status=${status}`);
}
