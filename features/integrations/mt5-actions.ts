"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { controlMt5Connection, registerMt5Connection, Mt5OnboardingError } from "@/services/mt5/onboarding";

type ActionState = { message: string; success: boolean };
export async function mapMt5Account(_previous: ActionState, form: FormData): Promise<ActionState> {
  try {
    await registerMt5Connection(await createClient(),{ grantId: form.get("grant_id"),operationId: form.get("operation_id"),identity: {
      server: form.get("server"),login: form.get("login"),terminalInstallationId: form.get("terminal_installation_id"),
      currencyCode: form.get("currency_code"),currencyPrecision: Number(form.get("currency_precision")),
      accountKind: "DEMO",positionMode: form.get("position_mode"),
    } });
  } catch {
    return { success: false,message: "Mapping failed. Check the active account-bound grant, exact demo identity, account currency and terminal ID. Existing account mappings cannot be replaced silently." };
  }
  revalidatePath("/settings/integrations");
  redirect("/settings/integrations?status=mapped");
}

export async function changeMt5State(_previous: ActionState, form: FormData): Promise<ActionState> {
  let status: "paused" | "resumed";
  try {
    const result = await controlMt5Connection(await createClient(),{ connectionId: form.get("connection_id"),version: form.get("version"),
      operationId: form.get("operation_id"),action: form.get("action"),reason: form.get("reason") });
    revalidatePath("/settings/integrations");
    revalidatePath(`/settings/integrations/mt5/${result.connectionId}`);
    status = result.status === "PAUSED" ? "paused" : "resumed";
  } catch (error) {
    return { success: false,message: error instanceof Mt5OnboardingError && error.code === "CONFLICT"
      ? "This connection changed. Reload before submitting a new control operation."
      : "Control failed. Supply a meaningful reason and check that the integration and account grant remain active." };
  }
  redirect(`/settings/integrations?status=${status}`);
}
