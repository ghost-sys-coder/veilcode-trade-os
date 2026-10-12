import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { downloadSetupConfiguration } from "@/services/integrations/setup-profiles";
import type { IntegrationDatabase } from "@/types/integration-database";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ profileId: string }> }) {
  const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };
  try {
    const { profileId } = await context.params;
    const file = await downloadSetupConfiguration(await createClient() as SupabaseClient<IntegrationDatabase>, profileId);
    return new Response(JSON.stringify(file.configuration, null, 2) + "\n", { headers: { ...headers,
      "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${file.filename}"` } });
  } catch { return Response.json({ error: "SETUP_CONFIGURATION_UNAVAILABLE" }, { status: 403, headers }); }
}
