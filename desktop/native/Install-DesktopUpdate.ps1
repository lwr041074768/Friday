param([Parameter(Mandatory = $true)][string]$PlanPath)

# This trusted helper is copied out of the installation before it is launched.
# It never executes a script supplied by the downloaded archive or deletes a folder.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$script:StatusPath = $null
$script:OperationId = $null
$script:TargetVersion = $null
$script:BackupPath = $null
$script:Prepared = $false
$script:InstallMoved = $false
$script:ReplacementMoved = $false
$script:InstallPath = $null
$script:StagingPath = $null
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-LocalAbsolutePath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^[A-Za-z]:[\\/]' -or $Value -match '[\x00-\x1f]' -or $Value.Substring(2).Contains(':')) { throw 'An update path is not an absolute local path.' }
  $full = [IO.Path]::GetFullPath($Value).TrimEnd('\')
  if ($full.Length -le 3) { throw 'A drive root cannot be an update target.' }
  return $full
}

function Assert-NoReparse([string]$Value) {
  $current = $Value
  while (-not [string]::IsNullOrEmpty($current)) {
    if ([IO.Directory]::Exists($current) -or [IO.File]::Exists($current)) {
      if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Update paths cannot contain links or junctions.' }
    }
    $next = [IO.Path]::GetDirectoryName($current)
    if ($next -eq $current) { break }
    $current = $next
  }
}

function Test-UnderPath([string]$Child, [string]$Parent) {
  return $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($Parent + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Write-UpdateStatus([string]$Phase, [string]$Message) {
  if (-not $script:StatusPath) { return }
  Assert-NoReparse $script:StatusPath
  $packet = [ordered]@{ schema = 'scientific-plot-update-status/v1'; operationId = $script:OperationId; version = $script:TargetVersion; phase = $Phase; message = $Message; backupDirectory = $script:BackupPath; updatedAt = [DateTime]::UtcNow.ToString('o') }
  $temp = $script:StatusPath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  $stream = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $data = $utf8.GetBytes(($packet | ConvertTo-Json -Depth 4 -Compress))
    $stream.Write($data, 0, $data.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  if ([IO.File]::Exists($script:StatusPath)) { [IO.File]::Replace($temp, $script:StatusPath, [System.Management.Automation.Language.NullString]::Value) }
  else { [IO.File]::Move($temp, $script:StatusPath) }
}

function Read-ProductVersion([string]$Directory, [string]$ExpectedVersion) {
  $versionPath = [IO.Path]::Combine($Directory, 'VERSION.json')
  $exePath = [IO.Path]::Combine($Directory, 'ScientificPlotStudio.exe')
  foreach ($required in @($versionPath, $exePath)) {
    Assert-NoReparse $required
    if (-not [IO.File]::Exists($required)) { throw 'The update does not contain a complete Scientific Plot Studio installation.' }
  }
  if (([IO.FileInfo]$versionPath).Length -gt 65536) { throw 'Invalid VERSION.json size.' }
  $version = [IO.File]::ReadAllText($versionPath, $utf8) | ConvertFrom-Json
  if ($version.product -cne 'Scientific Plot Studio' -or $version.platform -cne 'win32-x64' -or $version.desktopVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'The update product or platform does not match this application.' }
  if ($ExpectedVersion -and $version.desktopVersion -cne $ExpectedVersion) { throw 'The archive version does not match the selected release.' }
  if ($ExpectedVersion) {
    $asar = [IO.Path]::Combine($Directory, 'resources', 'app.asar')
    Assert-NoReparse $asar
    if (-not [IO.File]::Exists($asar) -or ([IO.FileInfo]$asar).Length -eq 0 -or ([IO.FileInfo]$exePath).Length -eq 0) { throw 'The update application files are incomplete.' }
  }
}

function Assert-SafeSiblingPaths {
  foreach ($item in @($script:InstallPath, $script:StagingPath, $script:BackupPath)) { Assert-NoReparse $item }
  $parent = [IO.Path]::GetDirectoryName($script:InstallPath)
  if (-not [IO.Directory]::Exists($parent)) { throw 'The installation parent folder does not exist.' }
  if (-not ([IO.Path]::GetDirectoryName($script:StagingPath)).Equals($parent, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetDirectoryName($script:BackupPath)).Equals($parent, [StringComparison]::OrdinalIgnoreCase)) { throw 'The update folders must be siblings of the installation.' }
  if ([IO.Path]::GetFileName($script:StagingPath) -cne ('.ScientificPlotStudio-update-' + $script:OperationId) -or [IO.Path]::GetFileName($script:BackupPath) -cne ([IO.Path]::GetFileName($script:InstallPath) + '.backup-' + $script:OperationId)) { throw 'The update folder names do not match the operation.' }
}

function Expand-CheckedArchive([string]$ArchivePath, [string]$ExpectedHash) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScientificPlotUpdateNative {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CreateDirectory(string path, IntPtr securityAttributes);
}
'@
  $source = [IO.File]::Open($ArchivePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $archive = $null
  try {
    if ($source.Length -gt 2147483648) { throw 'The update archive exceeds the size limit.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($sha.ComputeHash($source))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($actual -cne $ExpectedHash.ToLowerInvariant()) { throw 'The downloaded update checksum does not match.' }
    $source.Position = 0
    $archive = New-Object IO.Compression.ZipArchive($source, [IO.Compression.ZipArchiveMode]::Read, $true)
    $entries = New-Object 'System.Collections.Generic.List[object]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $kinds = New-Object 'System.Collections.Generic.Dictionary[string,bool]' ([StringComparer]::OrdinalIgnoreCase)
    $rootName = $null
    [long]$total = 0
    [int]$fileCount = 0
    if ($archive.Entries.Count -eq 0 -or $archive.Entries.Count -gt 20000) { throw 'The update archive has an invalid entry count.' }
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName
      if ([string]::IsNullOrEmpty($name) -or $name.Length -gt 1024 -or $name -match '[\\:\x00-\x1f<>"|?*]' -or $name.StartsWith('/')) { throw 'The update archive contains an unsafe path.' }
      $isDirectory = $name.EndsWith('/')
      $parts = $name.TrimEnd('/').Split('/')
      foreach ($part in $parts) {
        if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part.Length -gt 255 -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)') { throw 'The update archive contains an unsafe Windows filename.' }
      }
      if ($name.EndsWith('//')) { throw 'The update archive contains an unsafe path.' }
      if (-not $rootName) { $rootName = $parts[0] }
      if ($parts[0] -cne $rootName -or ($parts.Count -eq 1 -and -not $isDirectory)) { throw 'The update archive must contain one top-level application folder.' }
      $unixType = ($entry.ExternalAttributes -shr 16) -band 61440
      if (($entry.ExternalAttributes -band 1024) -ne 0 -or ($unixType -ne 0 -and $unixType -ne 32768 -and $unixType -ne 16384) -or ($unixType -eq 16384 -and -not $isDirectory) -or ($unixType -eq 32768 -and $isDirectory)) { throw 'The update archive cannot contain links or special files.' }
      $key = $name.TrimEnd('/')
      if (-not $seen.Add($key)) { throw 'The update archive contains duplicate filenames.' }
      for ($index = 1; $index -lt $parts.Count; $index++) {
        $ancestor = [string]::Join('/', $parts[0..($index - 1)])
        if ($kinds.ContainsKey($ancestor) -and -not $kinds[$ancestor]) { throw 'The update archive has a file and directory conflict.' }
        $kinds[$ancestor] = $true
      }
      if ($kinds.ContainsKey($key) -and $kinds[$key] -ne $isDirectory) { throw 'The update archive has a file and directory conflict.' }
      $kinds[$key] = $isDirectory
      if ($isDirectory) { if ($entry.Length -ne 0) { throw 'Invalid archive directory.' } }
      else {
        $fileCount++
        if ($fileCount -gt 10000 -or $entry.Length -lt 0 -or $entry.Length -gt (2147483648 - $total)) { throw 'The extracted update exceeds the size or file limit.' }
        $total += $entry.Length
      }
      if ($parts.Count -gt 1) {
        $relative = [string]::Join('\', $parts[1..($parts.Count - 1)])
        $destination = [IO.Path]::GetFullPath([IO.Path]::Combine($script:StagingPath, $relative))
        if (-not (Test-UnderPath $destination $script:StagingPath)) { throw 'An archive path escapes the staging folder.' }
        $entries.Add([pscustomobject]@{ Entry = $entry; Destination = $destination; IsDirectory = $isDirectory })
      }
    }
    Assert-SafeSiblingPaths
    if (-not [ScientificPlotUpdateNative]::CreateDirectory($script:StagingPath, [IntPtr]::Zero)) { throw 'The unique update staging directory already exists or cannot be created.' }
    foreach ($item in $entries) {
      Assert-NoReparse $item.Destination
      if ($item.IsDirectory) { [void][IO.Directory]::CreateDirectory($item.Destination); continue }
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($item.Destination))
      Assert-NoReparse $item.Destination
      $inputStream = $item.Entry.Open()
      $outputStream = $null
      try {
        $outputStream = [IO.File]::Open($item.Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $buffer = New-Object byte[] 65536
        [long]$written = 0
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $written += $count
          if ($written -gt $item.Entry.Length) { throw 'The extracted update length does not match its archive entry.' }
          $outputStream.Write($buffer, 0, $count)
        }
        if ($written -ne $item.Entry.Length) { throw 'The extracted update is truncated.' }
      } finally {
        if ($outputStream) { $outputStream.Dispose() }
        $inputStream.Dispose()
      }
    }
  } finally {
    if ($archive) { $archive.Dispose() }
    $source.Dispose()
  }
}

try {
  $planFile = Get-LocalAbsolutePath $PlanPath
  Assert-NoReparse $planFile
  if (([IO.FileInfo]$planFile).Length -gt 65536) { throw 'Invalid update plan size.' }
  $plan = [IO.File]::ReadAllText($planFile, $utf8) | ConvertFrom-Json
  if ($plan.schema -cne 'scientific-plot-update-plan/v1' -or $plan.operationId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'The update plan is invalid.' }
  $script:OperationId = [string]$plan.operationId
  $script:TargetVersion = [string]$plan.version
  if ($script:TargetVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or $plan.archiveSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'The update version or checksum is invalid.' }
  $script:InstallPath = Get-LocalAbsolutePath $plan.installDirectory
  $script:StagingPath = Get-LocalAbsolutePath $plan.stagingDirectory
  $script:BackupPath = Get-LocalAbsolutePath $plan.backupDirectory
  $archivePath = Get-LocalAbsolutePath $plan.archivePath
  $statusPath = Get-LocalAbsolutePath $plan.statusPath
  Assert-SafeSiblingPaths
  foreach ($value in @($archivePath, $statusPath, $planFile)) { Assert-NoReparse $value }
  foreach ($protected in @($script:InstallPath, $script:StagingPath, $script:BackupPath)) {
    if ((Test-UnderPath $statusPath $protected) -or (Test-UnderPath $archivePath $protected) -or (Test-UnderPath $planFile $protected) -or (Test-UnderPath $PSCommandPath $protected)) { throw 'Update control files must be outside the application and swap folders.' }
  }
  if (-not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($statusPath)) -or [IO.Directory]::Exists($statusPath)) { throw 'The update status cache is unavailable.' }
  $script:StatusPath = $statusPath
  if (-not [IO.Directory]::Exists($script:InstallPath) -or [IO.Directory]::Exists($script:StagingPath) -or [IO.File]::Exists($script:StagingPath) -or [IO.Directory]::Exists($script:BackupPath) -or [IO.File]::Exists($script:BackupPath)) { throw 'The installation or unique update folders are not available.' }
  $parentId = [int]$plan.parentPid
  if ($parentId -le 0 -or $parentId -eq $PID -or [double]$plan.parentPid -ne $parentId) { throw 'The parent application process is invalid.' }
  $parentProcess = Get-Process -Id $parentId -ErrorAction SilentlyContinue
  Read-ProductVersion $script:InstallPath ''
  Expand-CheckedArchive $archivePath $plan.archiveSha256
  Read-ProductVersion $script:StagingPath $script:TargetVersion
  $script:Prepared = $true
  Write-UpdateStatus 'prepared' 'The update is verified and ready. Waiting for the application to close.'
  if ($parentProcess -and -not $parentProcess.WaitForExit(120000)) { throw 'The application did not close within 120 seconds. The current installation was preserved.' }
  # Recheck immediately before each move; do not follow substituted junctions.
  Assert-SafeSiblingPaths
  Read-ProductVersion $script:InstallPath ''
  Read-ProductVersion $script:StagingPath $script:TargetVersion
  if ([IO.Directory]::Exists($script:BackupPath) -or [IO.File]::Exists($script:BackupPath)) { throw 'The unique backup folder already exists.' }
  Write-UpdateStatus 'installing' 'Installing the verified update.'
  [IO.Directory]::Move($script:InstallPath, $script:BackupPath)
  $script:InstallMoved = $true
  Assert-SafeSiblingPaths
  [IO.Directory]::Move($script:StagingPath, $script:InstallPath)
  $script:ReplacementMoved = $true
  $app = Start-Process -FilePath ([IO.Path]::Combine($script:InstallPath, 'ScientificPlotStudio.exe')) -WorkingDirectory $script:InstallPath -WindowStyle Normal -PassThru -ErrorAction Stop
  if ($app.WaitForExit(800) -and $app.ExitCode -ne 0) { throw 'The updated application could not start.' }
  # A status-cache failure after launch must not attempt to move a live application.
  try { Write-UpdateStatus 'complete' 'The update is installed. The previous version is retained in the backup folder.' }
  catch { [Console]::Error.WriteLine('The update launched successfully, but its final status could not be saved: ' + $_.Exception.Message) }
  exit 0
} catch {
  $message = $_.Exception.Message
  if ($script:InstallMoved) {
    try {
      Assert-SafeSiblingPaths
      if ($script:ReplacementMoved) {
        if ([IO.Directory]::Exists($script:StagingPath) -or [IO.File]::Exists($script:StagingPath)) { throw 'The staging folder is occupied; automatic rollback cannot safely proceed.' }
        [IO.Directory]::Move($script:InstallPath, $script:StagingPath)
      }
      if ([IO.Directory]::Exists($script:InstallPath) -or [IO.File]::Exists($script:InstallPath)) { throw 'The installation folder is occupied; automatic rollback cannot safely proceed.' }
      [IO.Directory]::Move($script:BackupPath, $script:InstallPath)
      $message += ' The previous installation was restored.'
      try { Start-Process -FilePath ([IO.Path]::Combine($script:InstallPath, 'ScientificPlotStudio.exe')) -WorkingDirectory $script:InstallPath -WindowStyle Normal -ErrorAction Stop | Out-Null } catch { $message += ' Reopen the previous application manually.' }
    } catch { $message += ' Rollback could not finish: ' + $_.Exception.Message + ' Previous files are retained at ' + $script:BackupPath }
  }
  try { Write-UpdateStatus 'error' $message } catch { [Console]::Error.WriteLine($_.Exception.Message) }
  [Console]::Error.WriteLine($message)
  exit 1
}
