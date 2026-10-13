import { describe, expect, it } from "vitest";
import { mt5PairingProposalSchema, mt5PairingApprovalSchema, pairingManifest } from "@/domain/integrations/mt5-pairing";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const proposal = {format: "trade-os-mt5-pairing", version: 1, profileId: id, ownerId: id, accountId: id, clientId: id,
  observedAt: "2026-10-13T00:00:00.000Z", existingConnectionId: null, terminal: {
    executable: "D:\\Dedicated\\terminal64.exe", dataPath: "D:\\Dedicated\\data", portable: false, dedicatedApproved: true,
    identity: {server: "Demo", login: "477190850", terminalInstallationId: id, currencyCode: "USD", currencyPrecision: 2, accountKind: "DEMO", positionMode: "HEDGING"},
  }};
describe("reviewed terminal pairing boundaries", () => {
  it("preserves string broker IDs and separate monetary precision", () => {
    expect(mt5PairingProposalSchema.parse(proposal).terminal.identity.login).toBe("477190850");
  });
  it.each(["\\\\server\\share\\terminal64.exe", "D:\\wrong.exe", "D:\\..\\terminal64.exe", "D:\\named:stream\\terminal64.exe", "D:\\bad.\\terminal64.exe"])("rejects unsafe or incorrect executable %s", path => {
    expect(() => mt5PairingProposalSchema.parse({...proposal, terminal: {...proposal.terminal, executable: path}})).toThrow();
  });
  it("rejects live accounts, unknown keys and credentials", () => {
    expect(() => mt5PairingProposalSchema.parse({...proposal, access_token: "never"})).toThrow();
    expect(() => mt5PairingProposalSchema.parse({...proposal, terminal: {...proposal.terminal, identity: {...proposal.terminal.identity, accountKind: "LIVE"}}})).toThrow();
  });
  it("requires explicit acknowledgement, reason and exact profile", () => {
    const request = {profileId: id, profileVersion: "2", operationId: id, proposal, connectionVersion: null, confirmed: true, reason: "Dedicated demo mapping"};
    expect(mt5PairingApprovalSchema.parse(request).reason).toBe(request.reason);
    expect(() => mt5PairingApprovalSchema.parse({...request, confirmed: false})).toThrow();
    expect(() => mt5PairingApprovalSchema.parse({...request, reason: "short"})).toThrow();
    expect(() => mt5PairingApprovalSchema.parse({...request, proposal: {...proposal, profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}})).toThrow();
  });
  it("does not reinterpret a bootstrap as a runnable manifest", () => {
    const parsed = mt5PairingProposalSchema.parse(proposal);
    const oauth = {issuer: "https://issuer.example/auth/v1", applicationOrigin: "https://trade.example", clientId: id, allowLocalHttp: false};
    expect(pairingManifest(parsed, id, oauth)).toMatchObject({version: 1, binding: {connectionId: id}, terminal: parsed.terminal});
    expect(() => pairingManifest(parsed, id, {...oauth, clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"})).toThrow();
  });
});
