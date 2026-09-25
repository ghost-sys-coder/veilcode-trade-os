import type { BehavioralComparison, BehavioralGroup } from "@/domain/analytics/behavior";

export function comparisonsToGroups(comparisons: BehavioralComparison[]): BehavioralGroup[] {
  return comparisons.flatMap((item) => [{ ...item.withBehavior, description: item.description }, item.withoutBehavior]);
}
