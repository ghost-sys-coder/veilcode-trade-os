import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    return NextResponse.json(
      { authenticated: !error && Boolean(data?.claims?.sub) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { authenticated: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
