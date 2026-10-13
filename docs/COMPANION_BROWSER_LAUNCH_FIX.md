# Packaged MCP browser approval correction — 2026-10-13

The user imported the Codex configuration successfully, then reported that
"Approve browser access" opened no browser and showed a generic acknowledgement
error. The installed UI and all 960 packaged file hashes had already been verified.

## Diagnosis and changes

A read-only check using the installed bundled Node and the companion's restricted
environment confirmed that OAuth discovery succeeds, `powershell.exe` lookup by
PATH fails with ENOENT, and the system PowerShell executable exists. No consent,
credential-store access or grant mutation was performed for that diagnosis.

- Browser launch uses the absolute OS PowerShell path, retaining the restricted
  PATH. Native subprocess SystemRoot/WINDIR come from Windows' special-folder API.
- The authorization URL is passed as environment data, never interpolated shell
  code. Existing PKCE, callback, issuer/resource and token checks remain intact.
- The shell helper stays hidden; the requested consent browser uses a normal,
  visible window so the user can complete the interactive approval.
- The GUI flag makes browser launch errors immediate and actionable. Ordinary
  terminal login retains the existing manual-URL fallback when launch fails.
- Subprocess failures expose only allowlisted error codes and fixed UI messages.
  Raw stderr, authorization URLs, codes and tokens never become UI error text.
- Selecting bundle-manifest.json now explains which app setup download to use.
- Browser launch failure closes the callback listener and saves no credentials.

## Verification and distribution

| Command | Result |
| --- | --- |
| `npm test -- tests/mcp/browser.test.ts tests/mcp/stdio.test.ts --maxWorkers=1` | PASS: 55 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build:companion` | PASS: 961 files / 14 dependencies; Node 24.21.0, Python 3.13.16 |
| `npm run test:companion-native` | PASS: 15 installation and 67 runtime/UI checks |

The packaged check runs the actual system PowerShell with the native restricted
PATH, using only `exit 0`, without opening a browser. Tests also cover shell
failure/timeout, no credential save or leaked callback port, terminal fallback,
fixed diagnostic parsing through a real packaged subprocess, wrong-file rejection,
existing IPC/DPAPI/protocol/PAUSED-worker behavior and UI visibility checks.
No hosted user grant, broker or startup action was exercised by these fixtures.

Final build: `.artifacts/companion/build-1791883997632`.
Installer: `.artifacts/companion/build-1791883997632-setup.exe`, 59,186,176 bytes.
SHA-256: `096150acb1aeabb3d544b249349974d8f5b8760cd79e7f6d5ead1f3014190434`.
The final packaged module explicitly requests `WindowStyle Normal`. An earlier
build that snapshotted the prior browser-window argument is retained locally but
is not the distribution candidate.

The release must be published and the app's pinned metadata updated before asking
the user to retry. No replacement installer is delivered as a local-folder
workaround. Actual owner browser approval through the updated installer remains
pending the user's retry; successful subprocess resolution is not consent.
