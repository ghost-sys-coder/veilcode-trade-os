import { z } from "zod";

const supabaseConfigSchema = z.object({
  url: z.string().url(),
  publishableKey: z.string().min(20),
});

export function getSupabaseConfig() {
  return supabaseConfigSchema.parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY,
  });
}

export function getBrowserSupabaseConfig() {
  return supabaseConfigSchema.parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
