import { getIntegrationContext } from "@/services/integrations/actor-context";
import { getCollectorMt5Pairing } from "@/services/integrations/mt5-pairing";
import { integrationErrorResponse } from "@/lib/integrations/http";
export const runtime = "nodejs";
export async function GET(request: Request, {params}: {params: Promise<{profileId: string}>}) {
  try {
    const context = await getIntegrationContext(request, "MT5");
    return Response.json(await getCollectorMt5Pairing(context, (await params).profileId), {headers: {"Cache-Control": "no-store"}});
  } catch (error) { return integrationErrorResponse(error); }
}
