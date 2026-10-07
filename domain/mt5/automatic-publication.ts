import { buildMt5OnboardingPreview } from "@/domain/mt5/onboarding";
import { prepareMt5Publication } from "@/domain/mt5/publication";

/** New executions only; ambiguous/revised facts stay staged. No reconciliation claim. */
export function prepareAutomaticMt5Publication(input: Parameters<typeof prepareMt5Publication>[0] & {
  publishedExecutions: { identity: string; execution: unknown }[];
}, operationId: string) {
  const preview = buildMt5OnboardingPreview(input);
  const identities = preview.episodes.filter(item => item.publishable).map(item => item.episode.canonicalIdentity);
  if (!identities.length) return null;
  // The bounded subset is explicit. Later captures continue remaining eligible groups.
  const candidate = prepareMt5Publication(input, {
    connectionId: input.connection.id, operationId, version: input.connection.version,
    snapshotToken: input.snapshotToken, ledgerToken: input.ledgerToken, openingBaseline: input.startingBalance,
    reason: "Unattended publication under the explicitly approved account policy", episodeIdentities: identities,
  });
  const episodes = candidate.episodes.filter(episode => {
    const current = input.publishedExecutions.find(item => item.identity === episode.canonicalIdentity);
    // Compare structured values without depending on PostgreSQL JSON key order.
    return !current || stableJson(current.execution) !== stableJson(episode);
  }).slice(0, 1000);
  return episodes.length ? { ...candidate, episodes } : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
