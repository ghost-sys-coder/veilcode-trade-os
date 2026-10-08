import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/types/database";
import {getVerifiedBrowserContext} from "@/services/integrations/browser-context";
import {queryBehavior} from "@/services/application/reporting";
import type {AnalyticsFilters} from "@/domain/reporting/performance";

export async function getBehaviorAnalytics(supabase:SupabaseClient<Database>,filters:AnalyticsFilters,timezone:string) {
  return queryBehavior(await getVerifiedBrowserContext(supabase),{filters,timezone});
}
