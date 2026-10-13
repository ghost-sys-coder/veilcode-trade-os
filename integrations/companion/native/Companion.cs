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
    internal sealed class CompanionFailure : Exception {
        internal static readonly Dictionary<string,string> Messages = new Dictionary<string,string> {
            {"INVALID_SETUP", "This is not a Trade OS setup file. Select the tradeos-*.json downloaded from your application setup page, rather than bundle-manifest.json."},
            {"INVALID_CONFIG", "The setup configuration is invalid. Download it again from your application setup page."},
            {"PROFILE_CONFLICT", "A different configuration already uses this profile. Existing setup was preserved; review the profile in Trade OS."},
            {"PROFILE_BUSY", "This connection is already in use. Close its other adapter before trying again."},
            {"BROWSER_UNAVAILABLE", "Windows could not open the consent browser. Check your default browser and retry Approve browser access."},
            {"LOGIN_TIMEOUT", "Browser approval timed out. Click Approve browser access and complete consent in the browser."},
            {"LOGIN_REQUIRED", "Browser approval is required. Click Approve browser access before verifying this connection."},
            {"ACCESS_DENIED", "Application access was denied. Check this connection in Trade OS Settings > Integrations, then retry approval."},
            {"VAULT_UNAVAILABLE", "Windows could not access the protected credential store. Check that this connection is running under your Windows account."},
            {"INVALID_DISCOVERY", "The application discovery response does not match this setup. Download a fresh configuration from Trade OS."},
            {"REFRESH_UNCERTAIN", "Credential renewal could not be confirmed. Reconnect browser access before retrying."},
            {"UNAVAILABLE", "The application or network could not be reached. Check your connection and retry browser approval."}
        };
        internal CompanionFailure(string code) : base(Messages[code]) { }
        internal static Exception FromOutput(string output, string errors) {
            try {
                var result = Runtime.Json.Deserialize<Dictionary<string,object>>(output);
                if (result != null && result.Count == 1 && result.ContainsKey("error") && result["error"] is string && Messages.ContainsKey((string)result["error"]))
                    return new CompanionFailure((string)result["error"]);
            } catch { }
            foreach (string line in errors.Split(new[] {'\r','\n'}, StringSplitOptions.RemoveEmptyEntries)) {
                const string marker = "TRADE_OS_MCP_ERROR:";
                if (line.StartsWith(marker, StringComparison.Ordinal)) {
                    string code = line.Substring(marker.Length);
                    if (Messages.ContainsKey(code)) return new CompanionFailure(code);
                }
            }
            return new InvalidOperationException();
        }
    }
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
            // The installed inventory is sealed. -I ignores PYTHONDONTWRITEBYTECODE,
            // so use the interpreter flag for every native Python invocation.
            var commandArguments = python ? new[] {"-B"}.Concat(arguments) : arguments;
            var info = new ProcessStartInfo(executable, string.Join(" ", commandArguments.Select(Quote))) {
                WorkingDirectory = Root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            // No NODE_OPTIONS/PYTHONPATH, dotenv, provider credentials or global PATH.
            info.EnvironmentVariables.Clear();
            foreach (string name in new[] {"LOCALAPPDATA", "APPDATA", "USERPROFILE", "TEMP", "TMP"}) {
                string value = Environment.GetEnvironmentVariable(name);
                if (value != null) info.EnvironmentVariables[name] = value;
            }
            string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            info.EnvironmentVariables["SystemRoot"] = windows; info.EnvironmentVariables["WINDIR"] = windows;
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
                    string result = await output; string errorText = await errors;
                    if (process.ExitCode != 0) throw CompanionFailure.FromOutput(result, errorText);
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
        static void Forward(Stream source, Stream target) {
            var buffer = new byte[8192]; int count;
            while ((count = source.Read(buffer, 0, buffer.Length)) > 0) {
                target.Write(buffer, 0, count);
                // Interactive protocol messages must arrive before stdin closes.
                // Process pipe streams can otherwise retain small messages in a
                // buffer while each endpoint waits for the other's response.
                target.Flush();
            }
        }
        internal static int Relay(Process child, Stream input, Stream output, Stream errors) {
            // Framework anonymous/console pipe reads can block while beginning a
            // CopyToAsync. Start all directions on independent workers before
            // waiting: initialization input must reach a server with no output yet.
            Task outgoing = Task.Run(() => Forward(child.StandardOutput.BaseStream, output));
            Task diagnostics = Task.Run(() => Forward(child.StandardError.BaseStream, errors));
            Task incoming = Task.Run(() => { Forward(input, child.StandardInput.BaseStream); child.StandardInput.Close(); });
            Task finished = Task.Run(() => child.WaitForExit());
            if (Task.WhenAny(finished, incoming).GetAwaiter().GetResult() == incoming && !child.WaitForExit(2000)) child.Kill();
            child.WaitForExit(); Task.WaitAll(outgoing, diagnostics); return child.ExitCode;
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
        public override string ToString() { return Label + "  ·  " + Purpose + "  ·  " + (Origin.Contains("mcp-preview") ? "Staging" : "Production") + "  ·  " + Id.Substring(0, 8); }
    }

    internal sealed class CompanionWindow : Form {
        readonly ComboBox profiles = new ProfileSelector { Dock = DockStyle.Top };
        readonly Label state = new Label { AutoSize = true, MaximumSize = new Size(750, 0), BackColor = NativeTheme.Surface, ForeColor = NativeTheme.Muted, Padding = new Padding(12), AccessibleName = "Connection status" };
        readonly Button consent, verify, reconnect, copy, openSetup;
        readonly List<Button> actions = new List<Button>();
        readonly List<Button> mt5Actions = new List<Button>();
        readonly List<Control> mt5Sections = new List<Control>();
        readonly Dictionary<string,string> proposals = new Dictionary<string,string>();
        readonly List<Button> reasonActions = new List<Button>();
        readonly TextBox reason = new TextBox { Width = 740, Height = 58, Multiline = true, MaxLength = 1000, AccessibleName = "Collector control reason", BackColor = Color.FromArgb(21,28,39), ForeColor = Color.FromArgb(239,240,243) };
        readonly Label health = new Label { AutoSize = true, MaximumSize = new Size(740,0), AccessibleName = "Local collector health", Text = "Local health has not been checked." };
        bool busy;
        internal bool ProfilesLoaded { get; private set; }
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
                    await Execute(async () => {
                        var reply = await Runtime.Request(new {action = "IMPORT", path = chooser.FileName});
                        await LoadProfiles((string)((Dictionary<string, object>)reply["profile"])["profileId"]);
                        state.Text = "Setup imported. Next: approve browser access, then verify the connection.";
                    });
                }
            }); body.Controls.Add(imported);
            body.Controls.Add(TextBlock("Saved integration setup", 6));
            var selector = new Panel { Width = 740, Height = Math.Max(42, profiles.PreferredHeight), Margin = new Padding(0, 0, 0, 12) }; selector.Controls.Add(profiles); body.Controls.Add(selector);
            profiles.SizeChanged += (sender, args) => { selector.Height = Math.Max(42, profiles.PreferredHeight); };
            profiles.Items.Add("Loading saved setups..."); profiles.SelectedIndex = 0;
            state.Margin = new Padding(0, 0, 0, 16); body.Controls.Add(state);
            profiles.SelectedIndexChanged += (sender, args) => {
                health.Text = "Local health has not been checked for this profile.";
                reason.Clear();
                UpdateActions();
                if (!busy) state.Text = "Setup selected. Approve browser access, then verify this connection.";
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
                    else if (control is Panel || control is TextBox) control.Width = width;
                }
            };
            int mt5StartIndex = body.Controls.Count;
            body.Controls.Add(TextBlock("MT5 setup", 8));
            body.Controls.Add(TextBlock("Verify only the dedicated demo installation you explicitly select. SDK connection may launch that terminal; no passwords, order APIs or account switching are used. Then review the proposal in Trade OS and import its approved mapping. Collection/startup controls are not enabled by pairing.", 16));
            var pairButtons = new FlowLayoutPanel { Width = 750, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, MaximumSize = new Size(750, 0), WrapContents = true };
            foreach (var button in new[] {
                Action("Choose dedicated demo terminal", async () => await ProbeTerminal(false)),
                Action("Adopt existing PAUSED manifest", async () => await ProbeTerminal(true)),
                Action("Import approved mapping (PAUSED)", async () => await ActivateMapping())
            }) { mt5Actions.Add(button); pairButtons.Controls.Add(button); }
            body.Controls.Add(pairButtons);
            body.Controls.Add(TextBlock("Collector controls / local observations", 8));
            body.Controls.Add(TextBlock("Start or recover checks live access and mapping before resuming local intent. Server pause, reconciliation and publication approval remain in Trade OS. The hidden worker can continue after this window closes; use Pause to stop new work. An in-flight bounded request may finish first. No process is force-killed.", 12));
            body.Controls.Add(health);
            body.Controls.Add(TextBlock("Reason (8-1000 characters) for every control change", 6));
            body.Controls.Add(reason); reason.TextChanged += (sender,args) => UpdateActions();
            var controlButtons = new FlowLayoutPanel { Width = 750, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, MaximumSize = new Size(750,0), WrapContents = true };
            foreach (var entry in new[] {
                new[] {"Refresh local health", "HEALTH"}, new[] {"Start / recover collector", "START"}, new[] {"Pause local collection", "PAUSE"},
                new[] {"Inspect startup", "STARTUP_STATUS"}, new[] {"Enable sign-in startup", "INSTALL_STARTUP"},
                new[] {"Repair owned startup", "REPAIR_STARTUP"}, new[] {"Disable startup and pause", "DISABLE_STARTUP"}
            }) {
                string command = entry[1];
                var button = Action(entry[0], async () => await Operate(command));
                mt5Actions.Add(button); controlButtons.Controls.Add(button);
                if (command != "HEALTH" && command != "STARTUP_STATUS") reasonActions.Add(button);
            }
            body.Controls.Add(controlButtons);
            for (int index = mt5StartIndex; index < body.Controls.Count; index++) mt5Sections.Add(body.Controls[index]);
            openSetup = Action("Open Trade OS setup", () => {
                ProfileItem selected = Selected(); Process.Start(new ProcessStartInfo(selected.Origin + "/settings/integrations/setup/" + selected.Id) { UseShellExecute = true }); return Task.FromResult(0);
            }); body.Controls.Add(openSetup);
            state.Text = "Loading saved setups...";
            body.Controls.Add(TextBlock("No broker orders, passwords or AI-provider API keys. Revocation remains in Trade OS Settings > Integrations.", 0));
            Shown += async (sender, args) => await Execute(LoadProfiles);
            FormClosing += (sender, args) => Runtime.Lifetime.Cancel();
            UpdateActions();
        }
        Label TextBlock(string text, int bottom) { return new Label { Text = text, AutoSize = true, MaximumSize = new Size(740, 0), ForeColor = Color.FromArgb(160, 177, 199), Margin = new Padding(0, 0, 0, bottom) }; }
        Button Action(string title, Func<Task> action) {
            var button = new ThemedButton { Text = title, AutoSize = true, Padding = new Padding(12, 7, 12, 7), Primary = title.StartsWith("1."), Margin = new Padding(0, 0, 12, 10) };
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
            profiles.Enabled = !busy && profiles.Items.OfType<ProfileItem>().Any();
            var selected = profiles.SelectedItem as ProfileItem;
            if (consent != null) consent.Enabled = !busy && selected != null;
            if (verify != null) verify.Enabled = !busy && selected != null;
            if (reconnect != null) reconnect.Enabled = !busy && selected != null;
            if (copy != null) copy.Enabled = !busy && selected != null && selected.Purpose == "MCP";
            if (openSetup != null) openSetup.Enabled = !busy && selected != null;
            foreach (Button button in mt5Actions) button.Enabled = !busy && selected != null && selected.Purpose == "MT5";
            foreach (Control section in mt5Sections) section.Visible = selected != null && selected.Purpose == "MT5";
            if (copy != null) copy.Visible = selected != null && selected.Purpose == "MCP";
            reason.Enabled = !busy && selected != null && selected.Purpose == "MT5";
            foreach (Button button in reasonActions) button.Enabled = !busy && selected != null && selected.Purpose == "MT5" && reason.Text.Trim().Length >= 8;
        }
        internal static string HealthText(Dictionary<string,object> result) {
            bool active = (bool)result["coordinatorActive"], stale = (bool)result["localStale"];
            string local = !active ? "not running" : stale ? "lock held; tick stale or unknown" : "recent tick observed";
            return "Local intent: " + result["mode"] + " | Coordinator: " + local + "\r\nPending upload pages: " + result["pendingPages"] +
                " | Local tick: " + (result["observedAt"] ?? "not observed") + "\r\nServer contact: " + (result["lastContactAt"] ?? "not received") +
                ((bool)result["stale"] ? " (stale)" : "") + " | State: " + (result["observedState"] ?? "unknown") +
                " | Attention/retry: " + (result["code"] ?? result["retryCode"] ?? "none observed") +
                ((bool)result["pausePending"] ? "\r\nPause requested; waiting for the worker's next bounded checkpoint." : "") +
                "\r\nLocal observations are not proof of publication or balance reconciliation. Refresh for current health.";
        }
        async Task Operate(string command) {
            ProfileItem selected = Selected(); if (selected.Purpose != "MT5") throw new InvalidOperationException();
            bool read = command == "HEALTH" || command == "STARTUP_STATUS";
            string why = reason.Text.Trim();
            if (!read) {
                string warning = command == "START" ? "Resume this mapped demo collector? Pending uploads drain before new broker reads. The worker continues after closing the companion. Server-paused connections must be resumed separately in Trade OS. No order operation is available." :
                    command == "PAUSE" ? "Pause new local work? The current bounded request may finish; pending uploads and audit evidence are preserved. Startup remains a separate setting." :
                    command == "DISABLE_STARTUP" ? "Disable only the exactly verified current-user startup task and pause local collection? No task, terminal, trade or pending upload will be deleted." :
                    "Register or repair only this collector's exact current-user sign-in task? Pause locally first. This is a separate startup opt-in, not collection approval. The watchdog may launch a PAUSED coordinator. No boot/SYSTEM task or unrelated task is changed.";
                if (why.Length < 8 || MessageBox.Show(this, selected.Label + "\r\n\r\n" + warning + "\r\n\r\nReason: " + why, "Confirm collector control", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            }
            await Execute(async () => {
                object request = read ? (object)new {action = command, profileId = selected.Id} : new {action = command, profileId = selected.Id, reason = why};
                string output = await Runtime.Run(Runtime.Command(true,new[] {"-I", "-u", "-m", "trade_os_companion.cli"}), Runtime.Json.Serialize(request), 60);
                var result = Runtime.Json.Deserialize<Dictionary<string,object>>(output);
                if (result.ContainsKey("error")) throw new InvalidOperationException();
                if (result.ContainsKey("coordinatorActive")) health.Text = HealthText(result);
                state.Text = read ? (command == "HEALTH" ? "Local health refreshed. No network or broker read was performed." : "Startup inspection: " + result["state"] + ". Unknown is not proof that a task is absent.") :
                    command == "START" ? "Local resume requested. Read health for actual activity; server approval and publication remain separate." :
                    command == "PAUSE" ? "Local pause persisted with its reason. Pending uploads are preserved; an in-flight request may finish." :
                    command == "DISABLE_STARTUP" ? "Exactly owned startup disabled and local pause persisted. No task or data deleted." :
                    "Separate sign-in startup opt-in saved. Local intent remains PAUSED; no task was explicitly run.";
            });
        }
        async Task LoadProfiles() { await LoadProfiles(null); }
        async Task LoadProfiles(string preferredId) {
            var previous = profiles.SelectedItem as ProfileItem;
            string selectedId = preferredId ?? (previous == null ? null : previous.Id);
            var result = await Runtime.Request(new {action = "LIST"});
            var rows = result["profiles"] as IList; if (rows == null) throw new InvalidOperationException();
            profiles.Items.Clear(); foreach (var row in rows) profiles.Items.Add(new ProfileItem((Dictionary<string, object>)row));
            bool any = profiles.Items.Count > 0;
            if (!any) profiles.Items.Add("No saved setups — open your app setup file above");
            profiles.SelectedItem = profiles.Items.OfType<ProfileItem>().FirstOrDefault(item => item.Id == selectedId);
            if (profiles.SelectedIndex < 0) profiles.SelectedIndex = 0;
            ProfilesLoaded = true;
            state.Text = any ? "Setup ready. Next: approve browser access, then verify the connection." : "Start with step 1: open the public configuration downloaded from Trade OS. Approval becomes available after import.";
        }
        async Task Execute(Func<Task> work) {
            busy = true; UpdateActions(); state.Text = "Working. No additional action can run while this request is pending.";
            try { await work(); }
            catch (CompanionFailure error) { state.Text = error.Message; }
            catch { state.Text = "The acknowledgement is unavailable. Check saved setup/access; refresh local health and inspect startup before retrying a control. A write may have completed. No process is force-killed or raw provider error displayed."; }
            finally { busy = false; if (!IsDisposed) UpdateActions(); }
        }
        async Task Connect(string command, bool freshConsent = false) {
            await Execute(async () => {
                ProfileItem selected = Selected();
                if (selected.Purpose == "MCP") {
                    await Runtime.VerifyMcp(selected.Id);
                    await Runtime.Run(Runtime.Command(false, new[] { Path.Combine(Runtime.Root, "integrations", "mcp", "cli.mjs"), command, "--config", Runtime.ProfilePath(selected.Id), "--gui" }), null, 360);
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
        async Task ProbeTerminal(bool adopt) {
            ProfileItem selected = Selected();
            if (selected.Purpose != "MT5") throw new InvalidOperationException();
            if (MessageBox.Show(this, "Verify only your dedicated DEMO terminal? The selected installation may open. No account login/switch, trade history read or order operation is performed. Existing adoption requires PAUSED state and zero pending uploads.", "Explicit terminal verification", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            string executable, oldManifest = null; bool portable = false;
            using (var chooser = new OpenFileDialog { CheckFileExists = true, Multiselect = false,
                Filter = adopt ? "Existing collector manifest (connection.json)|connection.json" : "MT5 64-bit terminal (terminal64.exe)|terminal64.exe" }) {
                if (chooser.ShowDialog(this) != DialogResult.OK) return;
                executable = chooser.FileName;
                if (adopt) oldManifest = chooser.FileName;
            }
            await Execute(async () => {
                if (adopt) {
                    var old = await Runtime.Request(new {action = "INSPECT_EXISTING", profileId = selected.Id, manifestPath = oldManifest});
                    executable = (string)old["executable"]; portable = (bool)old["portable"];
                } else {
                    portable = MessageBox.Show(this, "Is this dedicated terminal explicitly configured in PORTABLE mode? Choose No for a normal installation.", "Terminal mode", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
                }
                var result = await Runtime.Request(new {action = "PROBE", profileId = selected.Id, executable, portable, existingManifest = oldManifest, dedicatedApproved = true});
                string path = (string)result["proposalPath"];
                proposals[selected.Id] = path; Clipboard.SetText(path);
                state.Text = "Demo identity verified. Review-file path copied: " + path + ". Open Trade OS setup, select this file and explicitly approve mapping within 15 minutes. No collector started.";
            });
        }
        async Task ActivateMapping() {
            ProfileItem selected = Selected();
            if (selected.Purpose != "MT5") throw new InvalidOperationException();
            string proposal;
            if (!proposals.TryGetValue(selected.Id, out proposal)) {
                using (var chooser = new OpenFileDialog { Filter = "Saved terminal review (pairing-*.json)|pairing-*.json", CheckFileExists = true,
                    InitialDirectory = Path.GetDirectoryName(Runtime.ProfilePath(selected.Id)), Title = "Choose the original saved terminal proposal" }) {
                    if (chooser.ShowDialog(this) != DialogResult.OK) return; proposal = chooser.FileName;
                }
            }
            using (var chooser = new OpenFileDialog { Filter = "Approved Trade OS mapping (*.json)|*.json", CheckFileExists = true, Title = "Choose the mapping downloaded after browser approval" }) {
                if (chooser.ShowDialog(this) != DialogResult.OK) return;
                if (MessageBox.Show(this, "Verify the live server approval and selected terminal again, then initialize PAUSED? Existing adoption updates only the selected manifest's public client configuration and preserves its spool. No startup or collection is enabled.", "Import reviewed mapping", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
                string mapping = chooser.FileName;
                await Execute(async () => {
                    var result = await Runtime.Request(new {action = "ACTIVATE", profileId = selected.Id, proposalPath = proposal, manifestPath = mapping});
                    if ((string)result["state"] != "PAUSED") throw new InvalidOperationException();
                    state.Text = "Server-approved mapping initialized PAUSED. Pending uploads: " + result["pendingPages"] + ". History approval, collection and startup remain separate. Manifest: " + result["manifestPath"];
                });
            }
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
                        return Runtime.Relay(child, Console.OpenStandardInput(), Console.OpenStandardOutput(), Console.OpenStandardError());
                    }
                }
            } catch { Console.Error.WriteLine("Trade OS companion: MCP unavailable. Import a valid app setup and approve access in the companion."); return 1; }
        }
    }
}
