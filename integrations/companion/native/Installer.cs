using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace TradeOS.Companion {
    internal static class PackageInstaller {
        internal static string SafePath(string path) {
            string full = Path.GetFullPath(path);
            if (full != path || full.StartsWith("\\\\") || !Regex.IsMatch(full, "^[A-Za-z]:\\\\") || full.Substring(2).Contains(":")) throw new InvalidOperationException();
            for (var current = new DirectoryInfo(full); current != null; current = current.Parent)
                if (current.Exists && (current.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
            return full;
        }
        internal static string RelativePath(string name) {
            if (string.IsNullOrEmpty(name) || name.Length > 240 || name.Contains("\\") || name.Contains(":")) throw new InvalidOperationException();
            var parts = name.Split('/');
            if (parts.Any(part => part == "" || part == "." || part == ".." || part.EndsWith(" ") || part.EndsWith(".") ||
                part.Any(c => char.IsControl(c) || "<>|?*\"".Contains(c)) || Regex.IsMatch(part, "^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\\..*)?$", RegexOptions.IgnoreCase))) throw new InvalidOperationException();
            return Path.Combine(parts);
        }
        internal static void Protect(string directory) {
            var security = new DirectorySecurity(); security.SetAccessRuleProtection(true, false);
            foreach (SecurityIdentifier sid in new[] { WindowsIdentity.GetCurrent().User, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
                security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            Directory.SetAccessControl(directory, security);
        }
        static void CopyLimited(Stream input, Stream output, long limit) {
            var buffer = new byte[65536]; long total = 0; int count;
            while ((count = input.Read(buffer, 0, buffer.Length)) != 0) {
                total += count; if (total > limit) throw new InvalidOperationException();
                output.Write(buffer, 0, count);
            }
            if (total != limit) throw new InvalidOperationException();
        }
        static string Digest(Stream stream, long limit) {
            using (var algorithm = SHA256.Create()) {
                var buffer = new byte[65536]; long total = 0; int count;
                while ((count = stream.Read(buffer, 0, buffer.Length)) != 0) {
                    total += count; if (total > limit) throw new InvalidOperationException();
                    algorithm.TransformBlock(buffer, 0, count, buffer, 0);
                }
                if (total != limit) throw new InvalidOperationException();
                algorithm.TransformFinalBlock(new byte[0], 0, 0);
                return BitConverter.ToString(algorithm.Hash).Replace("-", "").ToLowerInvariant();
            }
        }
        internal static string Install(Stream payload, string selectedRoot) {
            string root = SafePath(selectedRoot);
            using (var archive = new ZipArchive(payload, ZipArchiveMode.Read, true)) {
                var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
                long bytes = 0;
                foreach (var entry in archive.Entries) {
                    RelativePath(entry.FullName);
                    if (entries.ContainsKey(entry.FullName) || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw new InvalidOperationException();
                    bytes += entry.Length;
                    if (entries.Count >= 12000 || entry.Length < 0 || bytes > 512L * 1024 * 1024) throw new InvalidOperationException();
                    entries.Add(entry.FullName, entry);
                }
                ZipArchiveEntry manifestEntry;
                if (!entries.TryGetValue("bundle-manifest.json", out manifestEntry) || manifestEntry.Length > 2 * 1024 * 1024) throw new InvalidOperationException();
                string manifestText;
                using (var input = manifestEntry.Open()) using (var raw = new MemoryStream()) {
                    CopyLimited(input, raw, manifestEntry.Length); manifestText = System.Text.Encoding.UTF8.GetString(raw.ToArray());
                }
                var json = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024, RecursionLimit = 16 };
                var manifest = json.Deserialize<Dictionary<string, object>>(manifestText);
                if ((int)manifest["version"] != 1 || (string)manifest["platform"] != "win-x64" || (string)manifest["releaseState"] != "UNRELEASED") throw new InvalidOperationException();
                var files = manifest["files"] as IList;
                if (files == null || files.Count + 1 != entries.Count) throw new InvalidOperationException();
                var expected = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
                foreach (var item in files) {
                    var file = item as Dictionary<string, object>;
                    if (file == null || file.Count != 3) throw new InvalidOperationException();
                    string name = (string)file["path"], hash = (string)file["sha256"]; RelativePath(name);
                    ZipArchiveEntry entry;
                    if (!Regex.IsMatch(hash, "^[a-f0-9]{64}$") || expected.ContainsKey(name) || !entries.TryGetValue(name, out entry) || Convert.ToInt64(file["size"]) != entry.Length) throw new InvalidOperationException();
                    using (var contents = entry.Open()) if (Digest(contents, entry.Length) != hash) throw new InvalidOperationException();
                    expected.Add(name, file);
                }
                foreach (var required in new[] {"TradeOS.exe", "TradeOSMcp.exe", "runtime/node/node.exe", "runtime/python/python.exe", "runtime/python/pythonw.exe"})
                    if (!expected.ContainsKey(required)) throw new InvalidOperationException();
                string revision;
                using (var raw = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(manifestText))) revision = Digest(raw, raw.Length).Substring(0, 16);
                string destination = SafePath(Path.Combine(root, "companion-" + revision));
                if (Directory.Exists(destination) || File.Exists(destination)) throw new InvalidOperationException();
                Directory.CreateDirectory(root); // No ACL/contents change to an existing selected parent.
                string staging = SafePath(Path.Combine(root, "install-" + Guid.NewGuid().ToString("D")));
                Directory.CreateDirectory(staging); Protect(staging);
                // Preserve failed staging for inspection; never recursive-delete user data.
                foreach (var pair in entries) {
                    string target = Path.GetFullPath(Path.Combine(staging, RelativePath(pair.Key)));
                    if (!target.StartsWith(staging + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException();
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var input = pair.Value.Open()) using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { CopyLimited(input, output, pair.Value.Length); output.Flush(true); }
                    var file = expected.ContainsKey(pair.Key) ? expected[pair.Key] : null;
                    if (file != null) using (var actual = File.OpenRead(target)) if (Digest(actual, Convert.ToInt64(file["size"])) != (string)file["sha256"]) throw new InvalidOperationException();
                }
                // Both explicit absolute paths were validated inside the chosen root.
                SafePath(staging); SafePath(destination); Directory.Move(staging, destination);
                return destination;
            }
        }
    }

    internal sealed class InstallerWindow : Form {
        readonly TextBox location = new TextBox { Width = 620, AccessibleName = "Per-user installation folder" };
        readonly Label status = new Label { AutoSize = true, MaximumSize = new Size(650, 0) };
        readonly Button install;
        internal InstallerWindow() {
            Text = "Install Trade OS companion — private test build"; Size = new Size(760, 410); MinimumSize = Size;
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10); BackColor = Color.FromArgb(8, 13, 20); ForeColor = Color.FromArgb(239, 240, 243);
            var body = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(28), AutoScroll = true }; Controls.Add(body);
            body.Controls.Add(new Label { Text = "Trade OS companion", Font = new Font("Segoe UI", 22, FontStyle.Bold), AutoSize = true });
            body.Controls.Add(new Label { Text = "Unsigned private test artifact. This installs files only: no registry changes, startup task, terminal launch or connection approval.", AutoSize = true, MaximumSize = new Size(650, 0), Margin = new Padding(0, 15, 0, 15) });
            location.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "TradeOS"); body.Controls.Add(location);
            var browse = new Button { Text = "Choose another local drive/folder", AutoSize = true, Margin = new Padding(0, 10, 0, 10) };
            browse.Click += (sender, args) => { using (var chooser = new FolderBrowserDialog { Description = "Choose a local parent folder. Existing files will not be replaced.", ShowNewFolderButton = true }) if (chooser.ShowDialog(this) == DialogResult.OK) location.Text = chooser.SelectedPath; }; body.Controls.Add(browse);
            install = new Button { Text = "Install private test build", AutoSize = true, Padding = new Padding(10), BackColor = Color.FromArgb(239, 177, 37), ForeColor = Color.Black };
            install.Click += async (sender, args) => {
                install.Enabled = false; browse.Enabled = false; location.Enabled = false; status.Text = "Verifying package and installing into a new protected version folder…";
                try {
                    string chosen = location.Text;
                    string installed = await Task.Run(() => { using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("TradeOS.Payload")) {
                        if (payload == null) throw new InvalidOperationException(); return PackageInstaller.Install(payload, chosen); } });
                    status.Text = "Installed: " + installed + "\nOpen TradeOS.exe in that folder. No integration was connected or started.";
                } catch { status.Text = "Installation was not completed. Existing versions and user data were preserved. Check available disk space and choose a local, non-linked folder."; install.Enabled = true; browse.Enabled = true; location.Enabled = true; }
            }; body.Controls.Add(install); status.Margin = new Padding(0, 15, 0, 0); body.Controls.Add(status);
            body.SizeChanged += (sender, args) => {
                int width = Math.Max(300, body.ClientSize.Width - body.Padding.Horizontal - SystemInformation.VerticalScrollBarWidth);
                location.Width = width;
                foreach (Label label in body.Controls.OfType<Label>()) label.MaximumSize = new Size(width, 0);
            };
        }
    }
    internal static class InstallerProgram {
        [STAThread] static void Main(string[] args) {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            if (args.Length != 0) return;
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new InstallerWindow());
        }
    }
}
