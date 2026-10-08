import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/types/database";
import {getVerifiedBrowserContext} from "@/services/integrations/browser-context";
import {queryPerformance} from "@/services/application/reporting";
import type {AnalyticsFilters} from "@/domain/reporting/performance";
export * from "@/domain/reporting/performance";
export async function getPerformanceAnalytics(supabase:SupabaseClient<Database>,filters:AnalyticsFilters={}) {
  return queryPerformance(await getVerifiedBrowserContext(supabase),{filters});
}
