import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Mt5PreviewPage from "@/app/(app)/settings/integrations/mt5/[connectionId]/page";

const { getPreview } = vi.hoisted(() => ({ getPreview: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUserId: async () => "owner" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/services/mt5/onboarding", () => ({ getMt5OnboardingPreview: getPreview, Mt5OnboardingError: class extends Error {} }));
vi.mock("@/features/integrations/mt5-publication-form", () => ({ Mt5PublicationForm: () => null }));
vi.mock("@/features/integrations/mt5-symbol-mapping-form", () => ({ Mt5SymbolMappingForm: () => null }));
vi.mock("@/features/integrations/mt5-cash-onboarding-forms", () => ({
  Mt5CashClassificationForm: () => null,
  Mt5OnboardingApprovalForm: () => createElement("form", { "aria-label": "Approve current snapshot" }),
}));
vi.mock("@/features/integrations/mt5-review-forms", () => ({
  Mt5SourceReviewForm:()=>null,Mt5ManualReviewForm:()=>null,Mt5AutomaticPolicyForm:()=>null,Mt5CashReconciliationForm:()=>null,
}));

const connectionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const createdAt = "2026-10-07T15:20:40.495176+00:00";

async function render(state: "APPROVED_SNAPSHOT" | "STALE_APPROVAL" | null) {
  vi.stubEnv("TRADE_OS_INTEGRATION_ORIGIN", "https://trade.example");
  vi.stubEnv("TRADE_OS_MT5_ENABLED", "true");
  getPreview.mockResolvedValue({
    accountName: "Demo", connection: { id: connectionId, version: "18", status: "ACTIVE",
      identity: { server: "Broker-Demo", login: "123", currencyPrecision: 2 } },
    snapshotToken: "a".repeat(64), ledgerToken: "b".repeat(64), onboardingReady: true,
    onboardingApproval: state ? { state, createdAt } : null,
    symbolMappings: [], instruments: [], cashDecisions: [], adjustments: [], sources: [],manualDecisions:[],existingTrades:[],automaticPublicationEnabled:false,
    preview: { episodes: [], problems: [], unresolvedCash: [], cashMovements: [],
      bridge: { currencyCode: "USD", openingBaseline: "100000.00", ledgerBalance: "102032.53",
        proposedClosedPnlChange: "0.00", openTradeRecognizedCash: "0.00", proposedBrokerBalanceBasis: "102032.53",
        brokerBalance: "102032.53", brokerEquity: "102032.53", unexplainedDifference: "0.00" } },
  });
  return renderToStaticMarkup(await Mt5PreviewPage({ params: Promise.resolve({ connectionId }), searchParams: Promise.resolve({}) }));
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("MT5 snapshot approval display", () => {
  it("shows recorded approval without contradictory instructions or a duplicate approval form", async () => {
    const html = await render("APPROVED_SNAPSHOT");
    expect(html).toContain(`Captured-history snapshot approved at ${createdAt}`);
    expect(html).toContain("Captured-history onboarding is approved for this snapshot.");
    expect(html).not.toContain("Explicit onboarding approval is still required.");
    expect(html).not.toContain('aria-label="Approve current snapshot"');
    expect(html).toContain("This does not resume a paused collector or enable unattended publication.");
  });
  it.each(["STALE_APPROVAL", null] as const)("requires explicit review for %s, even with a zero bridge", async state => {
    const html = await render(state);
    expect(html).toContain("Explicit onboarding approval is still required.");
    expect(html).toContain('aria-label="Approve current snapshot"');
    expect(html).not.toContain("Captured-history onboarding is approved for this snapshot.");
    if (state === "STALE_APPROVAL") expect(html).toContain("Previous onboarding approval is stale.");
  });
});
