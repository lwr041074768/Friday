param([Parameter(Mandatory=$true)][string]$FixtureDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$OriginMissing=[double](-1.23456789e-300)
$helper=Join-Path $PSScriptRoot '../desktop/build/app/native/Import-LsvOrigin.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($helper),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){. ([scriptblock]::Create($definition.Extent.Text))}
$packet=Read-Payload (Join-Path $FixtureDirectory 'fixture.json')
Validate-Payload $packet $packet.requestId
$plan=Get-OriginColumnPlan $packet $packet.samples[0]
if(($plan.Types -join ',') -cne '3,0,3,0' -or ($plan.Units -join ',') -cne 'cm^-1,a.u.,cm^-1,a.u.'){throw 'Raman designation or units mismatch.'}
if(!$plan.Comments.Contains('ATR3110') -or !$plan.Comments.Contains('BaseLine Subtracted')){throw 'Instrument or intensity source lost.'}
$eighty=Read-Payload (Join-Path $FixtureDirectory 'eighty.json');Validate-Payload $eighty $eighty.requestId
$rejects=0
foreach($bad in @('units','role','gap','rows','convention','tooMany','wrongKind')){
  $altered=$packet|ConvertTo-Json -Depth 20|ConvertFrom-Json
  switch($bad){
    'units' {$altered.columns[0].unit='deg'}
    'role' {$altered.columns[2].role='y'}
    'gap' {$altered.samples[1].rows[0][2]=1}
    'rows' {$altered.samples[0].rows[0][0]='195'}
    'convention' {$altered.samples[0].imaginary='raw'}
    'tooMany' {$altered.samples=@(1..81|ForEach-Object {$packet.samples[0]})}
    'wrongKind' {$altered.kind='other'}
  }
  $rejected=$false;try{Validate-Payload $altered $packet.requestId}catch{$rejected=$true};if(!$rejected){throw "Invalid $bad packet accepted."};$rejects++
}
foreach($file in @(Get-ChildItem -LiteralPath $FixtureDirectory -Filter '*.json'|Where-Object {$_.Name -notin @('fixture.json','eighty.json')})){$real=Read-Payload $file.FullName;if($real.PSObject.Properties['schema'] -and $real.schema -eq 'xy-origin/v1'){Validate-Payload $real $real.requestId}}
Write-Output "PASS: desktop Raman native syntax, real file packets, 80 spectra, cm^-1 units, X/Y columns, metadata and $rejects invalid request rejections."
