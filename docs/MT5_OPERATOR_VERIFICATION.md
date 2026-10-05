# MT5 local operator checkpoint

Date: 2026-10-05. Branch: `feature/mt5-sync`, following pushed checkpoint `cba5579`.
This is implementation/verification progress, not a completed MT5 or MCP release.

## Delivered

- Strict version-1, account/connection-bound manifest with no credential fields,
  unknown-key rejection, bounded duplicate-free JSON and local path checks.
- `init`, `consent`, `run`, `status`, reason-required `pause`/`resume` commands.
- New spools remain PAUSED; initialization does not clear existing attention/data.
- Resume verifies the live owner/account/client grant. The coordinator additionally
  obtains its mapped server lease before collecting any broker facts.
- Short-lived exclusive loopback callback listener: bind before consent, exact
  registered host/path, state/PKCE, bounded requests/time, no file serving, redirects,
  request-URL logging or secret output. Wrong callbacks do not spend a code.
- Current-user sign-in Task Scheduler specification and explicit installation.
  InteractiveToken, least privilege, hidden `pythonw` coordinator, sibling console
  Python workers, IgnoreNew, restart-on-failure, no force replacement or immediate run.
- Operator runbook and fixture-only example manifest.

No actual task was installed, terminal attached, broker order placed, account switched,
saved account/password file read, canonical trade published or hosted database changed.
Read-only installation/process inspection identified one existing installation and
matching data directory; it remains untouched. The selected system Python currently
has no `MetaTrader5` module. Runtime installation and dedicated demo configuration
therefore remain actual operational prerequisites, not assumed successes.

## Commands and observed results

| Command | Result |
| --- | --- |
| `python -m ruff format integrations/mt5` | PASS: formatting |
| `python -m ruff check integrations/mt5` | PASS |
| `python -m unittest discover -s integrations/mt5/tests -v` | PASS: 167 tests |
| `npm run check:mt5-python` | PASS: Ruff/compileall |
| `python -m ruff format --check integrations/mt5` | PASS: 32 files |
| `python -m trade_os_mt5.cli --help` | PASS: operator command entry point |
| `powershell -NoProfile -File scripts/test-mt5-startup.ps1` | PASS: native Task Scheduler validation-only; no task registered |
| `npm run test:integration-browser` | PASS: 33 real local provider/browser/API checks after hidden-worker fix |
| `npm test` | PASS earlier this turn: 282 tests; this increment changes Python/docs only |
| `npm run test:db` | PASS earlier this turn: 228 rollback-isolated assertions |
| `npm run typecheck` | PASS earlier this turn |
| `npm run lint` | PASS earlier this turn |
| `npm run build` | PASS earlier this turn: 30 pages, Next 16.3.6 |

Python direct commands used the project source and ignored development-tool directory
in process-local PYTHONPATH. Existing npm Python scripts provide the same environment.
The browser runner uses only local disposable Supabase fixtures. Provider/browser
verification is independent of mock OAuth used in listener unit tests.

## Review

Plan alignment: local commands/consent/startup support are implemented. Actual
installation/invocation, onboarding UI, canonical publication/migrations and focused
multi-account demo checks remain unfinished. MCP is not implemented in this checkpoint.

System integrity: authorization remains on the signed-token/live-grant/server-lease
boundary; local manifests cannot confer ownership. Money remains centrally calculated
in TypeScript. Existing pending source operations, review semantics and append-only
evidence are unchanged. No arbitrary shell or broker execution is exposed.

Production readiness: pending real operating checks. Native tests exercise loopback
sockets, ACLs and sibling console subprocesses. Startup registration is mocked and its
XML inspected. Native Task Scheduler accepted the XML with TASK_VALIDATE_ONLY,
but this is not proof of actual task registration/invocation. No
reboot, cross-user, locked-session, RDP, actual MT5 library/terminal or client verification
is claimed. Unknown/uncertain registration requires exact-task inspection, never force
overwrite. The approval service allowed tests/commit; one GitHub network push failed
transiently and its normal retry succeeded for `cba5579`.

Review fix: hidden startup must not launch protocol workers with pythonw (which lacks
console standard streams); workers now use the same installation's `python.exe`, never
PATH discovery. A real subprocess round-trip test covers this path.
Native validation also caught an XML encoding-declaration error when consuming the
document as a Unicode BSTR; removing the byte-encoding declaration makes the same
document valid for native validation and the UTF-8 schtasks file. The first validation
failed despite its PowerShell command's nonterminating error/zero exit. That attempt
is not counted as a pass. The corrected check sets Stop-on-error and passed natively.

The user removed the mandatory 48-hour soak wait. Extended soak is deferred, not passed;
correctness/security and focused real-demo interruption checks remain required. No
same-day-completion claim is made for unfinished functionality.

## Primary references

- [Native-app OAuth loopback/browser practice](https://datatracker.ietf.org/doc/html/rfc8252)
- [Windows Task Scheduler schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema)
- [Explicit task registration and overwrite behavior](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create)

See [operator runbook](../integrations/mt5/README.md) and
[roadmap](INTEGRATION_ROADMAP.md) for configuration and remaining scope.
