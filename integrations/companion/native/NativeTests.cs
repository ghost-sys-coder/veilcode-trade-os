using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

namespace TradeOS.Companion {
    internal static class NativeTests {
        static int checks;
        static void Assert(bool valid, string name) { if (!valid) throw new Exception(name); checks++; Console.WriteLine("PASS " + checks + ": " + name); }
        static void Rejected(Action action, string name) { bool denied = false; try { action(); } catch (InvalidOperationException) { denied = true; } Assert(denied, name); }
        static IEnumerable<Control> Descendants(Control root) { foreach (Control child in root.Controls) { yield return child; foreach (Control nested in Descendants(child)) yield return nested; } }
        static void Render(Form window, string path) {
            // Render only this assembly's own disposable forms, off-screen. No
            // desktop capture, existing app interaction or credentials are used.
            window.StartPosition = FormStartPosition.Manual; window.Location = new Point(-32000, -32000);
            window.Show(); Application.DoEvents();
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (Descendants(window).OfType<ComboBox>().Any(box => !box.Enabled || box.SelectedItem == null) && DateTime.UtcNow < deadline) Application.DoEvents();
            Assert(!Descendants(window).OfType<ComboBox>().Any(box => !box.Enabled || box.SelectedItem == null), "fixture profile really loads before rendering");
            Assert(Descendants(window).OfType<ComboBox>().All(box => box.Parent.Height >= box.PreferredHeight), "native selector is not vertically clipped");
            Assert(Descendants(window).OfType<Button>().Any(button => button.IsHandleCreated), "native form children really render");
            window.PerformLayout();
            using (var image = new Bitmap(window.ClientSize.Width, window.ClientSize.Height)) { window.DrawToBitmap(image, window.ClientRectangle); image.Save(path); }
        }
        [STAThread] static int Main(string[] args) {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            try {
                if (args.Length != 3 || !new[] {"install", "runtime"}.Contains(args[2])) throw new Exception("Exact fixture payload, destination and test phase required");
                bool runtimePhase = args[2] == "runtime";
                string payload = Path.GetFullPath(args[0]), fixture = PackageInstaller.SafePath(Path.GetFullPath(args[1]));
                if (!fixture.StartsWith(Path.GetFullPath(Path.Combine(Runtime.Root, "..", "fixtures")) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || Directory.Exists(fixture) != runtimePhase) throw new Exception("Exact contained fixture phase required");
                Runtime.LocalData = Path.Combine(fixture, "local-data");
                string installed;
                if (!runtimePhase) {
                Directory.CreateDirectory(fixture); PackageInstaller.Protect(fixture); Directory.CreateDirectory(Runtime.LocalData);
                Rejected(() => Runtime.ProfilePath("../other"), "profile path traversal rejected");
                Rejected(() => Runtime.Quote("line\ncommand"), "control characters rejected in native argv");
                Assert(Runtime.Quote("path with spaces").StartsWith("\""), "argv uses Windows quoting without a shell");
                foreach (string bad in new[] {"../other", "a\\b", "C:/other", "a/NUL", "a/stream:other", "a/b.", "a/../b"}) Rejected(() => PackageInstaller.RelativePath(bad), "unsafe archive path rejected");
                Rejected(() => PackageInstaller.SafePath("\\\\server\\share"), "remote installation path rejected");
                using (var input = File.OpenRead(payload)) installed = PackageInstaller.Install(input, Path.Combine(fixture, "installed"));
                Assert(File.Exists(Path.Combine(installed, "TradeOS.exe")), "real bundle installs into a new protected version folder");
                Assert(File.Exists(Path.Combine(installed, "runtime/python/python.exe")), "bundled Python installed without a global runtime");
                using (var input = File.OpenRead(payload)) Rejected(() => PackageInstaller.Install(input, Path.Combine(fixture, "installed")), "same version is not overwritten");
                var acl = Directory.GetAccessControl(installed); Assert(acl.AreAccessRulesProtected, "installation DACL remains current-user protected");
                Console.WriteLine("Installation phase verified: " + checks + " checks");
                return 0;
                }
                installed = PackageInstaller.SafePath(Directory.GetDirectories(Path.Combine(fixture, "installed"), "companion-*").Single());
                Runtime.Root = installed; // Test-only assembly, not a product CLI switch.
                string packagedTest = Path.Combine(Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location), "packaged-runtime.mjs");
                string installedTest = Path.Combine(installed, "packaged-runtime-test.mjs");
                File.Copy(packagedTest, installedTest, false); // New test-only file in this isolated install, never shipped.
                string runtimeResult = Runtime.Run(Runtime.Command(false, new[] {installedTest}), null, 30).GetAwaiter().GetResult();
                Assert(runtimeResult == "PACKAGED_RUNTIME_VERIFIED\n", "packaged MCP imports, legacy/modern SDK forwarding, DPAPI, locking and restart work with no global runtimes or network");
                var start = Runtime.Command(true, new[] {"-I", "-u", "-m", "trade_os_companion.cli"});
                Assert(!start.UseShellExecute && start.CreateNoWindow && !start.EnvironmentVariables.ContainsKey("NODE_OPTIONS") && !start.EnvironmentVariables.ContainsKey("PYTHONPATH"), "fixed hidden subprocess excludes environment injection");
                var empty = Runtime.Request(new {action = "LIST"}).GetAwaiter().GetResult();
                Assert(((IList)empty["profiles"]).Count == 0, "bundled Python IPC lists only the isolated empty fixture profile store");
                string publicFile = Path.Combine(fixture, "public-setup.json");
                File.WriteAllText(publicFile, Runtime.Json.Serialize(new {version = 1, profile = "tradeos-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    resource = "https://mcp-preview.veilcode.studio/mcp", issuer = "https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1",
                    clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", redirectUri = "http://127.0.0.1:9878/callback", allowLoopback = false}));
                var imported = Runtime.Request(new {action = "IMPORT", path = publicFile}).GetAwaiter().GetResult();
                var summary = (Dictionary<string, object>)imported["profile"];
                Assert((string)summary["state"] == "CONFIGURED", "bundled native IPC imports public setup without authorization or collection");
                var replayed = Runtime.Request(new {action = "IMPORT", path = publicFile}).GetAwaiter().GetResult();
                Assert((string)((Dictionary<string, object>)replayed["profile"])["configurationHash"] == (string)summary["configurationHash"], "native profile import replay preserves its exact configuration");
                // Fixed offline fixture only: a bounded PAUSED worker cannot call
                // SDK/network. Prove breakaway from the short-lived GUI IPC job.
                string healthTest = Path.Combine(installed, "packaged-health-test.py");
                File.Copy(Path.Combine(Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location), "packaged-health.py"), healthTest);
                string connectionDir = Path.Combine(fixture, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"); Directory.CreateDirectory(connectionDir);
                string terminal = Path.Combine(fixture, "terminal64.exe"); File.WriteAllText(terminal, "fixture-not-an-executable");
                string data = Path.Combine(fixture, "terminal-data"); Directory.CreateDirectory(data);
                string manifest = Path.Combine(connectionDir, "connection.json");
                File.WriteAllText(manifest, Runtime.Json.Serialize(new {version = 1,
                    binding = new {ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", connectionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
                    oauth = new {issuer = "https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1", applicationOrigin = "https://tradeos.veilcode.studio", clientId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", allowLocalHttp = false},
                    terminal = new {executable = terminal, dataPath = data, dedicatedApproved = true, portable = false,
                        identity = new {server = "Fixture-Demo", login = "1", terminalInstallationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", currencyCode = "USD", currencyPrecision = 2, accountKind = "DEMO", positionMode = "HEDGING"}},
                    callbackUri = "http://127.0.0.1:9876/callback"}));
                var workerReply = Runtime.Json.Deserialize<Dictionary<string,object>>(Runtime.Run(Runtime.Command(true, new[] {"-I", healthTest, "parent", manifest}), null, 15).GetAwaiter().GetResult());
                using (var worker = System.Diagnostics.Process.GetProcessById((int)workerReply["pid"])) {
                    Assert(!worker.HasExited && (string)workerReply["mode"] == "PAUSED", "bounded PAUSED packaged coordinator survives IPC job closure without broker or network activity");
                    Assert(worker.WaitForExit(10000), "owned fixture worker stops on its deadline without terminating any terminal");
                }
                using (var launcher = new System.Diagnostics.Process {
                    StartInfo = new System.Diagnostics.ProcessStartInfo(Path.Combine(installed, "TradeOSMcp.exe"), "--profile invalid") {
                        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
                    }
                }) {
                    launcher.Start();
                    var output = launcher.StandardOutput.ReadToEndAsync(); var errors = launcher.StandardError.ReadToEndAsync();
                    if (!launcher.WaitForExit(10000)) { launcher.Kill(); throw new Exception("Invalid-profile launcher did not stop"); }
                    Assert(launcher.ExitCode == 1 && output.Result == "" && errors.Result.Contains("MCP unavailable"), "real console launcher fails closed without corrupting protocol stdout");
                }
                string mt5Setup = Path.Combine(fixture, "public-mt5.json");
                File.WriteAllText(mt5Setup, Runtime.Json.Serialize(new {format = "trade-os-setup", version = 1, purpose = "MT5", profileId = "ffffffff-ffff-4fff-8fff-ffffffffffff",
                    ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", account = new {id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name = "Fixture demo", currencyCode = "USD", currencyPrecision = 2},
                    oauth = new {issuer = "https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1", applicationOrigin = "https://tradeos.veilcode.studio", clientId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", callbackUri = "http://127.0.0.1:9876/callback", allowLocalHttp = false}}));
                Runtime.Request(new {action = "IMPORT", path = mt5Setup}).GetAwaiter().GetResult();
                Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
                using (var window = new CompanionWindow()) {
                    window.CreateControl(); window.PerformLayout();
                    var buttons = Descendants(window).OfType<Button>().ToArray();
                    Assert(buttons.Single(button => button.Text.StartsWith("2.")).Enabled == false, "browser approval disabled without a saved MCP profile");
                    Assert(buttons.Single(button => button.Text.StartsWith("3.")).Enabled == false, "verification disabled without a saved MCP profile");
                    Assert(Descendants(window).OfType<ComboBox>().Single().AccessibleName == "Saved integration setup", "native profile selector has an accessible name");
                    Render(window, Path.Combine(fixture, "companion.png"));
                    Assert(Descendants(window).OfType<Button>().Where(button => button.Text.StartsWith("Choose dedicated") || button.Text.StartsWith("Adopt existing") || button.Text.StartsWith("Import approved")).All(button => !button.Enabled), "MCP profiles cannot probe or activate MT5 terminals");
                    Assert(Descendants(window).OfType<Button>().Where(button => new[] {"Refresh local health", "Start / recover collector", "Pause local collection", "Inspect startup", "Enable sign-in startup", "Repair owned startup", "Disable startup and pause"}.Contains(button.Text)).All(button => !button.Enabled), "MCP profiles cannot run MT5 control or startup actions");
                    Assert(Descendants(window).OfType<TextBox>().Single().AccessibleName == "Collector control reason" && !Descendants(window).OfType<TextBox>().Single().Enabled, "labelled control reason is disabled for MCP profiles");
                    string healthText = CompanionWindow.HealthText(new Dictionary<string,object> {
                        {"coordinatorActive", false}, {"localStale", true}, {"mode", "RUNNING"}, {"pendingPages", 2}, {"observedAt", null},
                        {"lastContactAt", null}, {"stale", true}, {"observedState", null}, {"code", null}, {"retryCode", null}, {"pausePending", false}
                    });
                    Assert(healthText.Contains("not running") && healthText.Contains("Pending upload pages: 2") && healthText.Contains("unknown"), "saved running intent with missing worker is not a healthy badge");
                    window.Size = window.MinimumSize; window.PerformLayout();
                    Assert(Descendants(window).OfType<ComboBox>().Single().Width <= window.ClientSize.Width - 56, "native selector fits the minimum-size viewport");
                    Assert(Descendants(window).OfType<TextBox>().Single().Width <= window.ClientSize.Width - 56, "control reason fits the minimum-size viewport without horizontal clipping");
                    Render(window, Path.Combine(fixture, "companion-minimum.png"));
                    var selector = Descendants(window).OfType<ComboBox>().Single();
                    selector.SelectedItem = selector.Items.OfType<ProfileItem>().Single(item => item.Purpose == "MT5");
                    var input = Descendants(window).OfType<TextBox>().Single();
                    var startButton = Descendants(window).OfType<Button>().Single(button => button.Text == "Start / recover collector");
                    Assert(input.Enabled && !startButton.Enabled, "MT5 controls require a meaningful reason without implying authorization");
                    input.Text = "short"; Assert(!startButton.Enabled, "short reasons cannot enable collector writes");
                    input.Text = "Explicit fixture operator intent"; Assert(startButton.Enabled, "explicit reason enables confirmation path only; no worker or task starts from typing");
                    Render(window, Path.Combine(fixture, "companion-mt5.png"));
                    var body = (FlowLayoutPanel)window.Controls[0];
                    body.ScrollControlIntoView(input); window.PerformLayout();
                    Assert(input.Bounds.Right <= body.ClientSize.Width - body.Padding.Right, "scrolled reason remains inside the minimum-width content area");
                    Render(window, Path.Combine(fixture, "companion-controls.png"));
                    var disable = Descendants(window).OfType<Button>().Single(button => button.Text == "Disable startup and pause");
                    body.ScrollControlIntoView(disable.Parent); window.PerformLayout();
                    Assert(disable.Right <= disable.Parent.ClientSize.Width, "wrapped startup controls remain horizontally reachable");
                    Render(window, Path.Combine(fixture, "companion-controls-bottom.png"));
                    selector.SelectedItem = selector.Items.OfType<ProfileItem>().Single(item => item.Purpose == "MCP");
                    Assert(input.Text == "" && !startButton.Enabled, "profile switch clears control intent and prevents cross-profile actions");
                }
                using (var window = new InstallerWindow()) { Render(window, Path.Combine(fixture, "installer.png")); }
                Console.WriteLine("Native fixture retained for inspection: " + fixture);
                return 0;
            } catch (Exception error) {
                var frame = new System.Diagnostics.StackTrace(error, true).GetFrames().FirstOrDefault(item => item.GetFileLineNumber() > 0);
                Console.Error.WriteLine("Native companion verification failed: " + error.GetType().Name + " HRESULT " + error.HResult.ToString("X8") + " at " + (frame == null ? "unknown" : frame.GetMethod().Name + ":" + frame.GetFileLineNumber()));
                return 1;
            }
        }
    }
}
