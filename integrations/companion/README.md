# Trade OS Windows companion

Private, unreleased Windows x64 packaging/consent checkpoint. This is not the
complete MT5 pairing/startup UI or a publicly downloadable installer. See
[delivery plan](../../docs/WINDOWS_COMPANION_PLAN.md) and
[verification](../../docs/WINDOWS_COMPANION_VERIFICATION.md).

## What is implemented

- Per-user native installer and GUI, with selectable local installation drive.
  Bundled Node, CPython, MT5/NumPy wheels and the existing MCP/MT5 modules; users
  do not need a checkout, npm, pip or global runtimes.
- Strict import of the application's public setup download into protected,
  isolated local profiles. Identical imports are repeatable; changed identity,
  secrets, untrusted endpoints and unsafe paths fail closed.
- Explicit browser consent/reconnect and live application-access verification,
  using the existing account/resource-bound OAuth and DPAPI implementations.
- Console TradeOSMcp.exe launcher using --profile and the saved profile UUID.
  The GUI copies public command/arguments, not a supposedly universal client
  config. Each vendor's actual registration path still needs acceptance testing.

Installation imports no accounts/trades, creates no application grants or
startup tasks and never launches MT5. Configuration import is not authorization.
An authorized MT5 bootstrap still cannot collect. The GUI now offers dedicated
demo-terminal verification, explicit existing PAUSED-manifest adoption and
server-verified mapped configuration import. Upload the copied public review-file
path in the app, approve the displayed identity, download the approved mapping and
import it into the companion. Initialization remains PAUSED. Local collection,
startup and telemetry controls are next. The actual pilot and terminals were not
adopted during implementation; adoption preserves its existing spool and requires
zero pending uploads, unchanged identity, a reason and a browser-approved fence.

## Developer verification

On the existing Windows x64 builder:

1. npm run prepare:companion-runtime downloads only pinned public artifacts,
   verifies their SHA-256 and retains the cache under .artifacts/companion.
2. npm run build:companion produces a fresh immutable build folder, ZIP and
   self-contained unsigned test installer. Build compilation uses the already
   available Framework compiler; no machine-wide SDK/runtime installation.
3. npm run test:companion-python and npm run check:companion-python.
4. npm run test:companion-native installs the actual payload only into a fresh
   protected workspace fixture, tests bundled runtime IPC/stdio/DPAPI and renders
   this project's own off-screen forms. It never captures or controls other apps.
5. Run application, database and existing integration regressions documented in
   the verification report. Native failure fixtures are retained for inspection.

Windows Framework 4.8 is required on the user's Windows 10/11 x64 machine.
Installer uses the current user's permissions (asInvoker), not administrator
or SYSTEM startup. Versioned installations preserve profile/vault/spool data
outside the install tree. Reinstalling the exact version refuses to overwrite it.
Failed staging is preserved; installation does not silently delete user files.

## Distribution boundaries

Generated artifacts, fixtures, environment files and vaults are Git-ignored.
An input checksum/package manifest proves byte integrity, not publisher identity:
the current EXEs are **unsigned** and have not passed a public-distribution gate.
No Windows security policies are bypassed. Publishing downloads, configuring
hosted setup and real installation/consent need their separate rollout approval.
Don't enable production MCP, resume a worker or purchase signing infrastructure
as a consequence of building this source.
