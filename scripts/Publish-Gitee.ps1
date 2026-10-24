#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$')]
    [string]$RepoOwner = 'lwr2571166871',
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$')]
    [string]$RepoName = 'lwr',
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$')]
    [string]$Branch = 'master',
    [Parameter(Mandatory = $true)]
    [string]$ReleaseDirectory,
    [switch]$ValidateOnly,
    [switch]$KeepWindowOpen
)

# Explicitly invoked fallback only. No token parameter, credential store, or force push.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$script:Stage = '本机预检'
$script:FailureHint = '本机预检未完成。请检查源码和发行目录。'
$script:PlainToken = $null
$script:SecureToken = $null
$script:AskPassDirectory = $null
$script:AuthClient = $null
$script:PublicClient = $null
$script:GitExecutable = $null
$script:RootDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$script:RepoWebUrl = 'https://gitee.com/' + $RepoOwner + '/' + $RepoName
$script:GitUrl = $script:RepoWebUrl + '.git'
$script:ApiRepoPath = '/repos/' + $RepoOwner + '/' + $RepoName
$script:ProjectMarker = '[ScientificPlotStudio standalone]'
$script:AttachmentLimit = [long]100000000
$script:RepositoryAttachmentLimit = [long]1000000000
$script:HeadCommit = $null
$script:ReleasePath = $null
$script:ExpectedRepositoryId = [long]50748278
$script:ParentInitialCommit = '25f246a1bd7e3c5d353276a139f544f57521b864'
$script:ExitCode = 0

function Stop-Publication([string]$Reason) {
    $script:FailureHint = $Reason
    throw [InvalidOperationException]::new('Publication stopped; see the safe diagnostic.')
}

function Get-Property($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}

function ConvertTo-WindowsArgument([string]$Value) {
    # Windows CommandLineToArgvW quoting; values never contain the token.
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-PublicationGit {
    param([string[]]$Arguments, [switch]$Authenticate, [switch]$AllowFailure)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $script:GitExecutable
    $info.WorkingDirectory = $script:RootDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    # Child-only environment. Existing parent process credentials/config are untouched.
    foreach ($key in @($info.EnvironmentVariables.Keys)) {
        if ($key -match '^(GIT_TRACE|GIT_CURL_VERBOSE|GIT_CONFIG|GIT_ASKPASS|SSH_ASKPASS|SPS_GIT_|GIT_SSL_NO_VERIFY)') {
            $info.EnvironmentVariables.Remove($key)
        }
    }
    $info.EnvironmentVariables['GIT_CONFIG_NOSYSTEM'] = '1'
    $info.EnvironmentVariables['GIT_CONFIG_GLOBAL'] = 'NUL'
    $info.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    $info.EnvironmentVariables['GCM_INTERACTIVE'] = 'Never'
    $info.EnvironmentVariables['LC_ALL'] = 'C'
    $common = @('-c', 'credential.helper=', '-c', ('credential.username=' + $RepoOwner),
        '-c', 'credential.useHttpPath=true', '-c', 'http.followRedirects=false',
        '-c', 'http.sslVerify=true', '-c', 'http.proxy=', '-c', 'http.extraHeader=')
    if ($null -ne $script:AskPassDirectory) {
        $common += @('-c', ('core.hooksPath=' + (Join-Path $script:AskPassDirectory 'hooks')))
    }
    if ($Authenticate) {
        if ([string]::IsNullOrEmpty($script:PlainToken) -or $null -eq $script:AskPassDirectory) {
            Stop-Publication '尚未准备本机凭据，无法执行 Git 发布。'
        }
        $info.EnvironmentVariables['GIT_ASKPASS'] = Join-Path $script:AskPassDirectory 'AskPass.cmd'
        $info.EnvironmentVariables['SPS_GIT_PAT'] = $script:PlainToken
        $info.EnvironmentVariables['SPS_GIT_LOGIN'] = $RepoOwner
        $info.EnvironmentVariables['SPS_GIT_URL'] = $script:GitUrl
    }
    $info.Arguments = (@($common + $Arguments) | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' '
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    $started = $false
    try {
        if (-not $process.Start()) { Stop-Publication '无法启动 Git。' }
        $started = $true
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $output = $stdout.GetAwaiter().GetResult()
        $safeError = $stderr.GetAwaiter().GetResult()
        if (-not [string]::IsNullOrEmpty($script:PlainToken)) {
            $safeError = $safeError.Replace($script:PlainToken, '[REDACTED]')
            $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($RepoOwner + ':' + $script:PlainToken))
            $safeError = $safeError.Replace($basic, '[REDACTED]')
            $basic = $null
        }
        $safeError = [regex]::Replace($safeError, '(?im)^.*(?:authorization|password=|access_token=).*$','[REDACTED]')
        if ($safeError.Length -gt 1200) { $safeError = $safeError.Substring(0,1200) }
        $result = [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output }
        if ($result.ExitCode -ne 0 -and -not $AllowFailure) {
            Stop-Publication ('Git 操作失败（退出码 ' + $result.ExitCode + '）。' + $safeError.Trim())
        }
        return $result
    }
    finally {
        if ($started) {
            try {
                if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit(5000) | Out-Null }
            }
            catch { # Only this publisher's unfinished Git process is eligible for termination.
            }
        }
        $info.EnvironmentVariables.Remove('SPS_GIT_PAT')
        $info.EnvironmentVariables.Remove('SPS_GIT_LOGIN')
        $info.EnvironmentVariables.Remove('SPS_GIT_URL')
        $process.Dispose()
    }
}

function Read-ZipVersion([string]$Path) {
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entries = @($archive.Entries | Where-Object { $_.FullName -match '^[^/]+/VERSION\.json$' })
        if ($entries.Count -ne 1 -or $entries[0].Length -gt 65536) {
            Stop-Publication 'ZIP 必须包含唯一且有效的顶层 VERSION.json。'
        }
        $stream = $entries[0].Open()
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8)
        try { return ($reader.ReadToEnd() | ConvertFrom-Json) }
        finally { $reader.Dispose(); $stream.Dispose() }
    }
    finally { $archive.Dispose() }
}

function Test-LocalRelease {
    if ($RepoOwner -cne 'lwr2571166871' -or $RepoName -cne 'lwr' -or $Branch -cne 'master') {
        Stop-Publication '此入口仅承接已授权的 lwr2571166871/lwr 仓库和 master 分支。'
    }
    $script:GitExecutable = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $localBranch = (Invoke-PublicationGit -Arguments @('symbolic-ref', '--short', 'HEAD')).Output.Trim()
    if ($localBranch -cne $Branch) { Stop-Publication ('请在独立仓库的 ' + $Branch + ' 分支发布。') }
    $script:HeadCommit = (Invoke-PublicationGit -Arguments @('rev-parse', 'HEAD')).Output.Trim()
    if ($script:HeadCommit -notmatch '^[0-9a-f]{40}$') { Stop-Publication '源码尚无有效提交，请先提交后重新打包。' }
    $initialHistory = Invoke-PublicationGit -Arguments @('merge-base', '--is-ancestor', $script:ParentInitialCommit, $script:HeadCommit) -AllowFailure
    if ($initialHistory.ExitCode -ne 0) { Stop-Publication '本机源码未承接 LWR 已确认的模板初始提交；不会替换其他历史。' }
    if ((Invoke-PublicationGit -Arguments @('status', '--porcelain')).Output.Trim()) {
        Stop-Publication '源码工作区尚未提交。请先提交全部发布变更，再重新打包。'
    }
    $package = Get-Content -LiteralPath (Join-Path $script:RootDirectory 'package.json') -Raw | ConvertFrom-Json
    if ($package.name -cne 'scientific-plot-studio' -or $package.version -cne '1.0.0') {
        Stop-Publication '此发布入口只适用于 scientific-plot-studio 1.0.0 独立源码。'
    }
    $readme = Get-Content -LiteralPath (Join-Path $script:RootDirectory 'README.md') -Raw
    if ($readme -notmatch 'Scientific Plot Studio' -or -not (Test-Path -LiteralPath (Join-Path $script:RootDirectory 'desktop/server.mjs'))) {
        Stop-Publication '未找到独立版 README 或桌面服务源码。'
    }
    $script:ReleasePath = (Resolve-Path -LiteralPath $ReleaseDirectory -ErrorAction Stop).ProviderPath
    if (-not (Test-Path -LiteralPath $script:ReleasePath -PathType Container)) { Stop-Publication '发行目录不存在。' }
    $names = @('scientific-plot-studio-1.0.0-windows-x64.zip', 'origin-helper-2.6.0-windows.zip', 'scientific-plot-studio-1.0.0-source.zip')
    $sumPath = Join-Path $script:ReleasePath 'SHA256SUMS.txt'
    $checksums = @{}
    foreach ($line in @(Get-Content -LiteralPath $sumPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -notmatch '^([0-9a-fA-F]{64})[ \t]+\*?([A-Za-z0-9_.-]+)$') { Stop-Publication 'SHA256SUMS.txt 含无效行或非文件名路径。' }
        $name = $Matches[2]
        if ($checksums.ContainsKey($name) -or $names -cnotcontains $name) { Stop-Publication 'SHA256 清单存在重复或非本版本文件。' }
        $checksums[$name] = $Matches[1].ToLowerInvariant()
    }
    if ($checksums.Count -ne $names.Count) { Stop-Publication 'SHA256 清单必须完整列出三个发行 ZIP。' }
    $script:LocalAssets = @()
    foreach ($name in $names) {
        $path = Join-Path $script:ReleasePath $name
        $file = Get-Item -LiteralPath $path
        if ($file.PSIsContainer -or $file.Length -le 0 -or $file.Length -gt $script:AttachmentLimit) {
            Stop-Publication ('附件超出单文件限制或为空：' + $name)
        }
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -cne $checksums[$name]) { Stop-Publication ('SHA256 不匹配：' + $name) }
        $manifest = Read-ZipVersion $path
        if ((Get-Property $manifest 'sourceCommit') -cne $script:HeadCommit) { Stop-Publication ('ZIP 来源提交与当前 HEAD 不一致：' + $name + '。请重新打包。') }
        if ($name -ceq 'origin-helper-2.6.0-windows.zip') {
            if ((Get-Property $manifest 'version') -cne '2.6.0') { Stop-Publication 'Origin 助手版本文件不匹配。' }
        }
        elseif ((Get-Property $manifest 'appVersion') -cne '1.0.0' -or
                (Get-Property $manifest 'originHelperVersion') -cne '2.6.0' -or
                (Get-Property $manifest 'nodeVersion') -cne '24.15.0') { Stop-Publication ('软件版本文件不匹配：' + $name) }
        $script:LocalAssets += [pscustomobject]@{ Name = $name; Path = $path; Size = [long]$file.Length; Sha256 = $hash }
    }
    $sumFile = Get-Item -LiteralPath $sumPath
    if ($sumFile.Length -le 0 -or $sumFile.Length -gt 65536) { Stop-Publication 'SHA256 清单大小异常。' }
    $script:LocalAssets += [pscustomobject]@{ Name = 'SHA256SUMS.txt'; Path = $sumPath; Size = [long]$sumFile.Length; Sha256 = (Get-FileHash -LiteralPath $sumPath -Algorithm SHA256).Hash.ToLowerInvariant() }
    foreach ($tag in @('v1.0.0', 'origin-helper-v2.6.0')) {
        $tagResult = Invoke-PublicationGit -Arguments @('rev-parse', '--verify', ('refs/tags/' + $tag + '^{commit}')) -AllowFailure
        if ($tagResult.ExitCode -eq 0 -and $tagResult.Output.Trim() -cne $script:HeadCommit) { Stop-Publication ('本机已有标签指向不同提交：' + $tag) }
    }
    # Detect local URL rewrites without supplying credentials.
    $resolvedUrl = (Invoke-PublicationGit -Arguments @('ls-remote', '--get-url', $script:GitUrl)).Output.Trim()
    if ($resolvedUrl -cne $script:GitUrl) { Stop-Publication 'Git 配置重写了目标 URL。为避免向其他主机发送凭据，发布停止。' }
    $unsafeLocalConfig = Invoke-PublicationGit -Arguments @('config', '--local', '--name-only', '--get-regexp', '^(include|credential\.|http\..*(extraheader|proxy|followredirects|sslverify))') -AllowFailure
    if ($unsafeLocalConfig.ExitCode -eq 0 -and $unsafeLocalConfig.Output.Trim()) {
        Stop-Publication '仓库本地 Git 配置包含额外凭据、HTTP 或 include 设置，请检查并移除后重试；脚本不会读取或改写其值。'
    }
    if ($unsafeLocalConfig.ExitCode -gt 1) { Stop-Publication '无法核对仓库本地 Git 配置。' }
}

function New-AskPass {
    $temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $script:AskPassDirectory = Join-Path $temporaryBase ('ScientificPlotStudio-Gitee-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($script:AskPassDirectory) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $script:AskPassDirectory 'hooks')) | Out-Null
    $source = @'
param([string]$Prompt)
$ErrorActionPreference = 'Stop'
try {
    $expected = [Uri][Environment]::GetEnvironmentVariable('SPS_GIT_URL', 'Process')
    $match = [regex]::Match($Prompt, "\A(Username|Password) for '([^']+)':\s*\z", [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) { exit 1 }
    $requested = [Uri]$match.Groups[2].Value
    if ($expected.Scheme -cne 'https' -or $requested.Scheme -cne 'https' -or
        $expected.Host -cne 'gitee.com' -or $requested.Host -cne 'gitee.com' -or
        $requested.Port -ne 443 -or $requested.AbsolutePath -cne $expected.AbsolutePath -or
        $requested.Query -or $requested.Fragment) { exit 1 }
    if ($match.Groups[1].Value -ieq 'Username') { $value = [Environment]::GetEnvironmentVariable('SPS_GIT_LOGIN', 'Process') }
    else { $value = [Environment]::GetEnvironmentVariable('SPS_GIT_PAT', 'Process') }
    if ([string]::IsNullOrEmpty($value) -or $value -match '[\r\n\x00]') { exit 1 }
    [Console]::Out.WriteLine($value)
    $value = $null
    exit 0
} catch { exit 1 }
'@
    [IO.File]::WriteAllText((Join-Path $script:AskPassDirectory 'AskPass.ps1'), $source, [Text.UTF8Encoding]::new($false))
    $wrapper = '@echo off' + "`r`n" + '"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0AskPass.ps1" %*' + "`r`n"
    [IO.File]::WriteAllText((Join-Path $script:AskPassDirectory 'AskPass.cmd'), $wrapper, [Text.Encoding]::ASCII)
}

function New-GiteeClient([bool]$Authenticated) {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = -not $Authenticated
    $handler.UseCookies = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(10)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('ScientificPlotStudio-Publisher/1.0.0')
    if ($Authenticated) { $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $script:PlainToken) }
    return $client
}

function Invoke-GiteeApi {
    param([string]$Method = 'GET', [string]$Route, $Body = $null, [switch]$Anonymous, [switch]$AllowNotFound)
    if (-not $Route.StartsWith('/') -or $Route.Contains('..')) { Stop-Publication 'API 路径无效。' }
    $client = $script:AuthClient
    if ($Anonymous) { $client = $script:PublicClient }
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), ('https://gitee.com/api/v5' + $Route))
    $response = $null
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(45))
    try {
        if ($null -ne $Body) { $request.Content = [Net.Http.StringContent]::new(($Body | ConvertTo-Json -Depth 10 -Compress), [Text.Encoding]::UTF8, 'application/json') }
        $response = $client.SendAsync($request, $cancel.Token).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        if ($status -eq 404 -and $AllowNotFound) { return [pscustomobject]@{ Status = 404; Data = $null } }
        if ($status -lt 200 -or $status -ge 300) { Stop-Publication ('Gitee API 返回 HTTP ' + $status + '（' + $Method + ' ' + $Route + '）。请检查令牌权限、网络或仓库公开设置后重试。') }
        if ($response.RequestMessage.RequestUri.Host -cne 'gitee.com') { Stop-Publication 'API 返回了非 Gitee 地址。' }
        $json = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($json.Length -gt 16000000) { Stop-Publication 'API 响应异常过大。' }
        $data = $null
        if (-not [string]::IsNullOrWhiteSpace($json)) { $data = $json | ConvertFrom-Json }
        return [pscustomobject]@{ Status = $status; Data = $data }
    }
    finally { if ($null -ne $response) { $response.Dispose() }; $request.Dispose(); $cancel.Dispose() }
}

function Assert-RepositoryIdentity($Repository) {
    $owner = Get-Property $Repository 'owner'
    if ((Get-Property $Repository 'full_name') -ine ($RepoOwner + '/' + $RepoName) -or
        (Get-Property $Repository 'id') -ne $script:ExpectedRepositoryId -or
        (Get-Property $owner 'login') -ine $RepoOwner -or (Get-Property $owner 'id') -ne $script:AccountId) {
        Stop-Publication '目标仓库的账号、ID 或路径不匹配，发布停止。'
    }
}

function Get-RemoteRefs {
    $result = Invoke-PublicationGit -Arguments @('ls-remote', $script:GitUrl) -Authenticate
    $refs = @{}
    foreach ($line in @($result.Output -split '\r?\n')) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -notmatch '^([0-9a-f]{40})\s+(\S+)$') { Stop-Publication '远程 refs 返回无效格式。' }
        $refs[$Matches[2]] = $Matches[1]
    }
    return $refs
}

function Assert-RemoteProvenance($Repository, $Refs) {
    Assert-RepositoryIdentity $Repository
    if ($Refs.Count -eq 0) { Stop-Publication '已确认的 LWR 仓库变为空仓库，来源不符，发布停止。' }
    $branchRef = 'refs/heads/' + $Branch
    $allowed = @('HEAD', $branchRef, 'refs/tags/v1.0.0', 'refs/tags/v1.0.0^{}', 'refs/tags/origin-helper-v2.6.0', 'refs/tags/origin-helper-v2.6.0^{}')
    foreach ($name in $Refs.Keys) { if ($allowed -cnotcontains $name) { Stop-Publication 'LWR 包含本次承接以外的分支或标签，来源检查停止。' } }
    if (-not $Refs.ContainsKey($branchRef)) { Stop-Publication '已确认的 LWR 仓库缺少 master，来源不符。' }
    if ($Refs.ContainsKey('HEAD') -and $Refs['HEAD'] -cne $Refs[$branchRef]) { Stop-Publication '远程默认分支与已确认的 master 不一致。' }
    if ($Refs[$branchRef] -cne $script:HeadCommit) {
        Invoke-PublicationGit -Arguments @('fetch', '--no-tags', '--no-write-fetch-head', $script:GitUrl, $branchRef) -Authenticate | Out-Null
        $ancestor = Invoke-PublicationGit -Arguments @('merge-base', '--is-ancestor', $Refs[$branchRef], $script:HeadCommit) -AllowFailure
        if ($ancestor.ExitCode -ne 0) { Stop-Publication '远程 master 与本地源码历史不一致；不会强制覆盖。' }
    }
    $initialHistory = Invoke-PublicationGit -Arguments @('merge-base', '--is-ancestor', $script:ParentInitialCommit, $Refs[$branchRef]) -AllowFailure
    if ($initialHistory.ExitCode -ne 0) { Stop-Publication '远程 master 未保留已确认的模板初始提交，发布停止。' }
    foreach ($tag in @('v1.0.0', 'origin-helper-v2.6.0')) {
        $ref = 'refs/tags/' + $tag
        if ($Refs.ContainsKey($ref)) {
            $sha = $Refs[$ref]
            if ($Refs.ContainsKey($ref + '^{}')) { $sha = $Refs[$ref + '^{}'] }
            if ($sha -cne $script:HeadCommit) { Stop-Publication ('远程标签已指向其他提交：' + $tag) }
        }
    }
}

function Get-ReleaseAttachments([long]$ReleaseId, [switch]$Anonymous) {
    $all = @()
    for ($page = 1; $page -le 100; $page++) {
        $response = Invoke-GiteeApi -Route ($script:ApiRepoPath + '/releases/' + $ReleaseId + '/attach_files?page=' + $page + '&per_page=100') -Anonymous:$Anonymous
        $items = @()
        if ($null -ne $response.Data) { $items = @($response.Data) }
        $all += $items
        if ($items.Count -lt 100) { return $all }
    }
    Stop-Publication '发行版附件分页超出检查范围，发布停止。'
}

function Get-AllReleases {
    $all = @()
    for ($page = 1; $page -le 100; $page++) {
        $response = Invoke-GiteeApi -Route ($script:ApiRepoPath + '/releases?page=' + $page + '&per_page=100')
        $items = @()
        if ($null -ne $response.Data) { $items = @($response.Data) }
        $all += $items
        if ($items.Count -lt 100) { return $all }
    }
    Stop-Publication '发行版分页超出检查范围，发布停止。'
}

function Assert-PublicRepository {
    $response = Invoke-GiteeApi -Route $script:ApiRepoPath -Anonymous
    Assert-RepositoryIdentity $response.Data
    if ((Get-Property $response.Data 'private') -ne $false) { Stop-Publication '目标仓库尚未通过匿名公开验证。请在 Gitee 完成公开设置后重试。' }
}

function Get-PublicAttachmentHash($Attachment, [long]$ExpectedSize) {
    $address = [string](Get-Property $Attachment 'browser_download_url')
    $uri = [Uri]$address
    $prefix = '/' + $RepoOwner + '/' + $RepoName + '/'
    $apiPrefix = '/api/v5/repos/' + $RepoOwner + '/' + $RepoName + '/'
    if ($uri.Scheme -cne 'https' -or $uri.Host -cne 'gitee.com' -or $uri.Port -ne 443 -or
        (-not $uri.AbsolutePath.StartsWith($prefix, [StringComparison]::Ordinal) -and
         -not $uri.AbsolutePath.StartsWith($apiPrefix, [StringComparison]::Ordinal)) -or $uri.UserInfo) {
        Stop-Publication '附件下载地址不属于本次 Gitee 仓库，发布停止。'
    }
    $response = $null
    $stream = $null
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        # Separate anonymous client: no PAT is forwarded to downloads or CDN redirects.
        $response = $script:PublicClient.GetAsync($uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode -or $response.RequestMessage.RequestUri.Scheme -cne 'https') { Stop-Publication '无法匿名下载发行版附件。' }
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $buffer = New-Object byte[] 81920
        $total = [long]0
        while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $read
            if ($total -gt $ExpectedSize) { Stop-Publication '公开附件下载大小超出预期。' }
            $sha.TransformBlock($buffer, 0, $read, $buffer, 0) | Out-Null
        }
        $sha.TransformFinalBlock([byte[]]@(), 0, 0) | Out-Null
        if ($total -ne $ExpectedSize) { Stop-Publication '公开附件下载大小不匹配。' }
        return ([BitConverter]::ToString($sha.Hash).Replace('-', '').ToLowerInvariant())
    }
    finally { if ($null -ne $stream) { $stream.Dispose() }; if ($null -ne $response) { $response.Dispose() }; $sha.Dispose() }
}

function Send-ReleaseAttachment([long]$ReleaseId, $Asset) {
    $stream = [IO.File]::OpenRead($Asset.Path)
    $multipart = [Net.Http.MultipartFormDataContent]::new()
    $response = $null
    try {
        $content = [Net.Http.StreamContent]::new($stream)
        $content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')
        $multipart.Add($content, 'file', $Asset.Name)
        $uri = 'https://gitee.com/api/v5' + $script:ApiRepoPath + '/releases/' + $ReleaseId + '/attach_files'
        $response = $script:AuthClient.PostAsync($uri, $multipart).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { Stop-Publication ('上传未完成：' + $Asset.Name + '（HTTP ' + [int]$response.StatusCode + '）。共享附件配额或网络问题可能导致失败，修复后可重新运行。') }
        $json = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($json.Length -gt 1000000) { Stop-Publication '附件上传响应异常。' }
        return ($json | ConvertFrom-Json)
    }
    finally { if ($null -ne $response) { $response.Dispose() }; $multipart.Dispose(); $stream.Dispose() }
}

function Invoke-Publication {
    Add-Type -AssemblyName System.Net.Http
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Test-LocalRelease
    Write-Host ('本机版本与 SHA256 校验通过；源码提交：' + $script:HeadCommit)
    if ($ValidateOnly) { Write-Host '仅执行本机校验，未输入令牌、未联网、未发布。'; return }

    Write-Host ('备用方式将发布到 ' + $script:RepoWebUrl)
    Write-Host '请仅在本机输入 Gitee 个人访问令牌，不要通过聊天发送。输入不会显示。'
    $script:Stage = '本机令牌输入'
    $script:FailureHint = '本机令牌输入或凭据客户端准备未完成；需要此个人仓库账号的 Gitee 个人访问令牌。'
    $script:SecureToken = Read-Host 'Gitee PAT' -AsSecureString
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($script:SecureToken)
        $script:PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally { if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) } }
    if ([string]::IsNullOrWhiteSpace($script:PlainToken) -or $script:PlainToken.Length -gt 1024 -or $script:PlainToken -match '[\x00-\x20\x7f]') { Stop-Publication '令牌为空或含无效字符。' }
    New-AskPass
    $script:AuthClient = New-GiteeClient $true
    $script:PublicClient = New-GiteeClient $false
    $script:Stage = '账号与仓库来源检查'
    $script:FailureHint = '账号或仓库来源检查未完成，请检查令牌权限和网络后重试。'
    $account = (Invoke-GiteeApi -Route '/user').Data
    if ((Get-Property $account 'login') -ine $RepoOwner) { Stop-Publication '令牌所属账号与指定 RepoOwner 不一致，发布停止。' }
    $script:AccountId = Get-Property $account 'id'
    if ($null -eq $script:AccountId) { Stop-Publication '无法核对账号 ID。' }
    $repository = (Invoke-GiteeApi -Route $script:ApiRepoPath).Data
    Assert-RepositoryIdentity $repository
    if ((Get-Property $repository 'private') -ne $false -or (Get-Property $repository 'default_branch') -cne $Branch) {
        Stop-Publication '已确认的 LWR 仓库公开状态或默认 master 分支已改变；脚本不会调整仓库可见性。'
    }
    Assert-PublicRepository
    $refs = Get-RemoteRefs
    Assert-RemoteProvenance $repository $refs
    $allReleases = @(Get-AllReleases)
    $script:ReleaseMarker = $script:ProjectMarker + ' sourceCommit=' + $script:HeadCommit
    foreach ($knownRelease in $allReleases) {
        if ((Get-Property $knownRelease 'tag_name') -cne 'v1.0.0' -or
            -not ([string](Get-Property $knownRelease 'body')).Contains($script:ReleaseMarker)) {
            Stop-Publication '目标仓库包含来源未核对的发行版；不会修改其内容。'
        }
    }
    $existing = @($allReleases | Where-Object { (Get-Property $_ 'tag_name') -ceq 'v1.0.0' })
    if ($existing.Count -gt 1) { Stop-Publication '目标仓库存在重复发行版标签，发布停止。' }
    if ($existing.Count -eq 1 -and ((Get-Property $existing[0] 'target_commitish') -cne $script:HeadCommit -or
        -not ([string](Get-Property $existing[0] 'body')).Contains($script:ReleaseMarker))) { Stop-Publication '已有 v1.0.0 发行版的提交或来源标记不同，不会覆写。' }
    $totalSize = [long]0
    $existingAttachments = @()
    foreach ($release in $allReleases) {
        $id = [long](Get-Property $release 'id')
        if ($id -le 0) { Stop-Publication '发行版 ID 无效。' }
        $attachments = @(Get-ReleaseAttachments $id)
        foreach ($attachment in $attachments) {
            $size = Get-Property $attachment 'size'
            if ($null -eq $size -or [long]$size -lt 0 -or [long]$size -gt $script:RepositoryAttachmentLimit) { Stop-Publication '已有附件大小无法确认。' }
            $totalSize += [long]$size
        }
        if ($existing.Count -eq 1 -and $id -eq [long](Get-Property $existing[0] 'id')) { $existingAttachments = $attachments }
    }
    foreach ($asset in $script:LocalAssets) {
        $sameName = @($existingAttachments | Where-Object { (Get-Property $_ 'name') -ceq $asset.Name })
        if ($sameName.Count -gt 1) { Stop-Publication ('已有附件同名重复：' + $asset.Name) }
        if ($sameName.Count -eq 0) { $totalSize += $asset.Size }
        elseif ([long](Get-Property $sameName[0] 'size') -ne $asset.Size) { Stop-Publication ('已有同名附件大小不同，不会覆盖：' + $asset.Name) }
    }
    if ($totalSize -gt $script:RepositoryAttachmentLimit) { Stop-Publication '现有发行版附件与新增附件合计超出 1G 限制。' }
    Write-Host '已检查可枚举发行版附件配额；仓库其他附件也占用共享配额，以 Gitee 服务端检查为准。'

    Write-Host 'LWR 仓库身份、历史承接和匿名公开验证通过。'

    $script:Stage = '推送 master 源码'
    $script:FailureHint = '源码推送未完成，请检查网络、权限和远程历史后重试；不会强制推送。'
    Invoke-PublicationGit -Arguments @('push', $script:GitUrl, ('HEAD:refs/heads/' + $Branch)) -Authenticate | Out-Null
    $publicBranch = (Invoke-GiteeApi -Route ($script:ApiRepoPath + '/branches/' + $Branch) -Anonymous).Data
    if ((Get-Property (Get-Property $publicBranch 'commit') 'sha') -cne $script:HeadCommit) { Stop-Publication '匿名检查的 master 提交与本机 HEAD 不一致。' }
    $refs = Get-RemoteRefs
    Assert-RemoteProvenance $repository $refs

    $script:Stage = '推送版本标签'
    $script:FailureHint = '标签推送未完成，请检查网络、权限和远程标签后重试；不会覆盖已有不同标签。'
    foreach ($tag in @('v1.0.0', 'origin-helper-v2.6.0')) {
        $result = Invoke-PublicationGit -Arguments @('rev-parse', '--verify', ('refs/tags/' + $tag + '^{commit}')) -AllowFailure
        if ($result.ExitCode -ne 0) { Invoke-PublicationGit -Arguments @('tag', $tag, $script:HeadCommit) | Out-Null }
    }
    Invoke-PublicationGit -Arguments @('push', $script:GitUrl, 'refs/tags/v1.0.0:refs/tags/v1.0.0', 'refs/tags/origin-helper-v2.6.0:refs/tags/origin-helper-v2.6.0') -Authenticate | Out-Null
    $refs = Get-RemoteRefs
    Assert-RemoteProvenance $repository $refs

    $script:Stage = '发行版与附件'
    $script:FailureHint = '发行版或附件验证未完成，请检查网络、下载可见性或共享配额后重试；不会覆盖不同附件。'
    $releaseResponse = Invoke-GiteeApi -Route ($script:ApiRepoPath + '/releases/tags/v1.0.0') -AllowNotFound
    if ($releaseResponse.Status -eq 404) {
        $body = @"
$($script:ReleaseMarker)

Scientific Plot Studio 1.0.0：LSV、EIS、Tafel、XRD、Raman 本机绘图工作台。
Windows x64 桌面 ZIP 内置 Node.js 24.15.0，解压后运行 ScientificPlotStudio.exe 或 启动.cmd。
Origin 助手独立版本 2.6.0，需要用户合法安装并激活 Windows Origin / OriginPro。
各 ZIP 含 VERSION.json；请使用 SHA256SUMS.txt 核对下载文件。
项目自有代码 MIT，第三方原始许可随包保留；不包含原网站文献登录后台。
"@
        $release = (Invoke-GiteeApi -Method 'POST' -Route ($script:ApiRepoPath + '/releases') -Body @{
            tag_name = 'v1.0.0'; name = 'Scientific Plot Studio 1.0.0'; body = $body;
            target_commitish = $script:HeadCommit; prerelease = $false
        }).Data
    }
    else { $release = $releaseResponse.Data }
    if ((Get-Property $release 'tag_name') -cne 'v1.0.0' -or (Get-Property $release 'target_commitish') -cne $script:HeadCommit -or
        -not ([string](Get-Property $release 'body')).Contains($script:ReleaseMarker)) { Stop-Publication '发行版来源无法确认，不会修改。' }
    $releaseId = [long](Get-Property $release 'id')
    if ($releaseId -le 0) { Stop-Publication '发行版 ID 无效。' }
    $attachments = @(Get-ReleaseAttachments $releaseId)
    $verified = @()
    foreach ($asset in $script:LocalAssets) {
        Write-Host ('检查／上传附件：' + $asset.Name)
        $sameName = @($attachments | Where-Object { (Get-Property $_ 'name') -ceq $asset.Name })
        if ($sameName.Count -gt 1) { Stop-Publication ('附件同名重复，无法恢复：' + $asset.Name) }
        if ($sameName.Count -eq 0) { $attachment = Send-ReleaseAttachment $releaseId $asset }
        else { $attachment = $sameName[0] }
        if ((Get-Property $attachment 'name') -cne $asset.Name -or [long](Get-Property $attachment 'size') -ne $asset.Size) { Stop-Publication ('远程附件名称或大小不匹配：' + $asset.Name) }
        if ((Get-PublicAttachmentHash $attachment $asset.Size) -cne $asset.Sha256) { Stop-Publication ('远程附件 SHA256 不匹配，不会覆盖：' + $asset.Name) }
        $verified += [pscustomobject]@{ name = $asset.Name; size = $asset.Size; sha256 = $asset.Sha256;
            downloadUrl = [string](Get-Property $attachment 'browser_download_url'); id = Get-Property $attachment 'id' }
    }
    Assert-PublicRepository
    $publicRelease = (Invoke-GiteeApi -Route ($script:ApiRepoPath + '/releases/tags/v1.0.0') -Anonymous).Data
    if ([long](Get-Property $publicRelease 'id') -ne $releaseId -or (Get-Property $publicRelease 'target_commitish') -cne $script:HeadCommit) { Stop-Publication '发行版最终匿名验证失败。' }
    $publicAttachments = @(Get-ReleaseAttachments $releaseId -Anonymous)
    foreach ($asset in $verified) {
        $matches = @($publicAttachments | Where-Object { (Get-Property $_ 'name') -ceq $asset.name -and (Get-Property $_ 'id') -eq $asset.id -and [long](Get-Property $_ 'size') -eq $asset.size })
        if ($matches.Count -ne 1) { Stop-Publication ('附件最终匿名验证失败：' + $asset.name) }
    }
    $releaseUrl = $script:RepoWebUrl + '/releases/v1.0.0'
    $page = $script:PublicClient.GetAsync($releaseUrl).GetAwaiter().GetResult()
    try {
        if (-not $page.IsSuccessStatusCode -or $page.RequestMessage.RequestUri.Host -cne 'gitee.com' -or
            $page.RequestMessage.RequestUri.AbsolutePath -notlike ('/' + $RepoOwner + '/' + $RepoName + '/releases*')) { Stop-Publication '发行版网页未通过匿名验证。' }
    }
    finally { $page.Dispose() }
    $publication = [ordered]@{ product = 'Scientific Plot Studio'; appVersion = '1.0.0'; originHelperVersion = '2.6.0';
        nodeVersion = '24.15.0'; sourceCommit = $script:HeadCommit; repositoryUrl = $script:RepoWebUrl;
        repositoryId = $script:ExpectedRepositoryId; branch = $Branch; parentInitialCommit = $script:ParentInitialCommit;
        releaseUrl = $releaseUrl; releaseId = $releaseId; tag = 'v1.0.0'; verifiedAt = [DateTime]::UtcNow.ToString('o'); assets = $verified }
    [IO.File]::WriteAllText((Join-Path $script:ReleasePath 'PUBLICATION.json'), ($publication | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Write-Host ('已完成公开发布并核对下载 SHA256：' + $releaseUrl)
    foreach ($asset in $verified) { Write-Host ($asset.name + ': ' + $asset.downloadUrl) }
    Write-Host '无凭据的发布记录已保存到发行目录 PUBLICATION.json。'
}

try { Invoke-Publication }
catch {
    $script:ExitCode = 1
    $failureType = $_.Exception.GetType().FullName
    Write-Host ('发布未完成（' + $script:Stage + '）：' + $script:FailureHint) -ForegroundColor Red
    # Never persist raw exception messages, HTTP bodies, headers, or credentials.
    try {
        $failureDirectory = $script:ReleasePath
        if ([string]::IsNullOrEmpty($failureDirectory)) {
            $failureDirectory = (Resolve-Path -LiteralPath $ReleaseDirectory -ErrorAction Stop).ProviderPath
        }
        if (Test-Path -LiteralPath $failureDirectory -PathType Container) {
            $failure = [ordered]@{ Stage = $script:Stage; FailureHint = $script:FailureHint; ExceptionType = $failureType }
            [IO.File]::WriteAllText((Join-Path $failureDirectory 'FAILURE.json'), ($failure | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
            Write-Host '不含凭据的失败记录已保存到发行目录 FAILURE.json。'
        }
    }
    catch { Write-Host '发行目录不可写，失败记录未保存；请保留上方阶段提示。' -ForegroundColor Yellow }
}
finally {
    if ($null -ne $script:AuthClient) { $script:AuthClient.DefaultRequestHeaders.Authorization = $null; $script:AuthClient.Dispose() }
    if ($null -ne $script:PublicClient) { $script:PublicClient.Dispose() }
    if ($null -ne $script:SecureToken) { $script:SecureToken.Dispose() }
    $script:PlainToken = $null
    $script:SecureToken = $null
    if ($null -ne $script:AskPassDirectory) {
        $temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        $temporaryTarget = [IO.Path]::GetFullPath($script:AskPassDirectory)
        if ($temporaryTarget.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($temporaryTarget) -match '^ScientificPlotStudio-Gitee-[0-9a-f]{32}$') {
            Remove-Item -LiteralPath $temporaryTarget -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
if ($KeepWindowOpen) {
    Write-Host ('本机发布入口已结束，退出码：' + $script:ExitCode + '。请以 PUBLICATION.json 为成功依据；失败时检查 FAILURE.json。')
    Read-Host '按 Enter 关闭发布窗口' | Out-Null
}
exit $script:ExitCode
