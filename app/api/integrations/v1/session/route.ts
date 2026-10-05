import { getIntegrationContext } from "@/services/integrations/actor-context";
import { integrationErrorResponse } from "@/lib/integrations/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { actor } = await getIntegrationContext(request, "MT5");
    return Response.json({ version: "v1", actor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return integrationErrorResponse(error); }
}
