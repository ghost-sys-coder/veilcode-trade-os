"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { controlMt5Connection, registerMt5Connection, Mt5OnboardingError } from "@/services/mt5/onboarding";
import { publishMt5Trades } from "@/services/mt5/publication";
import { saveMt5SymbolMapping } from "@/services/mt5/symbol-mapping";

type ActionState = { message: string; success: boolean };
export async function mapMt5BrokerSymbol(_previous:ActionState,form:FormData):Promise<ActionState> {
  let connectionId:string;
  try {
    const result=await saveMt5SymbolMapping(await createClient(),{connectionId:form.get("connection_id"),operationId:form.get("operation_id"),
      version:form.get("version"),snapshotToken:form.get("snapshot_token"),brokerSymbol:form.get("broker_symbol"),
      instrumentId:form.get("instrument_id"),reason:form.get("reason")});
    connectionId=result.connectionId;
  } catch (error) {
    return {success:false,message:error instanceof Error && error.message==="MT5_PUBLICATION_REVIEW_REQUIRED"
      ? "Reload the preview and check the mapping. Published broker symbols cannot be reassigned; unavailable instruments and changed source snapshots require review."
      : "Mapping was not confirmed. Check the selected symbol, instrument, reason and active account grant. Retry the same submission to recover a committed approval."};
  }
  revalidatePath(`/settings/integrations/mt5/${connectionId}`);
  redirect(`/settings/integrations/mt5/${connectionId}?status=symbol-mapped`);
}
export async function approveMt5Publication(_previous: ActionState, form: FormData): Promise<ActionState> {
  let connectionId: string;
  try {
    if (form.get("confirm_baseline")!=="on") return { success:false,message:"Confirm the preserved opening baseline before publishing." };
    const result=await publishMt5Trades(await createClient(),{ connectionId:form.get("connection_id"),operationId:form.get("operation_id"),
      version:form.get("version"),snapshotToken:form.get("snapshot_token"),ledgerToken:form.get("ledger_token"),
      openingBaseline:form.get("opening_baseline"),reason:form.get("reason"),episodeIdentities:form.getAll("episode_identity") });
    connectionId=result.connectionId;
  } catch (error) {
    return {success:false,message:error instanceof Error && error.message==="MT5_PUBLICATION_REVIEW_REQUIRED"
      ? "This preview changed or a selected trade needs review. Reload and check the history before approving again."
      : "Publication was not confirmed. Check your selections, reason, active grant and database connection. Retry the same submission to recover a committed result."};
  }
  for (const path of ["/settings/integrations",`/settings/integrations/mt5/${connectionId}`,"/trades","/dashboard","/analytics","/calendar","/accounts"])
    revalidatePath(path);
  redirect(`/settings/integrations/mt5/${connectionId}?status=published`);
}
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
