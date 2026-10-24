#requires -Version 5.1
param([string]$RequestUri,[long]$ReturnWindow=0)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$request=$RequestUri -match '\Alsv-origin://jade/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\z'
if(!$request){throw 'JADE 请求地址无效。'}
$requestId=$Matches[1].ToLowerInvariant()
try {
 Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
public sealed class JadeCardWindow {public long Handle;public uint Process;public string Caption;public string Number;}
public static class SelectedJadeReader {
 public delegate bool EnumProc(IntPtr window,IntPtr state);
 [StructLayout(LayoutKind.Sequential)]struct Rect{public int Left;public int Top;public int Right;public int Bottom;}
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr state);
 [DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr state);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")]static extern IntPtr GetParent(IntPtr window);
 [DllImport("user32.dll")]static extern int GetDlgCtrlID(IntPtr window);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr window,StringBuilder text,int count);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr window,StringBuilder text,int count);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr window,out Rect rectangle);
 [DllImport("user32.dll",SetLastError=true)]static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr w,IntPtr l,uint flags,uint time,out IntPtr result);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW",SetLastError=true)]static extern IntPtr ReadWindowTextTimeout(IntPtr window,uint message,IntPtr count,StringBuilder text,uint flags,uint time,out IntPtr result);
 [DllImport("user32.dll")]public static extern uint GetClipboardSequenceNumber();
 [DllImport("user32.dll")]static extern IntPtr GetClipboardOwner();
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr window);
 public static string Title(long window){var s=new StringBuilder(1024);GetWindowText((IntPtr)window,s,s.Capacity);return s.ToString();}
 static string Class(IntPtr window){var s=new StringBuilder(128);GetClassName(window,s,s.Capacity);return s.ToString();}
 public static JadeCardWindow CurrentCard(){
  var processes=new HashSet<uint>();foreach(var p in Process.GetProcessesByName("jade9c")){processes.Add((uint)p.Id);p.Dispose();}
  var cards=new List<JadeCardWindow>();
  EnumWindows((window,state)=>{uint p;GetWindowThreadProcessId(window,out p);if(processes.Contains(p)&&IsWindowVisible(window)&&Class(window)=="ThunderRT6FormDC"){
   string title=Title(window.ToInt64());var m=Regex.Match(title,@"\APDF#(\d{2}-\d{3}-\d{4}):");if(m.Success)cards.Add(new JadeCardWindow{Handle=window.ToInt64(),Process=p,Caption=title,Number=m.Groups[1].Value});
  }return true;},IntPtr.Zero);
  if(cards.Count!=1)throw new Exception(cards.Count==0?"请在 JADE 9 中打开需要的标准卡片详细窗口。":"请只保留一张需要读取的标准卡片详细窗口，避免选错卡片。");return cards[0];
 }
 static IntPtr Child(JadeCardWindow card,string expectedClass,int id){
  IntPtr found=IntPtr.Zero;EnumChildWindows((IntPtr)card.Handle,(window,state)=>{uint p;GetWindowThreadProcessId(window,out p);if(p==card.Process&&GetParent(window).ToInt64()==card.Handle&&Class(window)==expectedClass&&(id<0||GetDlgCtrlID(window)==id))found=window;return true;},IntPtr.Zero);return found;
 }
 public static double Wavelength(JadeCardWindow card){var combo=Child(card,"ThunderRT6ComboBox",19);if(combo==IntPtr.Zero)throw new Exception("无法确认 JADE 卡片显示波长。");var text=new StringBuilder(1024);IntPtr r;if(ReadWindowTextTimeout(combo,13,(IntPtr)text.Capacity,text,2,500,out r)==IntPtr.Zero)throw new Exception("无法读取 JADE 波长。");return ExtractWavelength(text.ToString());}
 static double ExtractWavelength(string text){var m=Regex.Match(text,@"([0-9]+\.[0-9]+)");double value;if(!m.Success||!double.TryParse(m.Groups[1].Value,System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out value)||value<=0||value>10)throw new Exception("JADE 波长无效。");return value;}
 public static void ShowPeaks(JadeCardWindow card){
  var tab=Child(card,"TabStrip20WndClass",-1);if(tab==IntPtr.Zero)throw new Exception("当前 JADE 版本的卡片页签暂不支持。");Rect a,b;GetWindowRect((IntPtr)card.Handle,out a);GetWindowRect(tab,out b);
  // TabStrip includes the whole card page; its height is not the tab header.
  // This point is grounded in the JADE 9 Chinese card's second tab header.
  int height=b.Bottom-b.Top,x=71,y=11;
  if(x<0||x>=b.Right-b.Left||y<0||y>=height)throw new Exception("卡片页签布局不符合已验证的 JADE 9 布局。");IntPtr point=(IntPtr)((y<<16)|x),r;
  if(SendMessageTimeout(tab,0x201,(IntPtr)1,point,2,1000,out r)==IntPtr.Zero||SendMessageTimeout(tab,0x202,IntPtr.Zero,point,2,1000,out r)==IntPtr.Zero)throw new Exception("无法打开卡片峰线表。");
 }
 public static void Copy(JadeCardWindow card){if(Title(card.Handle)!=card.Caption)throw new Exception("读取时卡片已变化，请重试。");var copy=Child(card,"ThunderRT6CommandButton",21);if(copy==IntPtr.Zero)throw new Exception("未找到已验证的 JADE 9 卡片复制按钮。");IntPtr r;if(SendMessageTimeout(copy,0xf5,IntPtr.Zero,IntPtr.Zero,2,3000,out r)==IntPtr.Zero)throw new Exception("JADE 未响应卡片复制请求。");}
 public static bool OwnClipboard(JadeCardWindow card){uint p;GetWindowThreadProcessId(GetClipboardOwner(),out p);return p==card.Process&&Title(card.Handle)==card.Caption;}
 public static void ReturnToBrowser(long handle){if(handle==0)return;uint p;GetWindowThreadProcessId((IntPtr)handle,out p);try{using(var process=Process.GetProcessById((int)p)){if(process.ProcessName.Equals("msedge",StringComparison.OrdinalIgnoreCase)||process.ProcessName.Equals("chrome",StringComparison.OrdinalIgnoreCase))SetForegroundWindow((IntPtr)handle);}}catch{}}
}
'@
 $card=[SelectedJadeReader]::CurrentCard()
 $wavelength=[SelectedJadeReader]::Wavelength($card)
 [SelectedJadeReader]::ShowPeaks($card)
 $before=[SelectedJadeReader]::GetClipboardSequenceNumber()
 [SelectedJadeReader]::Copy($card)
 if([SelectedJadeReader]::GetClipboardSequenceNumber() -eq $before -or ![SelectedJadeReader]::OwnClipboard($card)){throw 'JADE 未提供本次卡片的完整数据，请重试。'}
 $text=[Windows.Forms.Clipboard]::GetText()
 if($text.Length -gt 1000000 -or !$text.StartsWith($card.Caption) -or $text -notmatch '(?m)^2[θϑ]\t'){throw 'JADE 返回的内容不是本次标准卡片峰表。'}
 $packet=[ordered]@{schema='jade-card/v1';requestId=$requestId;cardNumber=$card.Number;wavelength=$wavelength;text=$text}
 [Windows.Forms.Clipboard]::SetText("SCIENTIFIC_PLOT_JADE_V1`n"+($packet|ConvertTo-Json -Compress))
 $logDirectory=Join-Path $PSScriptRoot 'Logs';[void][IO.Directory]::CreateDirectory($logDirectory)
 [IO.File]::WriteAllText((Join-Path $logDirectory ('jade-'+$requestId+'.json')),([ordered]@{success=$true;requestId=$requestId;card=$card.Number;wavelength=$wavelength;textLength=$text.Length}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 [SelectedJadeReader]::ReturnToBrowser($ReturnWindow)
} catch {
 $failureMessage=$_.Exception.Message
 try{[Windows.Forms.Clipboard]::SetText("SCIENTIFIC_PLOT_JADE_V1`n"+([ordered]@{schema='jade-card/v1';requestId=$requestId;error=$failureMessage}|ConvertTo-Json -Compress))}catch{}
 $logDirectory=Join-Path $PSScriptRoot 'Logs';[void][IO.Directory]::CreateDirectory($logDirectory)
 [IO.File]::WriteAllText((Join-Path $logDirectory ('jade-'+$requestId+'.json')),([ordered]@{success=$false;requestId=$requestId;error=$failureMessage}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 if($ReturnWindow){try{[SelectedJadeReader]::ReturnToBrowser($ReturnWindow)}catch{}}
 else{[void][Windows.Forms.MessageBox]::Show($failureMessage,'JADE 标准卡读取',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Warning)}
 exit 1
}
