"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { safeInternalRedirect } from "@/lib/safe-redirect";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

function loginRedirect(kind: "error" | "message", message: string, next?: string): never {
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";
  redirect(`/login?${kind}=${encodeURIComponent(message)}${nextQuery}`);
}

export async function signIn(formData: FormData): Promise<void> {
  const next = safeInternalRedirect(formData.get("next"));
  const result = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    loginRedirect("error", "Enter a valid email and a password of at least 8 characters.", next);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(result.data);

  if (error) {
    loginRedirect("error", error.message, next);
  }

  redirect(next);
}

export async function signUp(formData: FormData): Promise<void> {
  const next = safeInternalRedirect(formData.get("next"));
  const result = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    loginRedirect("error", "Enter a valid email and a password of at least 8 characters.", next);
  }

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...result.data,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error) {
    loginRedirect("error", error.message, next);
  }

  if (data.session) {
    redirect(next);
  }

  loginRedirect("message", "Check your email to confirm your account.", next);
}
