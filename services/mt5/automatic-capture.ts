import "server-only";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { verifiedIntegrationClaims, type IntegrationContext } from "@/services/integrations/actor-context";
import { publicationDatabaseConfig } from "@/services/integrations/publication-database-config";
import { captureInputSchema, captureResultSchema, integrationDatabaseError } from "@/domain/mt5/protocol";
import { mt5ConnectionViewSchema, mt5StoredSourceSchema } from "@/domain/mt5/onboarding";
import { mt5SymbolMappingSchema } from "@/domain/mt5/symbol-mapping";
import { mt5ManualDecisionSchema } from "@/domain/mt5/review";
import { prepareAutomaticMt5Publication } from "@/domain/mt5/automatic-publication";

const snapshotSchema = z.object({ connection: mt5ConnectionViewSchema, sources: z.array(mt5StoredSourceSchema),
  startingBalance: z.string(), ledgerBalance: z.string(), snapshotToken: z.string(), ledgerToken: z.string(),
  instruments: z.array(z.object({ id: z.string().uuid(), symbol: z.string() })), symbolMappings: z.array(mt5SymbolMappingSchema),
  manualDecisions: z.array(mt5ManualDecisionSchema), publishedExecutions: z.array(z.object({ identity: z.string(), execution: z.unknown() })),
  existingTrades: z.array(z.object({ id: z.string().uuid(), symbol: z.string(), direction: z.enum(["BUY","SELL"]),
    openedAt: z.string().nullable(), closedAt: z.string().nullable(), canonicalIdentity: z.string().nullable(),
    closedNetPnl: z.string().nullable(), reviewToken: z.string() })),
});

/** Staging, completed-collection publication and receipts share one transaction. */
export async function captureAndPublishMt5(context: IntegrationContext, data: z.infer<typeof captureInputSchema>) {
  const claims = verifiedIntegrationClaims(context);
  const database = new Client(publicationDatabaseConfig(process.env));
  try {
    await database.connect(); await database.query("begin");
    await database.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
    const capture = await database.query("select private.mt5_capture($1,$2::uuid,$3::uuid,$4,$5::uuid,$6::jsonb,$7::text,$8::jsonb,$9::jsonb) as result",
      [context.actor.resource,data.connectionId,data.workerId,data.fencingToken,data.operationId,JSON.stringify(data.identity),
        data.checkpoint,JSON.stringify(data.events),JSON.stringify(data.collection)]);
    const result = captureResultSchema.parse(capture.rows[0].result);
    if (result.status === "STAGED" && result.collectionComplete) {
      const operationId = childOperationId(data.operationId);
      const operationRequest = { connectionId:data.connectionId, operationId, workerId:data.workerId,
        fencingToken:data.fencingToken, captureOperationId:data.operationId };
      const prior = await database.query("select private.integration_operation_result(private.authorize_integration($1,'MT5'),$2::uuid,'MT5_AUTOPUBLICATION',$3::jsonb) as result",
        [context.actor.resource,operationId,JSON.stringify(operationRequest)]);
      if (prior.rows[0].result == null) {
        const read = await database.query("select private.mt5_automatic_snapshot($1::jsonb) as result", [JSON.stringify(operationRequest)]);
        if (read.rows[0].result != null) {
          const snapshot = snapshotSchema.parse(read.rows[0].result);
          const proposal = prepareAutomaticMt5Publication(snapshot,operationId);
          if (proposal) {
            const request = { ...operationRequest,operationRequest,version:snapshot.connection.version,
              snapshotToken:snapshot.snapshotToken,ledgerToken:snapshot.ledgerToken,openingBaseline:snapshot.startingBalance,
              reason:"Unattended publication under the explicitly approved account policy",
              episodeIdentities:proposal.episodes.map(item => item.canonicalIdentity) };
            await database.query("select private.mt5_publish_execution($1::jsonb,$2::jsonb)",[JSON.stringify(request),JSON.stringify(proposal)]);
          }
        }
      }
    }
    await database.query("commit"); return result;
  } catch (error) {
    await database.query("rollback").catch(() => {});
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    throw integrationDatabaseError(code);
  } finally { await database.end().catch(() => {}); }
}

function childOperationId(parent: string) {
  const hex = createHash("sha256").update(`trade-os:mt5-publication:v1:${parent}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
