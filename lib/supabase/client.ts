"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getBrowserSupabaseConfig } from "@/config/env";
import type { Database } from "@/types/database";

export function createClient() {
  const { url, publishableKey } = getBrowserSupabaseConfig();

  return createBrowserClient<Database>(url, publishableKey);
}
