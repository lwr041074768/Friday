#requires -Version 5.1
param([string]$RequestUri)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# These validation/argument functions have no UI or process side effects. They
# can be extracted from the AST for checks without starting this helper.
function Get-ValidatedRequestUri([string]$Value) {
    $pattern = '\Alsv-origin://import/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\z'
    $match = [regex]::Match($Value, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (!$match.Success) { throw '请求地址无效。仅接受 lsv-origin://import/UUID。' }
    return 'lsv-origin://import/' + $match.Groups[1].Value.ToLowerInvariant()
}

function ConvertTo-NativeArgument([string]$Value) {
    if ($null -eq $Value -or $Value.Contains([char]0) -or $Value.Contains("`r") -or $Value.Contains("`n")) {
        throw '进程参数包含无效字符。'
    }
    # Windows CommandLineToArgvW quoting; a path can end with a backslash.
    $result = New-Object Text.StringBuilder
    [void]$result.Append('"')
    $slashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq [char]92) { $slashes++; continue }
        if ($character -eq [char]34) {
            [void]$result.Append([char]92, (2 * $slashes + 1))
            [void]$result.Append([char]34)
        } else {
            if ($slashes -gt 0) { [void]$result.Append([char]92, $slashes) }
            [void]$result.Append($character)
        }
        $slashes = 0
    }
    if ($slashes -gt 0) { [void]$result.Append([char]92, (2 * $slashes)) }
    [void]$result.Append('"')
    return $result.ToString()
}

function Get-OperationPaths([string]$HelperDirectory, [string]$OperationId) {
    if ([string]::IsNullOrWhiteSpace($HelperDirectory) -or $HelperDirectory -notmatch '\A(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+(?:\\|\z))' -or
        $OperationId -cnotmatch '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z') {
        throw '本机日志目录或操作标识无效。'
    }
    $folder = [IO.Path]::Combine([IO.Path]::GetFullPath($HelperDirectory), 'Logs')
    return [pscustomobject]@{
        Folder = $folder
        Status = [IO.Path]::Combine($folder, $OperationId + '.status.json')
        Log = [IO.Path]::Combine($folder, $OperationId + '.log')
        MonitorLog = [IO.Path]::Combine($folder, $OperationId + '.monitor.log')
    }
}

function ConvertFrom-ValidatedProgress([string]$Json, [string]$OperationId) {
    $value = $Json | ConvertFrom-Json
    if ($null -eq $value -or $value -isnot [pscustomobject]) { throw '进度必须为 JSON 对象。' }
    foreach ($name in @('operationId', 'stage', 'message', 'updatedAt', 'bookName', 'done', 'failed', 'originProcessId', 'originWindowHandle', 'originStartedAt')) {
        if ($null -eq $value.PSObject.Properties[$name]) { throw "进度缺少 $name。" }
    }
    if ($value.operationId -isnot [string] -or $value.operationId -cnotmatch '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z' -or
        $value.operationId -cne $OperationId) { throw '进度不属于本次操作。' }
    $stages = @('starting', 'finding', 'selecting', 'validating', 'opening', 'writing', 'checking', 'complete', 'failed')
    if ($value.stage -isnot [string] -or $value.stage -cnotin $stages) { throw '进度阶段无效。' }
    if ($value.done -isnot [bool] -or $value.failed -isnot [bool]) { throw 'done 和 failed 必须为 JSON 布尔值。' }
    foreach ($name in @('originProcessId', 'originWindowHandle')) {
        if (($value.$name -isnot [int] -and $value.$name -isnot [long]) -or $value.$name -lt 0) { throw "进度 $name 无效。" }
    }
    if ($value.originProcessId -gt [int]::MaxValue -or $value.originStartedAt -isnot [string] -or
        ($value.originStartedAt -cne '' -and $value.originStartedAt -cnotmatch '\A[1-9][0-9]{0,18}\z')) { throw 'Origin 窗口标识无效。' }
    $startedAt = 0L
    if ($value.originStartedAt -and ![long]::TryParse($value.originStartedAt, [ref]$startedAt)) { throw 'Origin 进程时间无效。' }
    foreach ($name in @('message', 'updatedAt', 'bookName')) {
        $text = $value.$name
        $maximum = if ($name -eq 'message') { 4096 } elseif ($name -eq 'bookName') { 256 } else { 64 }
        if ($text -isnot [string] -or $text.Length -gt $maximum -or $text.Contains([char]0)) { throw "进度 $name 无效。" }
    }
    if ([string]::IsNullOrWhiteSpace($value.message)) { throw '进度说明为空。' }
    $timestamp = [DateTimeOffset]::MinValue
    if (![DateTimeOffset]::TryParseExact($value.updatedAt, 'o', [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::None, [ref]$timestamp)) { throw '进度 updatedAt 无效。' }
    if ($value.stage -ceq 'complete') {
        if (!$value.done -or $value.failed -or [string]::IsNullOrWhiteSpace($value.bookName)) { throw '完成状态或新 Book 名无效。' }
    } elseif ($value.stage -ceq 'failed') {
        if (!$value.done -or !$value.failed) { throw '失败状态无效。' }
    } elseif ($value.done -or $value.failed) { throw '进行中的阶段不能标记为结束或失败。' }
    return [pscustomobject]@{
        operationId = $value.operationId; stage = $value.stage; message = $value.message
        updatedAt = $value.updatedAt; timestamp = $timestamp; bookName = $value.bookName
        done = $value.done; failed = $value.failed
        originProcessId = $value.originProcessId; originWindowHandle = $value.originWindowHandle; originStartedAt = $startedAt
    }
}

function Get-ProgressTimeoutSeconds([string]$Stage) {
    if ($Stage -ceq 'selecting') { return 0 }
    if ($Stage -ceq 'opening') { return 90 }
    return 120
}

function Read-OwnProgress([string]$Path, [string]$OperationId) {
    if (![IO.File]::Exists($Path)) { return $null }
    # The worker atomically replaces its status file. Sharing delete permits
    # replacement while this short-lived reader has the old file open.
    $sharing = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $stream = $null; $reader = $null
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, $sharing)
        if ($stream.Length -lt 2 -or $stream.Length -gt 128KB) { throw '本次进度文件大小无效。' }
        $reader = New-Object IO.StreamReader($stream, (New-Object Text.UTF8Encoding($false, $true)), $true)
        return ConvertFrom-ValidatedProgress $reader.ReadToEnd() $OperationId
    } catch [IO.IOException] {
        # A replacement/access race is retried; it never resets the timeout.
        return $null
    } finally {
        if ($null -ne $reader) { $reader.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Write-MonitorLog([string]$Message) {
    if ($null -eq $script:paths) { return }
    try {
        [void][IO.Directory]::CreateDirectory($script:paths.Folder)
        $line = [DateTimeOffset]::UtcNow.ToString('o') + ' [monitor] ' + $Message + "`r`n"
        # The worker owns .log; the UI owns .monitor.log. They never append
        # concurrently to the same file.
        [IO.File]::AppendAllText($script:paths.MonitorLog, $line, (New-Object Text.UTF8Encoding($false)))
    } catch { $script:logWriteError = $_.Exception.Message }
}

function Release-OwnMutex {
    if ($script:mutexOwned -and $null -ne $script:requestMutex) {
        try { $script:requestMutex.ReleaseMutex() }
        finally { $script:mutexOwned = $false }
    }
}

function Set-Result([string]$Message, [bool]$Failed) {
    $script:terminal = $true
    $script:startPending = $false
    $script:messageLabel.Text = $Message
    $script:stageLabel.Text = if ($Failed) { '未完成' } else { '导入完成' }
    $script:stageLabel.ForeColor = if ($Failed) { [Drawing.Color]::Firebrick } else { [Drawing.Color]::DarkGreen }
    $workerAlive = $script:workerStarted -and !$script:worker.HasExited
    $script:stopButton.Enabled = $workerAlive
    $script:closeButton.Enabled = !$workerAlive
    Write-MonitorLog $Message
    if (!$script:workerStarted -or $script:worker.HasExited) { Release-OwnMutex }
}

function Stop-OwnWorker([string]$Reason) {
    $script:stopped = $true
    $script:startPending = $false
    $killError = ''
    if ($script:workerStarted -and $null -ne $script:worker) {
        try { if (!$script:worker.HasExited) { $script:worker.Kill() } }
        catch { $killError = $_.Exception.Message }
    }
    $message = $Reason + "`r`n仅停止了本次助手的等待/写入。Origin 窗口会保留；可能已有部分新 Book，请在 Origin 中手动检查。日志也会保留。"
    if ($killError) { $message += "`r`n本次助手未能结束：$killError" }
    Set-Result $message $true
    $script:stageLabel.Text = '已停止等待'
}

function Start-OwnWorker {
    if ($args.Count -ne 0 -or $script:extraArgumentCount -ne 0) { throw '只允许一个 RequestUri 参数，不支持额外参数。' }
    if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or
        $PSVersionTable.PSVersion.Minor -lt 1 -or [Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
        throw '请使用 Windows PowerShell 5.1 的 -STA 模式启动本机助手。'
    }
    $uri = Get-ValidatedRequestUri $script:inputUri
    # Guard only this request's active import. A finished operation releases
    # the mutex, so later intentional imports are permitted.
    $requestId = $uri.Substring('lsv-origin://import/'.Length)
    $createdNew = $false
    $script:requestMutex = [Threading.Mutex]::new($false, ('Local\ScientificPlotStudio.Origin.' + $requestId), [ref]$createdNew)
    try { $script:mutexOwned = $script:requestMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $script:mutexOwned = $true }
    if (!$script:mutexOwned) {
        Set-Result '本次导入已在进行，请查看已有的进度窗口。没有启动另一个助手。' $true
        $script:stageLabel.Text = '已有本次导入'
        return
    }
    $workerFile = [IO.Path]::Combine($PSScriptRoot, 'Import-LsvOrigin.ps1')
    $windowsFolder = [Environment]::GetEnvironmentVariable('SystemRoot')
    if ([string]::IsNullOrWhiteSpace($windowsFolder) -or ![IO.Path]::IsPathRooted($windowsFolder)) { throw 'SystemRoot 无效。' }
    $powershellFile = [IO.Path]::Combine($windowsFolder, 'System32\WindowsPowerShell\v1.0\powershell.exe')
    if (![IO.File]::Exists($powershellFile) -or ![IO.File]::Exists($workerFile)) { throw '未找到 Windows PowerShell 或同目录 Import-LsvOrigin.ps1。请重新解压完整助手包。' }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $powershellFile
    $info.WorkingDirectory = $PSScriptRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['LSV_ORIGIN_OPERATION_ID'] = $script:operationId
    $literalArguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $workerFile, '-RequestUri', $uri)
    $info.Arguments = ($literalArguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $script:worker = New-Object Diagnostics.Process
    $script:worker.StartInfo = $info
    if (!$script:worker.Start()) { throw 'Windows 未能启动本次助手。' }
    $script:workerStarted = $true
    # .NET tasks drain both redirected pipes while the UI stays responsive.
    # No PowerShell callback runs on a background thread/runspace.
    $script:stdoutTask = $script:worker.StandardOutput.ReadToEndAsync()
    $script:stderrTask = $script:worker.StandardError.ReadToEndAsync()
    Write-MonitorLog ('已启动本次助手，进程 ID ' + $script:worker.Id + '。')
}

function Complete-ExitedWorker {
    if ($null -eq $script:stdoutTask -or $null -eq $script:stderrTask) {
        # A stream/task setup failure can occur after Start succeeded. The
        # captured worker is stopped by the startup error handler.
        $script:outputCollected = $true
        Release-OwnMutex
        return
    }
    if ($script:outputCollected -or !$script:stdoutTask.IsCompleted -or !$script:stderrTask.IsCompleted) { return }
    $script:outputCollected = $true
    # The captured worker has exited, so its file can now be read without
    # competing with its progress writer.
    try {
        if ([IO.File]::Exists($script:paths.Log)) {
            $workerLog = [IO.File]::ReadAllText($script:paths.Log)
            if ($workerLog.Length -gt 120000) { $workerLog = $workerLog.Substring(0, 120000) + "`r`n[子助手日志已截断；完整日志保留在相邻 .log 文件]" }
            if ($workerLog) { Write-MonitorLog ("子助手日志：`r`n" + $workerLog.Trim()) }
        }
    } catch { Write-MonitorLog ('无法读取相邻子助手日志：' + $_.Exception.Message) }
    $output = ''; $errorOutput = ''
    try { $output = $script:stdoutTask.GetAwaiter().GetResult() } catch { $output = $_.Exception.Message }
    try { $errorOutput = $script:stderrTask.GetAwaiter().GetResult() } catch { $errorOutput = $_.Exception.Message }
    foreach ($diagnostic in @($output, $errorOutput)) {
        if (![string]::IsNullOrWhiteSpace($diagnostic)) {
            $limited = if ($diagnostic.Length -gt 12000) { $diagnostic.Substring(0, 12000) + "`r`n[输出已截断]" } else { $diagnostic }
            Write-MonitorLog $limited.Trim()
        }
    }
    if ($script:terminal) { Release-OwnMutex; return }
    $exitCode = $script:worker.ExitCode
    if ($null -ne $script:lastState -and $script:lastState.done -and !$script:lastState.failed -and $exitCode -eq 0) {
        Set-Result ("已导入新的 Book：" + $script:lastState.bookName + "`r`n" + $script:lastState.message + "`r`n请在 Origin 中查看数据。") $false
    } else {
        $details = if ($null -ne $script:lastState -and $script:lastState.failed) { $script:lastState.message }
                   elseif (![string]::IsNullOrWhiteSpace($errorOutput)) { $errorOutput.Trim() }
                   else { "本次助手退出（代码 $exitCode），但未返回可验证的完成状态。" }
        if ($details.Length -gt 1400) { $details = $details.Substring(0, 1400) + '…' }
        Set-Result ($details + "`r`n日志已保留。请查看上述错误后再重试。") $true
    }
}

function Show-OwnLog {
    try {
        if ($null -eq $script:paths) { throw '本次日志目录尚不可用。' }
        [void][IO.Directory]::CreateDirectory($script:paths.Folder)
        $target = if ([IO.File]::Exists($script:paths.MonitorLog)) { $script:paths.MonitorLog }
                  elseif ([IO.File]::Exists($script:paths.Log)) { $script:paths.Log }
                  else { $script:paths.Folder }
        $windowsFolder = [Environment]::GetEnvironmentVariable('SystemRoot')
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = [IO.Path]::Combine($windowsFolder, 'explorer.exe')
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        # This button deliberately opens an interactive Explorer window.
        $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Normal
        $literalArguments = if ([IO.File]::Exists($target)) { '/select,' + (ConvertTo-NativeArgument $target) } else { ConvertTo-NativeArgument $target }
        $info.Arguments = $literalArguments
        $explorer = [Diagnostics.Process]::Start($info)
        if ($null -ne $explorer) { $explorer.Dispose() }
    } catch {
        [void][Windows.Forms.MessageBox]::Show($script:form, ('无法显示本次日志：' + $_.Exception.Message), 'Origin 本机助手', 'OK', 'Error')
    }
}

function Show-ImportedOrigin {
    if ($null -eq $script:lastState -or $script:lastState.originProcessId -eq 0) { return }
    [void][OriginHelperWindow]::ShowImportedOrigin($script:lastState.originWindowHandle,
        $script:lastState.originProcessId, $script:lastState.originStartedAt)
}

$script:inputUri = $RequestUri
$script:extraArgumentCount = $args.Count
$script:operationId = [Guid]::NewGuid().ToString('D')
$script:paths = $null
$script:logWriteError = ''
$script:worker = $null
$script:requestMutex = $null; $script:mutexOwned = $false
$script:workerStarted = $false
$script:stdoutTask = $null; $script:stderrTask = $null
$script:outputCollected = $false
$script:lastState = $null
$script:lastUpdatedAt = ''
$script:lastProgressMilliseconds = 0L
$script:terminal = $false; $script:stopped = $false; $script:startPending = $false
$script:closeRequested = $false
$script:clock = New-Object Diagnostics.Stopwatch

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'OriginWindow.cs'))) -Language CSharp
[Windows.Forms.Application]::EnableVisualStyles()
$script:form = New-Object Windows.Forms.Form
$script:form.Text = 'Scientific Plot Studio · Origin 本机助手'
$script:form.ClientSize = New-Object Drawing.Size(570, 285)
$script:form.StartPosition = 'CenterScreen'
$script:form.FormBorderStyle = 'FixedDialog'
$script:form.MaximizeBox = $false
$script:form.TopMost = $true
$script:form.Font = New-Object Drawing.Font('Microsoft YaHei UI', 9)

$script:stageLabel = New-Object Windows.Forms.Label
$script:stageLabel.Location = New-Object Drawing.Point(20, 18)
$script:stageLabel.Size = New-Object Drawing.Size(385, 30)
$script:stageLabel.Font = New-Object Drawing.Font('Microsoft YaHei UI', 12, [Drawing.FontStyle]::Bold)
$script:stageLabel.Text = '正在启动本机助手'
$script:form.Controls.Add($script:stageLabel)
$topMostBox = New-Object Windows.Forms.CheckBox
$topMostBox.Location = New-Object Drawing.Point(445, 22)
$topMostBox.Size = New-Object Drawing.Size(105, 25)
$topMostBox.Text = '窗口置顶'; $topMostBox.Checked = $true
$topMostBox.Add_CheckedChanged({ param($sender, $eventArgs) $script:form.TopMost = $sender.Checked })
$script:form.Controls.Add($topMostBox)

$script:messageLabel = New-Object Windows.Forms.TextBox
$script:messageLabel.Location = New-Object Drawing.Point(20, 59)
$script:messageLabel.Size = New-Object Drawing.Size(530, 138)
$script:messageLabel.Multiline = $true
$script:messageLabel.ReadOnly = $true
$script:messageLabel.ScrollBars = [Windows.Forms.ScrollBars]::Vertical
$script:messageLabel.BackColor = [Drawing.SystemColors]::Window
$script:messageLabel.Text = '即将查找本次交接文件。每一步的进度都会在此显示。'
$script:form.Controls.Add($script:messageLabel)
$script:elapsedLabel = New-Object Windows.Forms.Label
$script:elapsedLabel.Location = New-Object Drawing.Point(20, 203)
$script:elapsedLabel.Size = New-Object Drawing.Size(530, 22)
$script:elapsedLabel.Text = '已等待 00:00:00'
$script:form.Controls.Add($script:elapsedLabel)

$logButton = New-Object Windows.Forms.Button
$logButton.Text = '查看本次日志'
$logButton.Location = New-Object Drawing.Point(20, 239)
$logButton.Size = New-Object Drawing.Size(125, 30)
$logButton.Add_Click({ Show-OwnLog })
$script:form.Controls.Add($logButton)
$script:stopButton = New-Object Windows.Forms.Button
$script:stopButton.Text = '停止等待'
$script:stopButton.Location = New-Object Drawing.Point(330, 239)
$script:stopButton.Size = New-Object Drawing.Size(105, 30)
$script:stopButton.Add_Click({ Stop-OwnWorker '用户已停止本次等待。' })
$script:form.Controls.Add($script:stopButton)
$script:closeButton = New-Object Windows.Forms.Button
$script:closeButton.Text = '关闭'
$script:closeButton.Location = New-Object Drawing.Point(445, 239)
$script:closeButton.Size = New-Object Drawing.Size(105, 30)
$script:closeButton.Enabled = $true
$script:closeButton.Add_Click({ $script:form.Close() })
$script:form.Controls.Add($script:closeButton)

$script:timer = New-Object Windows.Forms.Timer
$script:timer.Interval = 300
$script:timer.Add_Tick({
    try {
        $script:elapsedLabel.Text = '已等待 ' + $script:clock.Elapsed.ToString('hh\:mm\:ss')
        if ($script:startPending -and !$script:terminal) {
            $script:startPending = $false
            try { Start-OwnWorker }
            catch {
                $failure = '启动失败：' + $_.Exception.Message
                if ($script:workerStarted) { Stop-OwnWorker $failure }
                else { Set-Result ($failure + "`r`n请查看本次日志。") $true }
            }
        }
        if (!$script:terminal -and $null -ne $script:paths) {
            $state = Read-OwnProgress $script:paths.Status $script:operationId
            $changed = $null -ne $state -and ($null -eq $script:lastState -or
                $state.updatedAt -cne $script:lastUpdatedAt -or $state.stage -cne $script:lastState.stage -or
                $state.message -cne $script:lastState.message -or $state.bookName -cne $script:lastState.bookName)
            if ($changed -and ($null -eq $script:lastState -or $state.timestamp -ge $script:lastState.timestamp)) {
                # Two quick stages may share a Windows clock tick. Display
                # both, but only a different updatedAt resets our own clock.
                if ($state.updatedAt -cne $script:lastUpdatedAt) {
                    $script:lastUpdatedAt = $state.updatedAt
                    $script:lastProgressMilliseconds = $script:clock.ElapsedMilliseconds
                }
                $script:lastState = $state
                $stageNames = @{ starting='正在启动'; finding='正在查找文件'; selecting='等待选择文件'; validating='正在检查数据';
                    opening='正在打开 Origin'; writing='正在写入新 Book'; checking='正在核对导入结果'; complete='正在结束助手'; failed='正在结束助手' }
                $script:stageLabel.Text = $stageNames[$state.stage]
                $script:messageLabel.Text = $state.message
                Write-MonitorLog ('[' + $state.stage + '] ' + $state.message)
                if ($state.stage -ceq 'selecting') { $script:messageLabel.Text += "`r`n请选择网页刚下载的交接文件（.lsvdata 或旧 .json）；此阶段不会超时。" }
                if ($state.stage -ceq 'opening') { $script:messageLabel.Text += "`r`n若许可或首次使用提示被遮挡，可取消'窗口置顶'。" }
            }
        }
        if ($script:workerStarted -and $script:worker.HasExited) {
            Complete-ExitedWorker
            if ($script:terminal) { $script:closeButton.Enabled = $true; $script:stopButton.Enabled = $false }
        }
        if (!$script:terminal) {
            $stage = if ($null -eq $script:lastState) { 'starting' } else { $script:lastState.stage }
            $timeout = Get-ProgressTimeoutSeconds $stage
            if ($timeout -gt 0 -and ($script:clock.ElapsedMilliseconds - $script:lastProgressMilliseconds) -ge ($timeout * 1000)) {
                Stop-OwnWorker ("本次助手在 [$stage] 阶段已 $timeout 秒没有新进度，已停止等待。")
            }
        }
        if ($script:terminal -and (!$script:workerStarted -or ($script:worker.HasExited -and $script:outputCollected))) {
            $script:timer.Stop()
            if ($script:closeRequested) { $script:form.Close() }
        }
    } catch {
        Stop-OwnWorker ('监视进度失败：' + $_.Exception.Message)
    }
})
$script:form.Add_Shown({
    $script:clock.Start()
    try {
        $script:paths = Get-OperationPaths $PSScriptRoot $script:operationId
        [void][IO.Directory]::CreateDirectory($script:paths.Folder)
        Write-MonitorLog ('监视窗口已显示。本次操作：' + $script:operationId + '；相邻子助手日志：' + $script:paths.Log)
        $script:startPending = $true
    } catch { Set-Result ('无法准备本机助手：' + $_.Exception.Message) $true }
    $script:form.Refresh()
    $script:timer.Start()
})
$script:form.Add_FormClosing({
    param($sender, $eventArgs)
    Show-ImportedOrigin
    if ($script:workerStarted -and (!$script:worker.HasExited -or !$script:outputCollected)) {
        $eventArgs.Cancel = $true
        $script:closeRequested = $true
        Write-MonitorLog '用户关闭进度窗口；本次导入在后台继续，不终止 Origin 或工作进程。'
        $script:form.Hide()
        return
    }
    $script:startPending = $false
})
$script:form.Add_Resize({
    if ($script:form.WindowState -eq [Windows.Forms.FormWindowState]::Minimized) { Show-ImportedOrigin }
})
try { [Windows.Forms.Application]::Run($script:form) }
finally {
    $script:timer.Stop(); $script:timer.Dispose()
    if ($script:workerStarted -and !$script:terminal) { Stop-OwnWorker '监视窗口已结束。' }
    if ($null -ne $script:worker) { $script:worker.Dispose() }
    Release-OwnMutex
    if ($null -ne $script:requestMutex) { $script:requestMutex.Dispose() }
    $script:clock.Stop()
    $script:form.Dispose()
}
