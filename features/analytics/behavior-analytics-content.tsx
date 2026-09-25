import type { BehavioralAnalytics } from "@/domain/analytics/behavior";
import { ExecutionBehaviorView } from "@/features/analytics/execution-behavior-view";
import type { AnalyticsView } from "@/features/analytics/analytics-navigation";
import { MistakesBehaviorView } from "@/features/analytics/mistakes-behavior-view";
import { PsychologyBehaviorView } from "@/features/analytics/psychology-behavior-view";
import { RulesBehaviorView } from "@/features/analytics/rules-behavior-view";

export function BehaviorAnalyticsContent({ analytics, view }: { analytics: BehavioralAnalytics; view: AnalyticsView }) {
  if (view === "execution") return <ExecutionBehaviorView analytics={analytics} />;
  if (view === "rules") return <RulesBehaviorView analytics={analytics} />;
  if (view === "psychology") return <PsychologyBehaviorView analytics={analytics} />;
  return <MistakesBehaviorView analytics={analytics} />;
}
