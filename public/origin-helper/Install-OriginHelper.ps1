param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Keep all real-registry operations inside this user's one protocol. Named WMI
# inputs avoid the positional argument order differences in Windows PowerShell.
function Invoke-OwnProtocolRegistry($Provider, [string]$Sid, [string]$Method, [string]$Suffix = '', [string]$Name = '', [string]$Value = '') {
    if ($Sid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw '只能更新当前用户的本助手协议。' }
    if ($Method -notin @('EnumKey','GetStringValue','CreateKey','SetStringValue')) { throw '不支持的注册表操作。' }
    if ($Suffix -notin @('','shell','shell\open','shell\open\command')) { throw '注册表路径超出本助手协议。' }
    $key = $Sid + '\Software\Classes'
    if ($Method -ne 'EnumKey') {
        $key += '\lsv-origin'
        if ($Suffix) { $key += '\' + $Suffix }
        if ($Name -notin @('','URL Protocol','ScientificPlotStudioOwner','ScientificPlotStudioVersion') -or
            ($Suffix -and $Name)) { throw '注册表值超出本助手协议。' }
    } elseif ($Suffix -or $Name -or $Value) { throw '枚举只允许读取当前用户的协议目录。' }
    $inputParameters = $Provider.GetMethodParameters($Method)
    $inputParameters.hDefKey = [uint32]2147483651 # HKEY_USERS, never HKEY_LOCAL_MACHINE.
    $inputParameters.sSubKeyName = $key
    if ($Method -in @('GetStringValue','SetStringValue')) { $inputParameters.sValueName = $Name }
    if ($Method -eq 'SetStringValue') { $inputParameters.sValue = $Value }
    $result = $Provider.InvokeMethod($Method, $inputParameters, $null)
    if ($null -eq $result -or $null -eq $result.PSObject.Properties['ReturnValue'] -or $null -eq $result.ReturnValue) { throw '真实用户注册表未返回操作结果。' }
    return $result
}

function Read-OwnProtocolString($Provider, [string]$Sid, [string]$Suffix, [string]$Name) {
    $result = Invoke-OwnProtocolRegistry $Provider $Sid 'GetStringValue' $Suffix $Name
    if ($result.ReturnValue -eq 2) { return [pscustomobject]@{ Exists = $false; Value = '' } }
    if ($result.ReturnValue -ne 0 -or $result.sValue -isnot [string]) { throw "读取真实用户注册表失败，代码 $($result.ReturnValue)。" }
    return [pscustomobject]@{ Exists = $true; Value = $result.sValue }
}

function Write-OwnProtocolRegistry($Provider, [string]$Sid, [string]$Method, [string]$Suffix = '', [string]$Name = '', [string]$Value = '') {
    if ($Method -notin @('CreateKey','SetStringValue')) { throw '不支持的注册表写入操作。' }
    $result = Invoke-OwnProtocolRegistry $Provider $Sid $Method $Suffix $Name $Value
    if ($result.ReturnValue -ne 0) { throw "写入真实用户注册表失败，代码 $($result.ReturnValue)。" }
}

function Assert-OwnedProtocol([string]$ExistingOwner, [string]$ExistingLabel, [string]$ExistingCommand, [string]$PowerShell, [string[]]$HelperDirectories) {
    if ($ExistingOwner -cne 'ScientificPlotStudio/OriginHelper/v1' -or $ExistingLabel -cne 'URL:Scientific Plot Studio Origin Helper') {
        throw 'lsv-origin 协议已由其他程序注册或缺少本助手标记。为避免覆盖已有程序，安装已停止。'
    }
    foreach ($directory in $HelperDirectories) {
        $ownLauncher = Join-Path $directory 'Launch-LsvOrigin.exe'
        if ($ExistingCommand -ieq ('"' + $ownLauncher + '" "%1"')) { return }
        $ownImporter = Join-Path $directory 'Import-LsvOrigin.ps1'
        $pattern = '\A"?' + [regex]::Escape($PowerShell) + '"?\s+-NoProfile\s+-STA(?:\s+-WindowStyle\s+Hidden)?\s+-ExecutionPolicy\s+Bypass\s+-File\s+"?' +
            [regex]::Escape($ownImporter) + '"?\s+-RequestUri\s+"?%1"?\z'
        if ($ExistingCommand -match $pattern) { return }
    }
    throw 'lsv-origin 指向非本助手的命令。为避免覆盖已有程序，安装已停止。'
}

function Assert-RealOwnedProtocol($Provider, [string]$Sid, [string]$PowerShell, [string[]]$HelperDirectories) {
    # A missing value (GetStringValue=2) does not prove its key is absent. An
    # existing empty/unmarked key must not be claimed by this installer.
    $keys = Invoke-OwnProtocolRegistry $Provider $Sid 'EnumKey'
    if ($keys.ReturnValue -eq 2) { return }
    if ($keys.ReturnValue -ne 0) { throw "检查真实用户协议失败，代码 $($keys.ReturnValue)。" }
    if (@($keys.sNames) -notcontains 'lsv-origin') { return }
    $existingOwner = Read-OwnProtocolString $Provider $Sid '' 'ScientificPlotStudioOwner'
    $existingLabel = Read-OwnProtocolString $Provider $Sid '' ''
    $existingCommand = Read-OwnProtocolString $Provider $Sid 'shell\open\command' ''
    if (!$existingOwner.Exists -or !$existingLabel.Exists -or !$existingCommand.Exists) {
        throw '真实用户注册表已有 lsv-origin，但缺少本助手所有者、名称或命令，安装已停止。'
    }
    Assert-OwnedProtocol $existingOwner.Value $existingLabel.Value $existingCommand.Value $PowerShell $HelperDirectories
}

try {
    if ($args.Count -ne 0) { throw '安装程序不接受参数。' }
    if (![Environment]::Is64BitOperatingSystem) { throw '此版本需要 64 位 Windows 和已安装的 Origin。' }
    # UserProfile is outside MSIX's private AppData cache and survives removal
    # of Codex. Never install the launcher into redirected LOCALAPPDATA.
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    if ([string]::IsNullOrWhiteSpace($userProfile)) { throw '找不到当前用户目录。' }
    $destination = [IO.Path]::GetFullPath((Join-Path $userProfile 'ScientificPlotStudio\OriginHelper'))
    $launcher = Join-Path $destination 'Launch-LsvOrigin.exe'
    $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (![IO.File]::Exists($powerShell)) { throw '找不到系统 Windows PowerShell。' }
    $owner = 'ScientificPlotStudio/OriginHelper/v1'
    $label = 'URL:Scientific Plot Studio Origin Helper'
    $version = '2.6'
    $helperDirectories = @($destination, (Join-Path $env:LOCALAPPDATA 'ScientificPlotStudio\OriginHelper'),
        (Join-Path $userProfile 'AppData\Local\ScientificPlotStudio\OriginHelper')) | Select-Object -Unique
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $realRegistry = [wmiclass]'\\.\root\default:StdRegProv'
    $existing = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey('lsv-origin')
    if ($existing) {
        try {
            $existingCommand = $existing.OpenSubKey('shell\open\command')
            try { $registeredCommand = if ($existingCommand) { [string]$existingCommand.GetValue('') } else { '' } } finally { if ($existingCommand) { $existingCommand.Dispose() } }
            Assert-OwnedProtocol ([string]$existing.GetValue('ScientificPlotStudioOwner')) ([string]$existing.GetValue('')) $registeredCommand $powerShell $helperDirectories
        } finally { $existing.Dispose() }
    }
    Assert-RealOwnedProtocol $realRegistry $sid $powerShell $helperDirectories
    $files = @('Import-LsvOrigin.ps1','Start-LsvOrigin.ps1','OriginWindow.cs','Launch-LsvOrigin.cs','Install-OriginHelper.ps1','install.cmd','README.txt')
    foreach ($file in $files) { if (![IO.File]::Exists((Join-Path $PSScriptRoot $file))) { throw "安装包缺少 $file。请先解压整个安装包。" } }
    foreach ($file in $files | Where-Object { $_.EndsWith('.ps1') }) {
        $parseTokens = $null; $parseErrors = $null
        [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$parseTokens, [ref]$parseErrors)
        if ($parseErrors.Count -gt 0) { throw "安装包脚本 $file 存在语法错误，请重新下载。" }
    }
    [void][IO.Directory]::CreateDirectory($destination)
    foreach ($file in $files) {
        $source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $file))
        $target = Join-Path $destination $file
        if ($source -ine $target) { [IO.File]::Copy($source, $target, $true) }
    }
    # Compile the reviewed local launcher as a GUI executable. CreateNoWindow
    # prevents console delegation to Windows Terminal. Do not execute its Main.
    $temporaryLauncher = Join-Path $destination ('Launch-' + [Guid]::NewGuid().ToString('D') + '.exe')
    try {
        Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $destination 'Launch-LsvOrigin.cs'))) -Language CSharp -OutputAssembly $temporaryLauncher -OutputType WindowsApplication -ReferencedAssemblies 'System.Windows.Forms','System'
        [IO.File]::Copy($temporaryLauncher, $launcher, $true)
    } finally { if ([IO.File]::Exists($temporaryLauncher)) { [IO.File]::Delete($temporaryLauncher) } }
    $registeredCommand = '"' + $launcher + '" "%1"'
    # Preserve ordinary HKCU compatibility, and separately write/read the real
    # user hive through the out-of-process registry provider (MSIX-safe).
    $protocol = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\lsv-origin')
    try {
        $protocol.SetValue('', $label, [Microsoft.Win32.RegistryValueKind]::String)
        $protocol.SetValue('URL Protocol', '', [Microsoft.Win32.RegistryValueKind]::String)
        $protocol.SetValue('ScientificPlotStudioOwner', $owner, [Microsoft.Win32.RegistryValueKind]::String)
        $command = $protocol.CreateSubKey('shell\open\command')
        try { $command.SetValue('', $registeredCommand, [Microsoft.Win32.RegistryValueKind]::String) } finally { $command.Dispose() }
        $protocol.SetValue('ScientificPlotStudioVersion', $version, [Microsoft.Win32.RegistryValueKind]::String)
    } finally { $protocol.Dispose() }
    Write-OwnProtocolRegistry $realRegistry $sid 'CreateKey'
    Write-OwnProtocolRegistry $realRegistry $sid 'SetStringValue' '' '' $label
    Write-OwnProtocolRegistry $realRegistry $sid 'SetStringValue' '' 'URL Protocol' ''
    Write-OwnProtocolRegistry $realRegistry $sid 'SetStringValue' '' 'ScientificPlotStudioOwner' $owner
    Write-OwnProtocolRegistry $realRegistry $sid 'SetStringValue' '' 'ScientificPlotStudioVersion' $version
    Write-OwnProtocolRegistry $realRegistry $sid 'CreateKey' 'shell\open\command'
    Write-OwnProtocolRegistry $realRegistry $sid 'SetStringValue' 'shell\open\command' '' $registeredCommand
    $actualCommand = Read-OwnProtocolString $realRegistry $sid 'shell\open\command' ''
    $actualVersion = Read-OwnProtocolString $realRegistry $sid '' 'ScientificPlotStudioVersion'
    if (!$actualCommand.Exists -or $actualCommand.Value -cne $registeredCommand -or !$actualVersion.Exists -or $actualVersion.Value -cne $version) {
        throw '真实用户注册表的命令或版本读回不一致，安装未完成。'
    }
    # Windows requires this notification after changing a protocol association.
    # Refresh association caches without restarting browsers or launching Origin.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OriginHelperShellNotification {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
    [OriginHelperShellNotification]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Host '安装完成。请返回网页；本安装窗口不会打开 Origin。'
    Write-Host '首次使用：点击网页的“已安装 v2.6，导出并打开 Origin”，允许浏览器打开本机助手。'
    Write-Host '以后点击“导出至Origin”。没有打开程序的提示时，点击网页提示中的“打开 Origin”。'
    Write-Host '助手 v2.6 已核验真实用户启动关联并通知 Windows；导入会显示进度窗口。'
    Write-Host "位置: $destination"
    Write-Host '安装过程没有打开或修改 Origin。'
} catch {
    Write-Error ("安装失败: " + $_.Exception.Message)
    exit 1
}
