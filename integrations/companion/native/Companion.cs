using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace TradeOS.Companion {
    internal static class Runtime {
        internal static string Root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        internal static string LocalData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        internal static string Profiles { get { return Path.Combine(LocalData, "TradeOS", "companion", "profiles"); } }
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 65536, RecursionLimit = 12 };
        internal static readonly CancellationTokenSource Lifetime = new CancellationTokenSource();
        internal static string ProfilePath(string id) {
            Guid parsed;
            if (!Guid.TryParseExact(id, "D", out parsed) || parsed.ToString() != id) throw new InvalidOperationException();
            return Path.Combine(Profiles, id, "setup.json");
        }
        internal static string Quote(string value) {
            if (value == null || value.IndexOfAny(new char[] {'\r', '\n', '\0'}) >= 0) throw new InvalidOperationException();
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char c in value) {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') result.Append('\\', slashes * 2 + 1).Append(c);
                else result.Append('\\', slashes).Append(c);
                slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }
        internal static ProcessStartInfo Command(bool python, IEnumerable<string> arguments) {
            string executable = Path.Combine(Root, "runtime", python ? "python" : "node", python ? "python.exe" : "node.exe");
            if (!File.Exists(executable)) throw new InvalidOperationException();
            var info = new ProcessStartInfo(executable, string.Join(" ", arguments.Select(Quote))) {
                WorkingDirectory = Root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            // No NODE_OPTIONS/PYTHONPATH, dotenv, provider credentials or global PATH.
            info.EnvironmentVariables.Clear();
            foreach (string name in new[] {"SystemRoot", "WINDIR", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "TEMP", "TMP"}) {
                string value = Environment.GetEnvironmentVariable(name);
                if (value != null) info.EnvironmentVariables[name] = value;
            }
            info.EnvironmentVariables["PATH"] = Path.Combine(Root, "runtime", "python") + ";" + Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32");
            info.EnvironmentVariables["PYTHONNOUSERSITE"] = "1";
            info.EnvironmentVariables["LOCALAPPDATA"] = LocalData; // OS-derived; isolated override exists only in the native test assembly.
            return info;
        }
        internal static async Task<string> Limited(TextReader reader, int limit) {
            var text = new StringBuilder(); var buffer = new char[2048]; int count;
            while ((count = await reader.ReadAsync(buffer, 0, buffer.Length)) > 0) {
                if (text.Length + count > limit) throw new InvalidOperationException();
                text.Append(buffer, 0, count);
            }
            return text.ToString();
        }
        internal static async Task<string> Run(ProcessStartInfo info, string input, int seconds) {
            using (var process = new Process { StartInfo = info }) {
                if (!process.Start()) throw new InvalidOperationException();
                using (var job = new OwnedJob(process)) {
                    var output = Limited(process.StandardOutput, 65536);
                    var errors = Limited(process.StandardError, 65536); // Never display raw OAuth/IPC stderr.
                    if (input != null) await process.StandardInput.WriteAsync(input);
                    process.StandardInput.Close();
                    Task completion = Task.Run(() => process.WaitForExit());
                    Task all = Task.WhenAll(completion, output, errors);
                    if (await Task.WhenAny(all, Task.Delay(TimeSpan.FromSeconds(seconds), Lifetime.Token)) != all) throw new InvalidOperationException();
                    await all;
                    string result = await output; await errors;
                    if (process.ExitCode != 0) throw new InvalidOperationException();
                    return result;
                }
            }
        }
        internal static async Task<Dictionary<string, object>> Request(object request) {
            string text = await Run(Command(true, new[] {"-I", "-u", "-m", "trade_os_companion.cli"}), Json.Serialize(request), 30);
            var result = Json.Deserialize<Dictionary<string, object>>(text);
            if (result == null || result.ContainsKey("error")) throw new InvalidOperationException();
            return result;
        }
        internal static async Task VerifyMcp(string id) {
            var response = await Request(new {action = "READ", profileId = id});
            var profile = response["profile"] as Dictionary<string, object>;
            if (profile == null || (string)profile["purpose"] != "MCP") throw new InvalidOperationException();
        }
    }

    internal sealed class OwnedJob : IDisposable {
        [StructLayout(LayoutKind.Sequential)] struct Basic { internal long processTime, jobTime; internal uint flags; internal UIntPtr min, max; internal uint active; internal UIntPtr affinity; internal uint priority, scheduling; }
        [StructLayout(LayoutKind.Sequential)] struct IO { internal ulong r, w, other, rb, wb, ob; }
        [StructLayout(LayoutKind.Sequential)] struct Limits { internal Basic basic; internal IO io; internal UIntPtr processMemory, jobMemory, peakProcess, peakJob; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, uint size);
        [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        IntPtr handle;
        internal OwnedJob(Process process) {
            handle = CreateJobObject(IntPtr.Zero, null);
            var limits = new Limits(); limits.basic.flags = 0x2000 | 0x1000;
            if (handle == IntPtr.Zero || !SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(limits)) || !AssignProcessToJobObject(handle, process.Handle)) {
                try { process.Kill(); } catch { }
                Dispose(); throw new InvalidOperationException();
            }
        }
        public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
    }

    internal sealed class ProfileItem {
        internal readonly string Id, Purpose, Label, Origin;
        internal ProfileItem(Dictionary<string, object> value) {
            Id = (string)value["profileId"]; Purpose = (string)value["purpose"]; Label = (string)value["label"]; Origin = (string)value["applicationOrigin"];
            Runtime.ProfilePath(Id);
            if (!new[] {"MCP", "MT5"}.Contains(Purpose) || !new[] {"https://tradeos.veilcode.studio", "https://mcp-preview.veilcode.studio"}.Contains(Origin)) throw new InvalidOperationException();
        }
        public override string ToString() { return Label + "  ·  " + Purpose; }
    }

    internal sealed class CompanionWindow : Form {
        readonly ComboBox profiles = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill, AccessibleName = "Saved integration setup" };
        readonly Label state = new Label { AutoSize = true, MaximumSize = new Size(750, 0) };
        readonly Button consent, verify, reconnect, copy, openSetup;
        readonly List<Button> actions = new List<Button>();
        bool busy;
        internal CompanionWindow() {
            Text = "Trade OS companion"; Size = new Size(840, 650); MinimumSize = new Size(720, 610);
            StartPosition = FormStartPosition.CenterScreen; AutoScaleMode = AutoScaleMode.Dpi;
            BackColor = Color.FromArgb(8, 13, 20); ForeColor = Color.FromArgb(239, 240, 243); Font = new Font("Segoe UI", 10);
            var body = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(28) };
            Controls.Add(body);
            body.Controls.Add(new Label { Text = "TRADE OS  /  SECURE CONNECTIONS", AutoSize = true, ForeColor = Color.FromArgb(239, 177, 37), Margin = new Padding(0, 0, 0, 12) });
            body.Controls.Add(new Label { Text = "Connect your workspace", AutoSize = true, Font = new Font("Segoe UI", 24, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) });
            body.Controls.Add(TextBlock("Import the public setup downloaded from Trade OS. Installation, authorization and observed activity remain separate.", 16));
            var imported = Action("1. Open app setup file", async () => {
                using (var chooser = new OpenFileDialog { Filter = "Trade OS public setup (*.json)|*.json", CheckFileExists = true, Multiselect = false, Title = "Choose the configuration downloaded from Trade OS" }) {
                    if (chooser.ShowDialog(this) != DialogResult.OK) return;
                    await Execute(async () => { await Runtime.Request(new {action = "IMPORT", path = chooser.FileName}); await LoadProfiles(); state.Text = "Configuration imported. No access, startup task or collector was enabled."; });
                }
            }); body.Controls.Add(imported);
            body.Controls.Add(TextBlock("Saved integration setup", 6));
            var selector = new Panel { Width = 740, Height = 38, Margin = new Padding(0, 0, 0, 16) }; selector.Controls.Add(profiles); body.Controls.Add(selector);
            profiles.SelectedIndexChanged += (sender, args) => {
                UpdateActions();
                if (!busy) state.Text = "Configuration selected. Approve access and verify this profile separately; earlier verification is not carried across profiles.";
            };
            var buttons = new FlowLayoutPanel { Width = 750, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, MaximumSize = new Size(750, 0), WrapContents = true, Margin = new Padding(0, 0, 0, 12) };
            consent = Action("2. Approve browser access", async () => await Connect("login"));
            verify = Action("3. Verify application access", async () => await Connect("status"));
            reconnect = Action("Reconnect browser access", async () => {
                if (MessageBox.Show(this, "Start fresh browser authorization for this saved profile? This does not revoke other clients or change MT5 mapping.", "Reconnect Trade OS", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
                    await Connect("login", true);
            });
            copy = Action("Copy launcher details", async () => await Execute(async () => {
                ProfileItem selected = Selected(); await Runtime.VerifyMcp(selected.Id);
                Clipboard.SetText(Runtime.Json.Serialize(new { command = Path.Combine(Runtime.Root, "TradeOSMcp.exe"), args = new[] {"--profile", selected.Id} }));
                state.Text = "Public command/arguments copied. Vendor registration uses that client's supported setup path; no unrelated settings were overwritten.";
            }));
            buttons.Controls.Add(consent); buttons.Controls.Add(verify); buttons.Controls.Add(reconnect); buttons.Controls.Add(copy); body.Controls.Add(buttons);
            body.SizeChanged += (sender, args) => {
                int width = Math.Max(300, body.ClientSize.Width - body.Padding.Horizontal - SystemInformation.VerticalScrollBarWidth);
                foreach (Control control in body.Controls) {
                    if (control is Label) control.MaximumSize = new Size(width, 0);
                    else if (control is FlowLayoutPanel) { control.MaximumSize = new Size(width, 0); control.Width = width; }
                    else if (control is Panel) control.Width = width;
                }
            };
            body.Controls.Add(TextBlock("MT5 setup", 8));
            body.Controls.Add(TextBlock("Imported MT5 bootstraps are configuration only. Dedicated-terminal selection, verified browser mapping and collector initialization must finish before collection/startup controls become available. Existing terminals are never opened automatically.", 16));
            openSetup = Action("Open Trade OS setup", () => {
                ProfileItem selected = Selected(); Process.Start(new ProcessStartInfo(selected.Origin + "/settings/integrations/setup/" + selected.Id) { UseShellExecute = true }); return Task.FromResult(0);
            }); body.Controls.Add(openSetup);
            state.Text = "No setup selected. No integration is connected by installing this companion.";
            state.Margin = new Padding(0, 20, 0, 16); body.Controls.Add(state);
            body.Controls.Add(TextBlock("No broker orders, passwords or AI-provider API keys. Revocation remains in Trade OS Settings > Integrations.", 0));
            Shown += async (sender, args) => await Execute(LoadProfiles);
            FormClosing += (sender, args) => Runtime.Lifetime.Cancel();
            UpdateActions();
        }
        Label TextBlock(string text, int bottom) { return new Label { Text = text, AutoSize = true, MaximumSize = new Size(740, 0), ForeColor = Color.FromArgb(160, 177, 199), Margin = new Padding(0, 0, 0, bottom) }; }
        Button Action(string title, Func<Task> action) {
            var button = new Button { Text = title, AutoSize = true, Padding = new Padding(12, 7, 12, 7), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(21, 28, 39), ForeColor = ForeColor, Margin = new Padding(0, 0, 12, 10) };
            button.FlatAppearance.BorderColor = Color.FromArgb(54, 64, 78);
            button.Click += async (sender, args) => {
                if (busy) return;
                try { await action(); } catch { state.Text = "The action could not be completed safely. Check the saved setup and application access."; }
            };
            actions.Add(button); return button;
        }
        ProfileItem Selected() { var value = profiles.SelectedItem as ProfileItem; if (value == null) throw new InvalidOperationException(); return value; }
        void UpdateActions() {
            foreach (Button button in actions) button.Enabled = !busy;
            profiles.Enabled = !busy;
            var selected = profiles.SelectedItem as ProfileItem;
            if (consent != null) consent.Enabled = !busy && selected != null;
            if (verify != null) verify.Enabled = !busy && selected != null;
            if (reconnect != null) reconnect.Enabled = !busy && selected != null;
            if (copy != null) copy.Enabled = !busy && selected != null && selected.Purpose == "MCP";
            if (openSetup != null) openSetup.Enabled = !busy && selected != null;
        }
        async Task LoadProfiles() {
            var result = await Runtime.Request(new {action = "LIST"});
            var rows = result["profiles"] as IList; if (rows == null) throw new InvalidOperationException();
            profiles.Items.Clear(); foreach (var row in rows) profiles.Items.Add(new ProfileItem((Dictionary<string, object>)row));
            if (profiles.Items.Count > 0) profiles.SelectedIndex = 0;
            state.Text = profiles.Items.Count > 0 ? "Configuration ready. Consent and a live connection check are still required." : "No saved setup. Open the public configuration downloaded from Trade OS.";
        }
        async Task Execute(Func<Task> work) {
            busy = true; UpdateActions(); state.Text = "Working. No additional action can run while this request is pending.";
            try { await work(); }
            catch { state.Text = "The action could not be completed safely. Check the saved setup and application access. No raw credential or provider error is displayed."; }
            finally { busy = false; if (!IsDisposed) UpdateActions(); }
        }
        async Task Connect(string command, bool freshConsent = false) {
            await Execute(async () => {
                ProfileItem selected = Selected();
                if (selected.Purpose == "MCP") {
                    await Runtime.VerifyMcp(selected.Id);
                    await Runtime.Run(Runtime.Command(false, new[] { Path.Combine(Runtime.Root, "integrations", "mcp", "cli.mjs"), command, "--config", Runtime.ProfilePath(selected.Id) }), null, 360);
                    state.Text = "A real MCP connection was verified. This does not prove every tool/client workflow passed; revocation remains separate.";
                } else {
                    object request = command == "login" ? (object)new {action = "CONSENT", profileId = selected.Id, reconnect = freshConsent} : new {action = "VERIFY_ACCESS", profileId = selected.Id};
                    string text = await Runtime.Run(Runtime.Command(true, new[] {"-I", "-u", "-m", "trade_os_companion.cli"}), Runtime.Json.Serialize(request), 650);
                    var reply = Runtime.Json.Deserialize<Dictionary<string, object>>(text);
                    if ((string)reply["state"] != "AUTHORIZED" || (string)reply["profileId"] != selected.Id) throw new InvalidOperationException();
                    state.Text = "Live account-specific access verified. Terminal selection/mapping is still required; no capture, startup or publication was enabled.";
                }
            });
        }
    }

    internal static class Program {
        [STAThread] static void Main(string[] args) {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            if (args.Length != 0) return; // No arbitrary file association/URI/command dispatch.
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new CompanionWindow());
        }
    }

    internal static class McpProgram {
        static int Main(string[] args) {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            try {
                if (args.Length != 2 || args[0] != "--profile") throw new InvalidOperationException();
                string id = args[1]; Runtime.VerifyMcp(id).GetAwaiter().GetResult();
                using (var child = new Process { StartInfo = Runtime.Command(false, new[] {Path.Combine(Runtime.Root, "integrations", "mcp", "cli.mjs"), "run", "--config", Runtime.ProfilePath(id)}) }) {
                    child.Start(); using (var job = new OwnedJob(child)) {
                        Task outgoing = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                        Task errors = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                        Task incoming = Task.Run(async () => { await Console.OpenStandardInput().CopyToAsync(child.StandardInput.BaseStream); child.StandardInput.Close(); });
                        Task finished = Task.Run(() => child.WaitForExit());
                        if (Task.WhenAny(finished, incoming).GetAwaiter().GetResult() == incoming && !child.WaitForExit(2000)) child.Kill();
                        child.WaitForExit(); Task.WaitAll(outgoing, errors); return child.ExitCode;
                    }
                }
            } catch { Console.Error.WriteLine("Trade OS companion: MCP unavailable. Import a valid app setup and approve access in the companion."); return 1; }
        }
    }
}
