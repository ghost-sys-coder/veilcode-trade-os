"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

function loginRedirect(kind: "error" | "message", message: string): never {
  redirect(`/login?${kind}=${encodeURIComponent(message)}`);
}

export async function signIn(formData: FormData): Promise<void> {
  const result = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    loginRedirect("error", "Enter a valid email and a password of at least 8 characters.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(result.data);

  if (error) {
    loginRedirect("error", error.message);
  }

  redirect("/dashboard");
}

export async function signUp(formData: FormData): Promise<void> {
  const result = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    loginRedirect("error", "Enter a valid email and a password of at least 8 characters.");
  }

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...result.data,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    loginRedirect("error", error.message);
  }

  if (data.session) {
    redirect("/dashboard");
  }

  loginRedirect("message", "Check your email to confirm your account.");
}
