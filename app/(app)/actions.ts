"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // Workspace logout must not terminate separately consented MT5/MCP sessions.
  // Those are revoked explicitly through Settings -> Integrations.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
