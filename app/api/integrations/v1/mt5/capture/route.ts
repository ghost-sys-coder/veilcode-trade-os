import { getIntegrationContext } from "@/services/integrations/actor-context";
import { captureMt5Batch } from "@/services/mt5/capture";
import { integrationErrorResponse, readIntegrationJson } from "@/lib/integrations/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const context = await getIntegrationContext(request,"MT5");
    const result = await captureMt5Batch(context,await readIntegrationJson(request));
    return Response.json(result,{ status: result.status === "ATTENTION" ? 409 : 200,headers: { "Cache-Control": "no-store" } });
  } catch (error) { return integrationErrorResponse(error); }
}
