using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "runtime", "node.exe");
        string server = Path.Combine(root, "desktop", "server.mjs");
        bool stop = Array.IndexOf(args, "--stop") >= 0;
        bool noOpen = Array.IndexOf(args, "--no-open") >= 0;
        try
        {
            if (!File.Exists(node) || !File.Exists(server))
                throw new Exception("请先完整解压安装包，再启动科研绘图软件。");
            var info = new ProcessStartInfo(node, "\"" + server + "\"" + (stop ? " --stop" : "") + (noOpen ? " --no-open" : ""));
            info.WorkingDirectory = root;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            using (var process = Process.Start(info))
            {
                if (stop)
                {
                    if (!process.WaitForExit(10000)) throw new Exception("停止请求超时，请稍后重试。");
                    if (process.ExitCode != 0) throw new Exception("本地服务停止失败，请查看 .runtime\\error.log。");
                    return 0;
                }
                string state = Path.Combine(root, ".runtime", "status.json");
                for (int i = 0; i < 150; i++)
                {
                    if (process.HasExited)
                    {
                        if (process.ExitCode != 0) throw new Exception("启动失败，请查看 .runtime\\error.log。");
                        return 0;
                    }
                    if (File.Exists(state))
                    {
                        string text = File.ReadAllText(state);
                        if (System.Text.RegularExpressions.Regex.IsMatch(text, "\"pid\"\\s*:\\s*" + process.Id + "\\s*[,}]")) return 0;
                    }
                    Thread.Sleep(100);
                }
                throw new Exception("本地服务启动超时，请查看 .runtime\\error.log。");
            }
        }
        catch (Exception error)
        {
            if (!noOpen) MessageBox.Show(error.Message, "科研绘图软件", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
