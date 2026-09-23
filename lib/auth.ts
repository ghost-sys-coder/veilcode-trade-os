import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims.sub) {
    return null;
  }

  return data.claims.sub;
}

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();

  if (!userId) {
    redirect("/login");
  }

  return userId;
}
