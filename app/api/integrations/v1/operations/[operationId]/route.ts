import { getIntegrationContext } from "@/services/integrations/actor-context";
import { getIntegrationOperation } from "@/services/integrations/operation-status";
import { integrationErrorResponse } from "@/lib/integrations/http";

export const runtime = "nodejs";
export async function GET(request: Request,{ params }: { params: Promise<{ operationId: string }> }) {
  try {
    const context = await getIntegrationContext(request,"MT5");
    const result = await getIntegrationOperation(context,(await params).operationId);
    return Response.json(result,{ headers: { "Cache-Control": "no-store" } });
  } catch (error) { return integrationErrorResponse(error); }
}
