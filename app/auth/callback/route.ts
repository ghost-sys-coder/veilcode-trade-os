import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safePostAuthRedirect } from "@/lib/safe-redirect";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safePostAuthRedirect(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=Unable%20to%20confirm%20your%20account.", requestUrl.origin));
}
