import process from "node:process";

import { assessAuthenticationMetadata, oauthIssuerForProject } from "../domain/integrations/oauth-preflight.ts";

// Read-only preflight: no login, registration, token issuance or project writes.
// Native TypeScript execution requires Node >=22.18 (the current workstation is 25).
try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw new Error("Could not load the local environment file; details suppressed.");
  }
}

async function readMetadata(url: string): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    // Bound untrusted metadata even when the server omits Content-Length.
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, body: null };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        return { status: response.status, body: null };
      }
      chunks.push(chunk.value);
    }
    try {
      return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
    } catch {
      return { status: response.status, body: null };
    }
  } catch {
    // Never print provider response bodies, tokens, project URLs or fetch errors.
    return { status: 0, body: null };
  }
}

async function main() {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!projectUrl) throw new Error("Supabase project URL is not configured.");
  const issuer = oauthIssuerForProject(projectUrl);
  const [standard, alternate, jwks] = await Promise.all([
    readMetadata(`${issuer}/.well-known/oauth-authorization-server`),
    readMetadata(`${new URL(projectUrl).origin}/.well-known/oauth-authorization-server/auth/v1`),
    readMetadata(`${issuer}/.well-known/jwks.json`),
  ]);
  const discovery = standard.status === 200 ? standard : alternate.status === 200 ? alternate : standard;
  const report = assessAuthenticationMetadata({
    projectUrl, discoveryStatus: discovery.status, metadata: discovery.body,
    jwksStatus: jwks.status, jwks: jwks.body,
  });
  console.log(JSON.stringify(report, null, 2));
  // Pending consent/security evidence is intentionally a non-success exit.
  process.exitCode = report.metadataReady ? 2 : 1;
}

main().catch(() => {
  console.error("Authentication preflight could not run. Check configuration and connectivity; details suppressed.");
  process.exitCode = 1;
});
