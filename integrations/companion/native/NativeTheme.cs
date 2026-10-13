using System;
using System.Drawing;
using System.Windows.Forms;

namespace TradeOS.Companion {
    internal static class NativeTheme {
        internal static readonly Color Background = Color.FromArgb(8, 13, 20);
        internal static readonly Color Surface = Color.FromArgb(21, 28, 39);
        internal static readonly Color Text = Color.FromArgb(239, 240, 243);
        internal static readonly Color Muted = Color.FromArgb(180, 193, 210);
        internal static readonly Color Border = Color.FromArgb(72, 88, 108);
        internal static readonly Color Accent = Color.FromArgb(239, 177, 37);
    }

    // Keep Button's keyboard, accessibility and Enabled semantics, but paint the
    // disabled label ourselves: Windows' default disabled ink is black on navy.
    internal sealed class ThemedButton : Button {
        internal bool Primary { get; set; }
        bool hover, pressed;
        internal ThemedButton() {
            FlatStyle = FlatStyle.Flat; UseVisualStyleBackColor = false;
            BackColor = NativeTheme.Surface; ForeColor = NativeTheme.Text;
            FlatAppearance.BorderColor = NativeTheme.Border;
            SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true);
        }
        protected override void OnMouseEnter(EventArgs e) { hover = true; base.OnMouseEnter(e); Invalidate(); }
        protected override void OnMouseLeave(EventArgs e) { hover = pressed = false; base.OnMouseLeave(e); Invalidate(); }
        protected override void OnMouseDown(MouseEventArgs e) { pressed = e.Button == MouseButtons.Left; base.OnMouseDown(e); Invalidate(); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; base.OnMouseUp(e); Invalidate(); }
        protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode == Keys.Space) pressed = true; base.OnKeyDown(e); Invalidate(); }
        protected override void OnKeyUp(KeyEventArgs e) { pressed = false; base.OnKeyUp(e); Invalidate(); }
        protected override void OnEnabledChanged(EventArgs e) { pressed = false; base.OnEnabledChanged(e); Invalidate(); }
        protected override void OnPaint(PaintEventArgs e) {
            bool contrast = SystemInformation.HighContrast;
            Color surface = contrast ? SystemColors.Control : !Enabled ? NativeTheme.Surface :
                Primary ? NativeTheme.Accent : pressed ? Color.FromArgb(42, 57, 76) : hover ? Color.FromArgb(31, 43, 59) : NativeTheme.Surface;
            Color ink = contrast ? SystemColors.ControlText : !Enabled ? NativeTheme.Muted : Primary ? NativeTheme.Background : NativeTheme.Text;
            using (var brush = new SolidBrush(surface)) e.Graphics.FillRectangle(brush, ClientRectangle);
            using (var pen = new Pen(contrast ? SystemColors.ControlText : Focused && Enabled ? NativeTheme.Accent : NativeTheme.Border))
                e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            var bounds = new Rectangle(Padding.Left + 3, Padding.Top + 2,
                Math.Max(1, Width - Padding.Horizontal - 6), Math.Max(1, Height - Padding.Vertical - 4));
            TextRenderer.DrawText(e.Graphics, Text, Font, bounds, ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
            if (Focused && ShowFocusCues && Enabled) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle, -4, -4), ink, surface);
        }
    }

    internal sealed class ProfileSelector : ComboBox {
        internal ProfileSelector() {
            DropDownStyle = ComboBoxStyle.DropDownList; DrawMode = DrawMode.OwnerDrawFixed;
            FlatStyle = FlatStyle.Flat; BackColor = NativeTheme.Surface; ForeColor = NativeTheme.Text;
            AccessibleName = "Saved integration setup";
            AccessibleDescription = "Import an app setup file, then select the connection to configure.";
            IntegralHeight = false; DropDownHeight = 240;
        }
        protected override void OnFontChanged(EventArgs e) { base.OnFontChanged(e); ItemHeight = Font.Height + 12; }
        protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }
        protected override void OnSelectedIndexChanged(EventArgs e) { base.OnSelectedIndexChanged(e); Invalidate(); }
        // Native ComboBox can ignore owner drawing for a disabled closed field.
        // Paint that field for both the live window and WM_PRINT screenshots;
        // the native popup, keyboard navigation and accessible value stay intact.
        protected override void WndProc(ref Message message) {
            base.WndProc(ref message);
            if (message.Msg == 0x000F) {
                using (var graphics = Graphics.FromHwnd(Handle)) PaintSelection(graphics);
            } else if ((message.Msg == 0x0317 || message.Msg == 0x0318) && message.WParam != IntPtr.Zero) {
                using (var graphics = Graphics.FromHdc(message.WParam)) PaintSelection(graphics);
            }
        }
        void PaintSelection(Graphics graphics) {
            Color surface = SystemInformation.HighContrast ? SystemColors.Window : NativeTheme.Surface;
            Color ink = SystemInformation.HighContrast ? SystemColors.WindowText : Enabled ? NativeTheme.Text : NativeTheme.Muted;
            using (var brush = new SolidBrush(surface)) graphics.FillRectangle(brush, ClientRectangle);
            using (var pen = new Pen(SystemInformation.HighContrast ? SystemColors.WindowText : Focused && Enabled ? NativeTheme.Accent : NativeTheme.Border))
                graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            string label = SelectedItem == null ? "Open an app setup file to get started" : GetItemText(SelectedItem);
            TextRenderer.DrawText(graphics, label, Font, new Rectangle(10, 1, Math.Max(1, Width - 44), Height - 2), ink,
                TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            int x = Width - 19, y = Height / 2;
            using (var pen = new Pen(ink, 2)) { graphics.DrawLine(pen, x - 4, y - 2, x, y + 2); graphics.DrawLine(pen, x, y + 2, x + 4, y - 2); }
            if (Focused && ShowFocusCues && Enabled) ControlPaint.DrawFocusRectangle(graphics, Rectangle.Inflate(ClientRectangle, -4, -4), ink, surface);
        }
        protected override void OnDrawItem(DrawItemEventArgs e) {
            bool highlighted = Enabled && (e.State & DrawItemState.Selected) != 0;
            Color surface = SystemInformation.HighContrast ? (highlighted ? SystemColors.Highlight : SystemColors.Window) :
                highlighted ? Color.FromArgb(42, 57, 76) : NativeTheme.Surface;
            Color ink = SystemInformation.HighContrast ? (highlighted ? SystemColors.HighlightText : SystemColors.WindowText) :
                Enabled ? NativeTheme.Text : NativeTheme.Muted;
            using (var brush = new SolidBrush(surface)) e.Graphics.FillRectangle(brush, e.Bounds);
            string label = e.Index >= 0 && e.Index < Items.Count ? GetItemText(Items[e.Index]) : "Open an app setup file to get started";
            var bounds = new Rectangle(e.Bounds.X + 10, e.Bounds.Y, Math.Max(1, e.Bounds.Width - 20), e.Bounds.Height);
            TextRenderer.DrawText(e.Graphics, label, Font, bounds, ink,
                TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            if ((e.State & DrawItemState.Focus) != 0) ControlPaint.DrawFocusRectangle(e.Graphics, e.Bounds, ink, surface);
        }
    }
}
