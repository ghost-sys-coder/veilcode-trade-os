import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { claudeDesktopDistribution } from "@/domain/integrations/claude-desktop-distribution";
import { downloadSetupConfiguration, readSetupState } from "@/services/integrations/setup-profiles";
import type { IntegrationDatabase } from "@/types/integration-database";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ profileId: string }> }) {
  const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };
  try {
    const distribution = claudeDesktopDistribution(process.env);
    if (!distribution) throw Error("DISABLED");
    const { profileId } = await context.params;
    const client = await createClient() as SupabaseClient<IntegrationDatabase>;
    const state = await readSetupState(client);
    if (!state.desktopEnabled || !state.profiles.some(p => p.id === profileId && p.clientKind === "CLAUDE_DESKTOP")) throw Error("UNAVAILABLE");
    await downloadSetupConfiguration(client, profileId); // Repeat live owner/resource/provider-binding checks.
    return new Response(null, { status: 302, headers: { ...headers, Location: distribution.url } });
  } catch { return Response.json({ error: "DESKTOP_EXTENSION_UNAVAILABLE" }, { status: 403, headers }); }
}
