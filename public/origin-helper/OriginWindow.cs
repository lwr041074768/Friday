using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

// Control only the independently created Origin recorded by this import.
// The monitor never connects to another project's COM server.
public static class OriginHelperWindow
{
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);

    public static bool ShowImportedOrigin(long handle, int processId, long startedAt)
    {
        if (handle <= 0 || processId <= 0 || startedAt <= 0) return false;
        IntPtr window = new IntPtr(handle);
        uint actualId;
        if (!IsWindow(window) || GetWindowThreadProcessId(window, out actualId) == 0 || actualId != processId) return false;
        try
        {
            using (Process process = Process.GetProcessById(processId))
            {
                if ((process.ProcessName != "Origin64" && process.ProcessName != "Origin") ||
                    process.StartTime.ToUniversalTime().Ticks != startedAt || process.MainWindowHandle != window) return false;
            }
            ShowWindowAsync(window, IsIconic(window) ? 9 : 5); // SW_RESTORE / SW_SHOW.
            return SetForegroundWindow(window);
        }
        catch (InvalidOperationException) { return false; }
        catch (ArgumentException) { return false; }
        catch (System.ComponentModel.Win32Exception) { return false; }
    }
}
