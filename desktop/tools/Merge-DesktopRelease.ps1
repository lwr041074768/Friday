param([string]$Directory=$PSScriptRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=(Resolve-Path -LiteralPath $Directory).ProviderPath
$manifest=Get-Content -LiteralPath (Join-Path $root 'release-manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
function Safe-Name([string]$name){if($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$'){throw 'Invalid release filename.'};return $name}
$fullName=Safe-Name $manifest.desktop.filename
if(!$fullName.EndsWith('.zip') -or $manifest.desktop.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid ZIP manifest.'}
$target=Join-Path $root $fullName
if(Test-Path -LiteralPath $target){if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.desktop.sha256){Write-Host 'Complete ZIP already exists and SHA256 is correct.';return};throw 'An existing ZIP does not match. Move it aside before merging.'}
if($manifest.desktop.parts.Count -lt 1 -or $manifest.desktop.parts.Count -gt 20){throw 'Invalid part count.'}
foreach($part in $manifest.desktop.parts){$name=Safe-Name $part.filename;$inputFile=Join-Path $root $name;if($part.sha256 -notmatch '^[a-f0-9]{64}$' -or !(Test-Path -LiteralPath $inputFile)){throw ('Missing or invalid part: '+$name)};if((Get-Item -LiteralPath $inputFile).Length -ne $part.size -or (Get-FileHash -LiteralPath $inputFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $part.sha256){throw ('Part checksum mismatch: '+$name)}}
$temporary=Join-Path $root ($fullName+'.'+[Guid]::NewGuid().ToString('N')+'.tmp')
try{
 $out=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{foreach($part in $manifest.desktop.parts){$inputFile=[IO.File]::OpenRead((Join-Path $root (Safe-Name $part.filename)));try{$inputFile.CopyTo($out)}finally{$inputFile.Dispose()}}}finally{$out.Dispose()}
 if((Get-Item -LiteralPath $temporary).Length -ne $manifest.desktop.size -or (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.desktop.sha256){throw 'Merged ZIP checksum mismatch.'}
 [IO.File]::Move($temporary,$target)
 Write-Host ('Verified ZIP created: '+$target)
 Write-Host 'Extract the whole ZIP and run ScientificPlotStudio.exe from its folder.'
}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
