import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {applicationTransaction,ApplicationWorkflowError,type ApplicationContext} from "./transaction";
import {getIntegrationConfig} from "@/config/integrations";
import {mt5ConnectionsSchema,mt5GetSchema,mt5MatchesSchema,mt5PreviewSchema,mt5SourcesSchema,importListSchema,importGetSchema,importRowsSchema,
  connectionPageSchema,integrationRecordSchema,integrationPageSchema} from "@/domain/integrations/commands";
import {mt5ConnectionViewSchema,buildMt5OnboardingPreview} from "@/domain/mt5/onboarding";
import {decodeMt5Snapshot} from "@/domain/mt5/snapshot";
import {mt5ReviewRequestSchema} from "@/domain/mt5/review";
import {prepareMt5Review} from "@/domain/mt5/prepare-review";

export async function listMt5(context:ApplicationContext,input:unknown) {
  return connectionPageSchema.parse(await applicationTransaction(context,"INTEGRATION_READ",{action:"MT5_LIST",...mt5ConnectionsSchema.parse(input)}));
}
export async function getMt5(context:ApplicationContext,input:unknown) {
  return mt5ConnectionViewSchema.parse(await applicationTransaction(context,"INTEGRATION_READ",{action:"MT5_GET",...mt5GetSchema.parse(input)}));
}
export async function listMt5Sources(context:ApplicationContext,input:unknown) {
  return integrationPageSchema.parse(await applicationTransaction(context,"INTEGRATION_READ",{action:"MT5_SOURCES",...mt5SourcesSchema.parse(input)}));
}
export async function listMt5Matches(context:ApplicationContext,input:unknown) {
  const request=mt5MatchesSchema.parse(input);
  const snapshot=decodeMt5Snapshot(await applicationTransaction(context,"INTEGRATION_READ",{action:"MT5_SNAPSHOT",connectionId:request.connectionId}));
  const preview=buildMt5OnboardingPreview({...snapshot,startingBalance:snapshot.account.startingBalance,ledgerBalance:snapshot.account.ledgerBalance});
  const episode=preview.episodes.find(e=>e.episode.canonicalIdentity===request.canonicalIdentity);
  if(!episode)throw new ApplicationWorkflowError("NOT_FOUND");
  const decisions=snapshot.manualDecisions.filter(d=>d.canonicalIdentity===request.canonicalIdentity);
  const ids=new Set([...episode.matchingTradeIds,...decisions.map(d=>d.tradeId)]);
  const matching=snapshot.existingTrades.filter(t=>ids.has(t.id)&&(!request.afterId||t.id>request.afterId)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const records=matching.slice(0,request.limit).map(t=>({...t,decision:decisions.filter(d=>d.tradeId===t.id).at(-1)??null}));
  return {records,nextCursor:matching.length>request.limit?records.at(-1)!.id:null};
}
export async function listImports(context:ApplicationContext,input:unknown) {
  return integrationPageSchema.parse(await applicationTransaction(context,"INTEGRATION_READ",{action:"IMPORT_LIST",...importListSchema.parse(input)}));
}
export async function getImport(context:ApplicationContext,input:unknown) {
  return integrationRecordSchema.parse(await applicationTransaction(context,"INTEGRATION_READ",{action:"IMPORT_GET",...importGetSchema.parse(input)}));
}
export async function listImportRows(context:ApplicationContext,input:unknown) {
  return integrationPageSchema.parse(await applicationTransaction(context,"INTEGRATION_READ",{action:"IMPORT_ROWS",...importRowsSchema.parse(input)}));
}
const cursorSchema=z.object({connectionId:z.string().uuid(),snapshot:z.string().regex(/^[a-f0-9]{64}$/),after:z.string().min(1).max(160)}).strict();
export async function previewMt5(context:ApplicationContext,input:unknown) {
  const request=mt5PreviewSchema.parse(input);
  const snapshot=decodeMt5Snapshot(await applicationTransaction(context,"INTEGRATION_READ",{action:"MT5_SNAPSHOT",connectionId:request.connectionId}));
  const preview=buildMt5OnboardingPreview({...snapshot,startingBalance:snapshot.account.startingBalance,ledgerBalance:snapshot.account.ledgerBalance});
  const fingerprint=createHash("sha256").update(JSON.stringify({connectionId:request.connectionId,version:snapshot.connection.version,
    source:snapshot.snapshotToken,ledger:snapshot.ledgerToken,checkpoint:snapshot.connection.captureCheckpoint,preview})).digest("hex");
  let after:string|undefined;
  if(request.cursor) {
    try {
      const decoded=Buffer.from(request.cursor,"base64url");
      if(decoded.toString("base64url")!==request.cursor)throw new Error();
      const cursor=cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
      if(cursor.connectionId!==request.connectionId||cursor.snapshot!==fingerprint)throw new ApplicationWorkflowError("VERSION_CONFLICT");
      after=cursor.after;
      if(!preview.episodes.some(e=>e.episode.canonicalIdentity===after))throw new Error();
    } catch(error) {if(error instanceof ApplicationWorkflowError)throw error;throw new ApplicationWorkflowError("INVALID_REFERENCE");}
  }
  const episodes=preview.episodes.sort((a,b)=>a.episode.canonicalIdentity<b.episode.canonicalIdentity?-1:a.episode.canonicalIdentity>b.episode.canonicalIdentity?1:0);
  const matching=episodes.filter(e=>!after||e.episode.canonicalIdentity>after),records=matching.slice(0,request.limit);
  const nextCursor=matching.length>request.limit?Buffer.from(JSON.stringify({connectionId:request.connectionId,snapshot:fingerprint,after:records.at(-1)!.episode.canonicalIdentity})).toString("base64url"):null;
  // The bridge uses complete evidence, never only the episodes in this page.
  const {episodes:unused,problems,...summary}=preview;void unused;
  return {connection:snapshot.connection,account:snapshot.account,snapshotToken:snapshot.snapshotToken,ledgerToken:snapshot.ledgerToken,
    summary,totalEpisodes:episodes.length,records,nextCursor,problemCount:problems.length,problems:problems.slice(0,100),problemsTruncated:problems.length>100,
    onboardingApproval:snapshot.onboardingApproval,automaticPublicationEnabled:snapshot.automaticPublicationEnabled};
}
export async function reviewMt5(context:ApplicationContext,input:unknown) {
  if(!getIntegrationConfig("MT5").enabled)throw new ApplicationWorkflowError("ACCESS_DENIED");
  const request=mt5ReviewRequestSchema.parse(input);
  return integrationRecordSchema.parse(await applicationTransaction(context,"MT5_REVIEW_WRITE",request,
    raw=>prepareMt5Review(decodeMt5Snapshot(raw),request)));
}
