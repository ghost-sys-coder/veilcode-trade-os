"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { decideDeletion, resumeDeletion } from "@/services/application/deletions";

export async function decideDeletionRequest(form: FormData): Promise<void> {
  const requestId = z.string().uuid().parse(form.get("requestId")); let result = "failed";
  try {
    const context = await getVerifiedBrowserContext(await createClient());
    const response = await decideDeletion(context, { operationId: form.get("operationId"), requestId,
      expectedVersion: form.get("expectedVersion"), decision: form.get("decision"), acknowledged: form.get("acknowledged") === "true" });
    result = response.request.status === "APPROVED" ? "approved" : "rejected";
  } catch { /* Fixed statuses only; never database/provider errors. */ }
  const path = `/settings/integrations/deletions/${requestId}`;
  revalidatePath(path); redirect(`${path}?result=${result}`);
}
export async function resumeDeletionRequest(form: FormData): Promise<void> {
  const requestId = z.string().uuid().parse(form.get("requestId")); let result = "purge-pending";
  try {
    const context = await getVerifiedBrowserContext(await createClient());
    const response = await resumeDeletion(context, { requestId });
    if (response.status === "DELETED") result = "deleted";
  } catch { /* Committed removal remains pending, not falsely completed. */ }
  const path = `/settings/integrations/deletions/${requestId}`;
  revalidatePath(path); revalidatePath("/trades"); redirect(`${path}?result=${result}`);
}
