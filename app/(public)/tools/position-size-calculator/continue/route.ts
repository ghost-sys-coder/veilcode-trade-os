import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const destination = "/trades/new?from=position-calculator";
  return NextResponse.redirect(new URL(data?.claims?.sub ? destination : `/login?next=${encodeURIComponent(destination)}`, url.origin));
}
