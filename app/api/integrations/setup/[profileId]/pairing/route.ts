import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationDatabase } from "@/types/integration-database";
import { createClient } from "@/lib/supabase/server";
import { downloadMt5Pairing } from "@/services/integrations/mt5-pairing";
export const runtime = "nodejs";
export async function GET(_request: Request, {params}: {params: Promise<{profileId: string}>}) {
  try {
    const id = (await params).profileId;
    const manifest = await downloadMt5Pairing(await createClient() as SupabaseClient<IntegrationDatabase>, id);
    return Response.json(manifest, {headers: {"Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="tradeos-mt5-mapping.json"'}});
  } catch { return Response.json({error: "PAIRING_UNAVAILABLE"}, {status: 403, headers: {"Cache-Control": "no-store"}}); }
}
