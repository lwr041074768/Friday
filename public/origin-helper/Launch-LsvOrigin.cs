using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;

public static class LsvOriginLauncher
{
    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1 || !Regex.IsMatch(args[0], @"\Alsv-origin://import/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z", RegexOptions.IgnoreCase))
                throw new ArgumentException("Invalid Origin helper request.");
            string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string monitor = Path.Combine(root, "Start-LsvOrigin.ps1");
            string powershell = Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"), @"System32\WindowsPowerShell\v1.0\powershell.exe");
            if (!File.Exists(monitor) || !File.Exists(powershell))
                throw new FileNotFoundException("Origin helper files are missing. Please reinstall the complete helper package.");
            // Launch only the reviewed local monitor, with a strictly validated data argument.
            ProcessStartInfo start = new ProcessStartInfo(powershell);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -File \"" + monitor + "\" -RequestUri \"" + args[0] + "\"";
            using (Process process = Process.Start(start))
            {
                if (process == null) throw new InvalidOperationException("The Origin helper did not start.");
            }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Scientific Plot Studio - Origin", MessageBoxButtons.OK, MessageBoxIcon.Error,
                MessageBoxDefaultButton.Button1, MessageBoxOptions.DefaultDesktopOnly);
            return 1;
        }
    }
}
