import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/config/env";
import { PrivateFileError, assertFilePath } from "@/domain/files/commands";
import { deletionJobSchema } from "@/domain/deletions/commands";

/** Only a database-frozen, owner-bound exact job; never caller prefixes/globs. */
export async function removeDeletionObjects(input: unknown): Promise<void> {
  const job = deletionJobSchema.parse(input), { url } = getSupabaseConfig();
  const key = process.env.SUPABASE_SECRET_KEY, target = new URL(url);
  const local = process.env.TRADE_OS_LOCAL_TEST_APP === "true" && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
  if (!key || key.length < 20 || (!key.startsWith("sb_secret_") && !local) || (target.protocol !== "https:" && !local)) throw new PrivateFileError("STORAGE_NOT_CONFIGURED");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }) } });
  // Validate every path before the first irreversible side effect.
  const objects = job.objects.map(o => ({ ...o, path: assertFilePath(o.path, job.ownerId, job.tradeId) }));
  for (const bucket of ["trade-screenshots", "trade-file-staging"] as const) {
    const paths = objects.filter(o => o.bucket === bucket).map(o => o.path);
    if (!paths.length) continue;
    try { const response = await client.storage.from(bucket).remove(paths); if (response.error) throw new Error("Removal not acknowledged"); }
    catch { throw new PrivateFileError("STORAGE_UNAVAILABLE"); }
  }
}
