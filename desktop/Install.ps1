param([switch]$NoShortcut)
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'VERSION.json') -Raw | ConvertFrom-Json
if ($manifest.appVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version manifest.' }
$installBase = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'ScientificPlotStudio\Desktop'
$installTarget = Join-Path $installBase $manifest.appVersion
$resolvedTarget = [IO.Path]::GetFullPath($installTarget)
$resolvedBase = [IO.Path]::GetFullPath($installBase).TrimEnd('\') + '\'
if (-not $resolvedTarget.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation path.' }
if ([IO.Path]::GetFullPath($packageRoot).TrimEnd('\') -ne $resolvedTarget.TrimEnd('\')) {
    if (Test-Path -LiteralPath $installTarget) {
        $previousManifest = Join-Path $installTarget 'VERSION.json'
        if (@(Get-ChildItem -LiteralPath $installTarget -Force).Count -gt 0) {
            if (-not (Test-Path -LiteralPath $previousManifest)) { throw '目标目录已有其他文件，请先检查该目录。' }
            $previous = Get-Content -LiteralPath $previousManifest -Raw | ConvertFrom-Json
            if ($previous.product -ne 'Scientific Plot Studio' -or $previous.appVersion -ne $manifest.appVersion) {
                throw '目标目录的版本身份不匹配，请先检查该目录。'
            }
        }
        $existingNode = Join-Path $installTarget 'runtime\node.exe'
        if (Test-Path -LiteralPath $existingNode) {
            try { $probe = [IO.File]::Open($existingNode, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); $probe.Dispose() }
            catch { throw '该版本正在使用或文件被占用。请先运行安装目录中的“停止.cmd”，再重新安装。' }
        }
    }
    New-Item -ItemType Directory -Path $installTarget -Force | Out-Null
    foreach ($entry in Get-ChildItem -LiteralPath $packageRoot -Force) {
        if ($entry.Name -eq '.runtime') { continue }
        Copy-Item -LiteralPath $entry.FullName -Destination $installTarget -Recurse -Force
    }
}
if (-not $NoShortcut) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) ('科研绘图软件 v' + $manifest.appVersion + '.lnk')
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $installTarget 'ScientificPlotStudio.exe'
    $shortcut.WorkingDirectory = $installTarget
    $shortcut.Description = 'Scientific Plot Studio v' + $manifest.appVersion
    $shortcut.Save()
}
Write-Host ('安装完成：' + $installTarget)
Write-Host '通过桌面快捷方式或 ScientificPlotStudio.exe 启动。'
Write-Host 'Origin 助手请从网页“导出至Origin”下载并单独安装。'
