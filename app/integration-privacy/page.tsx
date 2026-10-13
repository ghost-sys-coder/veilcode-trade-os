import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Integration data handling | Trade OS" };
export default function IntegrationPrivacyPage() {
  return <main className="mx-auto w-full max-w-3xl space-y-6 px-5 py-12 text-foreground">
    <p className="text-xs font-semibold uppercase tracking-widest text-primary">Trade OS · secure connections</p>
    <h1 className="text-3xl font-semibold tracking-tight">Integration data handling</h1>
    <div className="space-y-5 rounded-xl border border-border/70 bg-card p-5 text-sm leading-7 surface-shadow">
      <p>The Trade OS Windows extension connects your selected AI client to the Trade OS application resource shown during setup. After your browser consent, the client can request your application records and invoke authorized workflows, including normal writes. Information returned to that client is subject to that client provider’s data-handling terms.</p>
      <p>Public setup downloads contain identifiers and connection URLs, not credentials. Renewable authorization credentials are stored separately using Windows-protected local storage. The extension reads its selected public setup and companion installation files, verifies the pinned release, and launches the existing adapter. It does not request broker passwords or AI-provider API keys.</p>
      <p>Trade OS stores configuration, connection and mutation audit evidence to support ownership, recovery and accountability. Permanent deletion requires a separate one-use browser confirmation; correction and financial audit history cannot be deleted through MCP. Broker order placement, arbitrary SQL and shell execution are not exposed.</p>
      <p>You can revoke each connection in Settings → Integrations. Closing the companion window or uninstalling the extension is not equivalent to revoking application access. Imported application records and audit history are preserved when an integration is disabled or revoked.</p>
      <p>The current Windows companion and Desktop extension are unsigned previews. Downloads and updates are explicit. A future move to a VPS or another Windows user requires destination authorization; do not copy protected credential stores.</p>
    </div>
    <Link href="/settings/integrations" className="text-sm font-semibold text-primary hover:underline">Manage your connections</Link>
  </main>;
}
