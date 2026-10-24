param([string]$RequestUri)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$OriginMissing = [double](-1.23456789e-300)
$origin = $null
$book = $null
$sheet = $null
$column = $null
$createdBookName = ''
$originProcessId = 0
$originWindowHandle = 0L
$originStartedAt = ''
$operationId = [Environment]::GetEnvironmentVariable('LSV_ORIGIN_OPERATION_ID')
$progressPath = ''
$logPath = ''
$stage = 'starting'

function Write-ProgressState([string]$Stage, [string]$Message, [bool]$Done = $false, [bool]$Failed = $false) {
    $script:stage = $Stage
    if (!$script:progressPath) { return }
    $now = [DateTimeOffset]::UtcNow.ToString('o')
    $state = [ordered]@{ operationId = $script:operationId; stage = $Stage; message = $Message; updatedAt = $now;
        bookName = $script:createdBookName; done = $Done; failed = $Failed;
        originProcessId = $script:originProcessId; originWindowHandle = $script:originWindowHandle; originStartedAt = $script:originStartedAt }
    # The progress file contains stage information only, never experimental rows.
    $temporary = $script:progressPath + '.tmp'
    [IO.File]::WriteAllText($temporary, ($state | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    # PowerShell 5.1 converts ordinary $null to an empty string for a .NET
    # string parameter. File.Replace needs a true null for no backup path.
    if ([IO.File]::Exists($script:progressPath)) { [IO.File]::Replace($temporary, $script:progressPath, [System.Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($temporary, $script:progressPath) }
    [IO.File]::AppendAllText($script:logPath, "$now [$Stage] $Message`r`n", (New-Object Text.UTF8Encoding($false)))
}

function Show-Result([string]$Message, [bool]$Failed = $false) {
    if ($script:progressPath) {
        $finalStage = if ($Failed) { 'failed' } else { 'complete' }
        Write-ProgressState $finalStage $Message $true $Failed
        return
    }
    Add-Type -AssemblyName System.Windows.Forms
    $icon = if ($Failed) { [Windows.Forms.MessageBoxIcon]::Error } else { [Windows.Forms.MessageBoxIcon]::Information }
    $owner = New-Object Windows.Forms.Form
    try {
        $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.StartPosition = 'CenterScreen'; $owner.Opacity = 0
        $owner.Show()
        [void][Windows.Forms.MessageBox]::Show($owner, $Message, 'Scientific Plot Studio - Origin', [Windows.Forms.MessageBoxButtons]::OK, $icon)
    } finally { $owner.Dispose() }
}

function Require-Object($Value, [string]$Label) {
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw "$Label 必须是 JSON 对象。" }
}

function Require-Fields($Value, [string[]]$Fields, [string]$Label) {
    Require-Object $Value $Label
    foreach ($field in $Fields) {
        if ($null -eq $Value.PSObject.Properties[$field]) { throw "$Label 缺少字段 $field。" }
    }
}

function Require-Text($Value, [string]$Label, [int]$Maximum, [bool]$AllowEmpty = $false) {
    if ($Value -isnot [string] -or $Value.Length -gt $Maximum -or (!$AllowEmpty -and [string]::IsNullOrWhiteSpace($Value)) -or $Value.Contains([char]0)) {
        throw "$Label 必须是长度不超过 $Maximum 的文本。"
    }
}

function Require-Number($Value, [string]$Label, [bool]$Nullable = $false) {
    if ($null -eq $Value) { if ($Nullable) { return }; throw "$Label 不能为空。" }
    if ($Value -isnot [byte] -and $Value -isnot [int16] -and $Value -isnot [int32] -and $Value -isnot [int64] -and
        $Value -isnot [uint16] -and $Value -isnot [uint32] -and $Value -isnot [uint64] -and $Value -isnot [single] -and
        $Value -isnot [double] -and $Value -isnot [decimal]) { throw "$Label 必须是 JSON 数字，不能用文本或布尔值替代。" }
    $number = [double]$Value
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -eq $OriginMissing) { throw "$Label 不是可导入的有限数值。" }
}

function Read-Payload([string]$FileName) {
    $stream = [IO.File]::Open($FileName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -lt 2 -or $stream.Length -gt 50MB) { throw '数据文件必须大于 1 字节且不能超过 50 MB。' }
        $reader = New-Object IO.StreamReader($stream, (New-Object Text.UTF8Encoding($false, $true)), $true)
        try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}

function Get-DownloadFolders {
    $downloadFolder = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
    try {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders')
        if ($key) {
            try { $configured = $key.GetValue('{374DE290-123F-4565-9164-39C4925E467B}', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Dispose() }
            if ($configured -is [string] -and $configured.Length -gt 0) { $downloadFolder = [Environment]::ExpandEnvironmentVariables($configured) }
        }
    } catch { }
    $downloadFolder = [IO.Path]::GetFullPath($downloadFolder)
    $folders = New-Object 'Collections.Generic.List[string]'
    $folders.Add($downloadFolder)
    # Browsers can use a custom folder rather than Windows' Downloads folder.
    # Read only the download.default_directory preference; never scan user data.
    foreach ($relative in @('Microsoft\Edge\User Data','Google\Chrome\User Data')) {
        $browserFolder = Join-Path $env:LOCALAPPDATA $relative
        if (![IO.Directory]::Exists($browserFolder)) { continue }
        $profiles = @((Join-Path $browserFolder 'Default')) + @([IO.Directory]::GetDirectories($browserFolder, 'Profile *') | Select-Object -First 10)
        foreach ($profile in $profiles) {
            try {
                $preferencePath = Join-Path $profile 'Preferences'
                if (![IO.File]::Exists($preferencePath) -or (Get-Item -LiteralPath $preferencePath).Length -gt 10MB) { continue }
                $preferences = [IO.File]::ReadAllText($preferencePath) | ConvertFrom-Json
                if ($null -eq $preferences.PSObject.Properties['download'] -or $null -eq $preferences.download.PSObject.Properties['default_directory']) { continue }
                $customFolder = $preferences.download.default_directory
                if ($customFolder -isnot [string] -or $customFolder.Length -gt 32767 -or $customFolder -notmatch '\A[a-zA-Z]:[\\/]') { continue }
                $customFolder = [IO.Path]::GetFullPath($customFolder)
                if (!$folders.Contains($customFolder)) { $folders.Add($customFolder) }
            } catch { continue }
        }
    }
    return $folders.ToArray()
}

function Find-DownloadedPayload([string]$Id, [string[]]$Folders) {
    # Prefer the dedicated handoff format; retain exact-ID legacy downloads.
    foreach ($extension in @('.lsvdata', '.json')) {
        foreach ($downloadFolder in $Folders) {
            $expected = Join-Path $downloadFolder ("lsv-origin-$Id$extension")
            if ([IO.File]::Exists($expected)) { return $expected }
        }
    }
    return $null
}

function Find-Payload([string]$Id) {
    $downloadFolders = @(Get-DownloadFolders)
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline) {
        $expected = Find-DownloadedPayload $Id $downloadFolders
        if ($expected) { return $expected }
        Start-Sleep -Milliseconds 250
    }
    Write-ProgressState 'selecting' '下载文件夹未找到本次数据。请在前台文件选择框中选择网页下载的交接文件。'
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object Windows.Forms.OpenFileDialog
    $owner = New-Object Windows.Forms.Form
    try {
        $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.StartPosition = 'CenterScreen'; $owner.Opacity = 0
        $owner.Show()
        $picker.Title = "选择网站刚下载的 lsv-origin-$Id.lsvdata（兼容旧 JSON）"
        $picker.Filter = '绘图 Origin 交接数据 (*.lsvdata;*.json)|*.lsvdata;*.json'
        $picker.CheckFileExists = $true
        $picker.Multiselect = $false
        $initialFolder = $downloadFolders | Where-Object { [IO.Directory]::Exists($_) } | Select-Object -Last 1
        if ($initialFolder) { $picker.InitialDirectory = $initialFolder }
        if ($picker.ShowDialog($owner) -ne [Windows.Forms.DialogResult]::OK) { throw '已取消导入，Origin 尚未打开。' }
        return $picker.FileName
    } finally { $picker.Dispose(); $owner.Dispose() }
}

function Validate-LsvPayload($Payload, [string]$Id) {
    Require-Fields $Payload @('schema','requestId','createdAt','formulas','scan','samples') '数据包'
    if ($Payload.schema -isnot [string] -or $Payload.schema -cne 'lsv-origin/v1' -or $Payload.requestId -isnot [string] -or $Payload.requestId -ine $Id) { throw '数据格式或 requestId 与本次网页请求不匹配。' }
    Require-Text $Payload.createdAt 'createdAt' 64
    $created = [DateTimeOffset]::MinValue
    if (![DateTimeOffset]::TryParse($Payload.createdAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$created)) { throw 'createdAt 不是有效时间。' }
    Require-Fields $Payload.formulas @('x','y') 'formulas'
    Require-Text $Payload.formulas.x 'X 公式' 2048
    Require-Text $Payload.formulas.y 'Y 公式' 2048
    Require-Text $Payload.scan 'scan' 16
    if ($Payload.scan -notin @('all','up','down')) { throw 'scan 不是支持的扫描模式。' }
    if ($Payload.samples -isnot [Array] -or $Payload.samples.Count -lt 1 -or $Payload.samples.Count -gt 10) { throw '每次必须导入 1 至 10 个样品。' }
    $total = 0
    foreach ($sample in $Payload.samples) {
        Require-Fields $sample @('name','source','unit','area','ir','compensation','visible','demo','rows','eta10MV','note') '样品'
        Require-Text $sample.name '样品名' 256
        Require-Text $sample.source '来源' 2048 $true
        Require-Text $sample.note '备注' 16384 $true
        Require-Text $sample.unit '原始电流单位' 16
        Require-Text $sample.compensation '补偿状态' 16
        if ($sample.unit -notin @('A','mA','uA','nA','A/cm2','mA/cm2','uA/cm2')) { throw '样品原始电流单位无效。' }
        if ($sample.compensation -notin @('raw','corrected','unknown')) { throw '补偿状态无效。' }
        if ($sample.visible -isnot [bool] -or $sample.demo -isnot [bool]) { throw 'visible 和 demo 必须为布尔值。' }
        Require-Number $sample.ir 'IR'
        Require-Number $sample.eta10MV 'eta10MV' $true
        if ($sample.area -is [string]) {
            Require-Text $sample.area '面积' 64 $true
            if (![string]::IsNullOrWhiteSpace($sample.area)) {
                $areaValue = [double]0
                if ($sample.area -notmatch '\A[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\z' -or
                    ![double]::TryParse($sample.area, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$areaValue) -or
                    [double]::IsInfinity($areaValue) -or $areaValue -le 0) { throw '面积必须为空或有效的正数文本。' }
            }
        } else { Require-Number $sample.area '面积'; if ([double]$sample.area -le 0) { throw '面积必须大于零。' } }
        if ($sample.rows -isnot [Array] -or $sample.rows.Count -lt 2) { throw '每个样品至少需要两行数据。' }
        $total += $sample.rows.Count
        if ($total -gt 500000) { throw '本次数据总行数超过 500,000。' }
        $rowNumber = 0
        foreach ($row in $sample.rows) {
            $rowNumber++
            if ($row -isnot [Array] -or $row.Count -ne 4) { throw "样品 '$($sample.name)' 第 $rowNumber 行必须恰好四列。" }
            Require-Number $row[0] "第 $rowNumber 行原始 E" $true
            Require-Number $row[1] "第 $rowNumber 行原始电流" $true
            Require-Number $row[2] "第 $rowNumber 行修正 X" $true
            Require-Number $row[3] "第 $rowNumber 行修正 Y" $true
        }
    }
}

# Four-column EIS transfers omit the legacy sample-marker column. Validation
# below still checks the exact keys, roles and units before this layout is used.
function Test-CompactEisPayload($Payload) {
    return $Payload.schema -ceq 'xy-origin/v1' -and $Payload.kind -ceq 'eis' -and $Payload.columns -is [Array] -and $Payload.columns.Count -eq 4
}

function Validate-XyPayload($Payload, [string]$Id) {
    Require-Fields $Payload @('schema','requestId','createdAt','kind','axes','settings','plot','columns','samples') '数据包'
    if ($Payload.schema -cne 'xy-origin/v1' -or $Payload.requestId -isnot [string] -or $Payload.requestId -ine $Id) { throw '数据格式或 requestId 与本次网页请求不匹配。' }
    if ($Payload.kind -notin @('xrd','eis')) { throw 'XY 数据类型无效。' }
    Require-Text $Payload.createdAt 'createdAt' 64
    $created = [DateTimeOffset]::MinValue
    if (![DateTimeOffset]::TryParse($Payload.createdAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$created)) { throw 'createdAt 不是有效时间。' }
    Require-Fields $Payload.axes @('x','y') '坐标标题'
    Require-Text $Payload.axes.x 'X 轴标题' 256
    Require-Text $Payload.axes.y 'Y 轴标题' 256
    Require-Fields $Payload.plot @('style','equalUnits') '图形设置'
    if ($Payload.plot.style -notin @('line','scatter') -or $Payload.plot.equalUnits -isnot [bool]) { throw '图形设置无效。' }
    Require-Object $Payload.settings '处理设置'
    $settingFields = @($Payload.settings.PSObject.Properties)
    if ($settingFields.Count -gt 32) { throw '处理设置最多允许 32 项。' }
    foreach ($field in $settingFields) {
        Require-Text $field.Name '设置名称' 64
        if ($field.Value -is [string]) { Require-Text $field.Value '设置值' 2048 $true }
        elseif ($field.Value -isnot [bool]) { Require-Number $field.Value '设置值' }
    }
    $compactEis = Test-CompactEisPayload $Payload
    $keys = if ($Payload.kind -eq 'xrd') { @('rawX','rawY','plotX','plotY') } elseif ($compactEis) { @('real','importedImaginary','plotX','plotY') } else { @('real','importedImaginary','imaginary','negativeImaginary','frequency','plotX','plotY') }
    $roles = if ($Payload.kind -eq 'xrd' -or $compactEis) { @('x','y','x','y') } else { @('x','y','y','y','data','x','y') }
    if ($Payload.columns -isnot [Array] -or $Payload.columns.Count -ne $keys.Count) { throw '列定义与数据类型不匹配。' }
    for ($c = 0; $c -lt $keys.Count; $c++) {
        $definition = $Payload.columns[$c]
        Require-Fields $definition @('key','label','unit','role') '列定义'
        Require-Text $definition.label '列标题' 256
        $unit = if ($Payload.kind -eq 'xrd') { if ($c -in @(0,2)) { 'deg' } else { 'a.u.' } } elseif ($c -eq 4) { 'Hz' } else { 'ohm' }
        if ($definition.key -cne $keys[$c] -or $definition.role -cne $roles[$c] -or $definition.unit -cne $unit) { throw '列名称、单位或 X/Y 定义与数据类型不匹配。' }
    }
    if ($Payload.columns[-2].label -cne $Payload.axes.x -or $Payload.columns[-1].label -cne $Payload.axes.y) { throw '绘图列标题与坐标标题不匹配。' }
    if ($Payload.samples -isnot [Array] -or $Payload.samples.Count -lt 1 -or $Payload.samples.Count -gt 10) { throw '每次必须导入 1 至 10 个样品。' }
    $total = 0
    foreach ($sample in $Payload.samples) {
        Require-Fields $sample @('name','source','visible','demo','imaginary','rows','note') '样品'
        Require-Text $sample.name '样品名' 256
        Require-Text $sample.source '来源' 2048 $true
        Require-Text $sample.note '备注' 16384 $true
        if ($sample.visible -isnot [bool] -or $sample.demo -isnot [bool]) { throw 'visible 和 demo 必须为布尔值。' }
        if (($Payload.kind -eq 'xrd' -and $null -ne $sample.imaginary) -or ($Payload.kind -eq 'eis' -and $sample.imaginary -notin @('raw','negative'))) { throw '导入虚部符号约定与数据类型不匹配。' }
        if ($sample.rows -isnot [Array] -or $sample.rows.Count -lt 2) { throw '每个样品至少需要两行数据。' }
        $total += $sample.rows.Count
        if ($total -gt 500000) { throw '本次数据总行数超过 500,000。' }
        foreach ($row in $sample.rows) {
            if ($row -isnot [Array] -or $row.Count -ne $keys.Count) { throw '数据行宽度与列定义不匹配。' }
            foreach ($value in $row) { Require-Number $value '数据值' $true }
            if (($null -eq $row[-2]) -ne ($null -eq $row[-1])) { throw '绘图缺口必须同时保留空的 X 和 Y。' }
            if ($Payload.kind -eq 'eis' -and !$compactEis) {
                $expectedImaginary = if ($null -eq $row[1]) { $null } elseif ($sample.imaginary -eq 'negative') { -[double]$row[1] } else { [double]$row[1] }
                $expectedNegative = if ($null -eq $expectedImaginary) { $null } else { -$expectedImaginary }
                if (($null -eq $expectedImaginary) -ne ($null -eq $row[2]) -or ($null -ne $expectedImaginary -and [double]$row[2] -ne $expectedImaginary) -or
                    ($null -eq $expectedNegative) -ne ($null -eq $row[3]) -or ($null -ne $expectedNegative -and [double]$row[3] -ne $expectedNegative)) { throw 'EIS 虚部列正负号不符合声明的导入约定。' }
            }
        }
    }
}

function Validate-Payload($Payload, [string]$Id) {
    Require-Fields $Payload @('schema') '数据包'
    if ($Payload.schema -ceq 'lsv-origin/v1') { Validate-LsvPayload $Payload $Id }
    elseif ($Payload.schema -ceq 'xy-origin/v1') { Validate-XyPayload $Payload $Id }
    else { throw '本助手不支持该数据格式。请更新连接程序或重新导出。' }
}

# A pure column plan is shared with validation tests; no data is executed as code.
function Get-OriginColumnPlan($Payload, $Sample) {
    if ($Payload.schema -ceq 'xy-origin/v1') {
        $names = @($Payload.columns | ForEach-Object label)
        $units = @($Payload.columns | ForEach-Object unit)
        # Origin COM designation: 0=Y, 1=Disregard, 3=X.
        $types = @($Payload.columns | ForEach-Object { if ($_.role -eq 'x') { 3 } elseif ($_.role -eq 'data') { 1 } else { 0 } })
        $settingsText = $Payload.settings | ConvertTo-Json -Compress
        $meta = @("样品: $($Sample.name)", "来源: $($Sample.source)", "网页可见: $($Sample.visible)", "模拟数据: $($Sample.demo)",
            "数据类型: $($Payload.kind)", "导入虚部约定: $($Sample.imaginary)", "处理设置: $settingsText", "网页样式: $($Payload.plot.style)",
            "网页 X/Y 等比例: $($Payload.plot.equalUnits)", "X轴: $($Payload.axes.x)", "Y轴: $($Payload.axes.y)",
            "请求ID: $($Payload.requestId)", "生成时间: $($Payload.createdAt)", '网页绘图X/Y原样写入；保留全部原始行及缺口。', $Sample.note) -join "`r`n"
        return [pscustomobject]@{ Names = $names; Units = $units; Types = $types; Comments = $meta }
    }
    $parsedArea = [double]0
    $hasArea = [double]::TryParse([string]$Sample.area, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsedArea)
    $fixedY = $Payload.formulas.y -match '\A(?:第二列|I)\s*\*\s*1000\z'
    $isDensity = $fixedY -and ($Sample.unit -eq 'A/cm2' -or ($Sample.unit -eq 'A' -and $hasArea -and $parsedArea -eq 1))
    $yUnit = if ($isDensity) { 'mA cm^-2' } elseif ($fixedY) { 'raw column 2 x 1000 (see note)' } else { 'formula output (see note)' }
    $fixedX = $Payload.formulas.x -match '\A第一列\s*-\s*iR\s*\*\s*B1\s*\+\s*0\.059\s*\*\s*13\.65\s*\+\s*0\.197\z'
    $xUnit = if ($fixedX) { 'V' } else { 'formula output (see note)' }
    $meta = @("样品: $($Sample.name)", "来源: $($Sample.source)", "原始单位: $($Sample.unit)",
        "面积(cm^2): $($Sample.area)", "IR: $($Sample.ir)", "补偿状态: $($Sample.compensation)",
        "网页可见: $($Sample.visible)", "模拟数据: $($Sample.demo)", "扫描显示模式: $($Payload.scan)",
        "X公式: $($Payload.formulas.x)", "Y公式: $($Payload.formulas.y)", "eta10(mV): $($Sample.eta10MV)",
        "请求ID: $($Payload.requestId)", "生成时间: $($Payload.createdAt)", '导入所有原始行；修正空值保留为缺失值。',
        '网页已计算的X/Y原样写入，不在Origin再次计算或换算单位。', $Sample.note) -join "`r`n"
    return [pscustomobject]@{ Names = @('原始 E','原始电流','网页修正 X','网页修正 Y'); Units = @('V', $Sample.unit, $xUnit, $yUnit); Types = @(3,0,3,0); Comments = $meta }
}

function Release-Com($Object) {
    if ($null -ne $Object -and [Runtime.InteropServices.Marshal]::IsComObject($Object)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Object)
    }
}

function Get-LegacyLauncherStartInfo([string]$Uri, [string]$Directory) {
    if ($Uri -notmatch '\Alsv-origin://import/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z') {
        throw '请求地址无效。仅接受 lsv-origin://import/UUID。'
    }
    $launcher = Join-Path $Directory 'Launch-LsvOrigin.exe'
    if (![IO.File]::Exists($launcher)) { throw '新版启动器缺失，请更新完整本机助手安装包。' }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $launcher
    $info.Arguments = '"' + $Uri + '"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    return $info
}

try {
    if ($args.Count -ne 0) { throw '只允许一个 RequestUri 参数，不支持额外参数。' }
    $match = [regex]::Match($RequestUri, '\Alsv-origin://import/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\z', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (!$match.Success) { throw '请求地址无效。仅接受 lsv-origin://import/UUID。' }
    $requestId = $match.Groups[1].Value.ToLowerInvariant()
    if (!$operationId) {
        # Some already-running Shell/browser processes retain the old protocol
        # command. That entry only hands off to the reviewed GUI launcher.
        # The monitor sets an operation UUID for its worker, preventing a loop.
        $legacyStart = Get-LegacyLauncherStartInfo $RequestUri $PSScriptRoot
        $legacyProcess = [Diagnostics.Process]::Start($legacyStart)
        if ($null -eq $legacyProcess) { throw '未能启动导入进度窗口。' }
        $legacyProcess.Dispose()
        return
    }
    if ($operationId) {
        if ($operationId -notmatch '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z') { throw '进度记录标识无效。' }
        $logFolder = Join-Path $PSScriptRoot 'Logs'
        [void][IO.Directory]::CreateDirectory($logFolder)
        $progressPath = Join-Path $logFolder ($operationId + '.status.json')
        $logPath = Join-Path $logFolder ($operationId + '.log')
        Write-ProgressState 'starting' '本机助手已启动。'
    }
    Write-ProgressState 'finding' ("正在查找本次交接文件 lsv-origin-$requestId.lsvdata（兼容旧 .json）。")
    $file = Find-Payload $requestId
    Write-ProgressState 'validating' '正在检查交接文件及样品数据。'
    $payload = Read-Payload $file
    Validate-Payload $payload $requestId
    $kindName = if ($payload.schema -ceq 'xy-origin/v1') { $payload.kind.ToUpperInvariant() } else { 'LSV' }
    $dataColumns = if ($payload.schema -ceq 'xy-origin/v1') { $payload.columns.Count } else { 4 }
    $markerColumns = if (Test-CompactEisPayload $payload) { 0 } else { 1 }
    $groupColumns = $dataColumns + $markerColumns

    # Application always creates a separate Origin instance. Never attach to
    # ApplicationSI or reset/load/save an existing project.
    Write-ProgressState 'opening' '正在打开一个新的 Origin 窗口。若首次启动，请完成 Origin 的许可或首次使用提示。'
    $existingOriginIds = @(Get-Process -Name Origin64,Origin -ErrorAction SilentlyContinue | ForEach-Object Id)
    $origin = New-Object -ComObject Origin.Application
    $origin.Visible = 1
    # Record only a new process. Concurrent/ambiguous launches disable window
    # activation rather than guessing which existing project belongs to us.
    $newOriginProcesses = @(Get-Process -Name Origin64,Origin -ErrorAction SilentlyContinue | Where-Object Id -notin $existingOriginIds)
    if ($newOriginProcesses.Count -eq 1) {
        $newOrigin = $newOriginProcesses[0]
        if ($newOrigin.MainWindowHandle -ne [IntPtr]::Zero) {
            $originProcessId = $newOrigin.Id
            $originWindowHandle = $newOrigin.MainWindowHandle.ToInt64()
            $originStartedAt = $newOrigin.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
        }
    }
    $requested = $kindName + [DateTime]::Now.ToString('HHmmss') + $requestId.Substring(0,4)
    $createdBookName = [string]$origin.CreatePage(2, $requested, 'origin', 2)
    if ([string]::IsNullOrWhiteSpace($createdBookName)) { throw 'Origin 未能创建新 Book。' }
    # PowerShell indexes this COM property by invoking it with the actual name.
    $book = $origin.WorksheetPages($createdBookName)
    if ($null -eq $book) { throw '无法访问刚创建的 Book。' }
    $book.LongName = 'Scientific Plot Studio ' + $kindName + ' - ' + $payload.createdAt
    # Compact EIS: four data columns per sample. Legacy layouts retain a marker.
    $sheet = $book.Layers.Item(0)
    if ($null -eq $sheet) { throw '无法访问新 Book 的第一个工作表。' }
    $sheet.Name = $kindName
    $sheet.LongName = $kindName + ' 样品数据'
    $sheet.Cols = $groupColumns * $payload.samples.Count
    $maxRows = 0
    foreach ($sample in $payload.samples) { $maxRows = [Math]::Max($maxRows, $sample.rows.Count) }
    $sheet.Rows = $maxRows
    $index = 0
    foreach ($sample in $payload.samples) {
        $index++
        Write-ProgressState 'writing' ("正在写入第 $index / $($payload.samples.Count) 个样品，共 $($sample.rows.Count) 行。")
        $separatorIndex = $groupColumns * ($index - 1)
        $dataStart = $separatorIndex + $markerColumns
        if ($markerColumns) {
            $column = $sheet.Columns.Item($separatorIndex)
            $column.DataFormat = 0
            $column.Type = 0
            $column.LongName = ''
            $column.Units = ''
            $column.Comments = "Sample$index" + [char]0x2192
            if ([string]$column.Comments -cne ("Sample$index" + [char]0x2192)) { throw "Sample$index 分组标记读回不一致。" }
            Release-Com $column
            $column = $null
        }
        $rowCount = $sample.rows.Count
        $matrix = [Array]::CreateInstance([double], [int[]]@($rowCount, $dataColumns))
        for ($r = 0; $r -lt $rowCount; $r++) {
            for ($c = 0; $c -lt $dataColumns; $c++) {
                $value = if ($null -eq $sample.rows[$r][$c]) { $OriginMissing } else { [double]$sample.rows[$r][$c] }
                $matrix.SetValue($value, $r, $c)
            }
        }
        $plan = Get-OriginColumnPlan $payload $sample
        $names = $plan.Names; $units = $plan.Units; $meta = $plan.Comments
        for ($c = 0; $c -lt $dataColumns; $c++) {
            $column = $sheet.Columns.Item($dataStart + $c)
            $column.DataFormat = 0 # Double; set before data because this clears a column.
            $column.Type = $plan.Types[$c]
            $column.LongName = $names[$c]
            $column.Units = $units[$c]
            $column.Comments = $meta
            if ([int]$column.Type -ne $plan.Types[$c] -or [string]$column.LongName -cne $names[$c] -or [string]$column.Units -cne $units[$c] -or [string]$column.Comments -cne $meta) {
                throw "Sample$index 第 $($c+1) 列的 X/Y 类型、标题、单位或备注读回不一致。"
            }
            Release-Com $column
            $column = $null
        }
        $target = '[' + $createdBookName + ']' + $sheet.Name
        if (!$origin.PutWorksheet($target, $matrix, 0, $dataStart)) { throw "Origin 拒绝写入 Sample$index。" }
        Write-ProgressState 'checking' ("正在校验第 $index / $($payload.samples.Count) 个样品。")
        # Numeric, zero-based readback also verifies every null gap and row order.
        for ($c = 0; $c -lt $dataColumns; $c++) {
            $column = $sheet.Columns.Item($dataStart + $c)
            if ([int]$column.Type -ne $plan.Types[$c] -or [string]$column.LongName -cne $names[$c] -or [string]$column.Units -cne $units[$c] -or [string]$column.Comments -cne $meta) {
                throw "Sample$index 第 $($c+1) 列写入后的 X/Y 类型、标题、单位或备注读回不一致。"
            }
            $received = $column.GetData(1, 0, ($rowCount - 1), 0)
            if ($received -isnot [Array] -or $received.Count -ne $rowCount) { throw "Sample$index 第 $($c+1) 列读回点数不一致。" }
            for ($r = 0; $r -lt $rowCount; $r++) {
                if ([double]$received.GetValue($r) -ne $matrix.GetValue($r,$c)) { throw "Sample$index 第 $($r+1) 行第 $($c+1) 列读回数值不一致。" }
            }
            Release-Com $column
            $column = $null
        }
    }
    [void]$book.Activate()
    $origin.Visible = 100 # MAINWND_SHOW_BRING_TO_FRONT, then release COM.
    $layoutDescription = if ($markerColumns) { "每组为空白标记列及 $dataColumns 列数据。" } else { '每组四列：原始 Z′、导入虚部列、绘图 X、绘图 Y；无空白标记列。' }
    Show-Result ("已在新的 Origin 窗口中创建 Book: $createdBookName`r`n$index 个 $kindName 样品已在同一工作表中横向排列，$layoutDescription`r`n全部数值已逐点校验，列名称、单位和备注已读回核对。`r`n请在 Origin 中自行保存项目。现有 Origin 项目未改动。")
} catch {
    if ($null -ne $origin) { try { $origin.Visible = 1 } catch { } }
    $detail = if ($createdBookName) { "`r`n新建 Book: $createdBookName。可能含部分数据，请检查后手动关闭或保存。" } else { '' }
    $failedStage = $stage
    $failure = "导入失败（阶段: $failedStage）: $($_.Exception.Message)$detail`r`n原有 Origin 项目未改动。"
    try { Show-Result $failure $true } catch { [Console]::Error.WriteLine($failure) }
    exit 1
} finally {
    Release-Com $column
    Release-Com $sheet
    Release-Com $book
    Release-Com $origin
    # Do not call Exit: a visible independent Origin remains available to edit.
}
