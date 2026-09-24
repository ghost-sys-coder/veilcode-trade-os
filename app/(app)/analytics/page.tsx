import { redirect } from "next/navigation";

import { parseAnalyticsFilters, serializeAnalyticsFilters, type RawSearchParams } from "@/features/analytics/query";

export default async function AnalyticsIndexPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const query = serializeAnalyticsFilters(parseAnalyticsFilters(await searchParams));
  redirect(`/analytics/overview${query ? `?${query}` : ""}`);
}
