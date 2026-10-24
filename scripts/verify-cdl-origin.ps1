param([Parameter(Mandatory=$true)][string]$FixtureDirectory,[switch]$ExerciseOrigin,[switch]$Reference)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../desktop/native/Import-CdlOrigin.ps1') -ValidateOnly
$fixture=if($Reference){'reference-fixture.json'}else{'fixture.json'}
$packet=[IO.File]::ReadAllText((Join-Path $FixtureDirectory $fixture),[Text.Encoding]::UTF8)|ConvertFrom-Json
$invalid=[IO.File]::ReadAllText((Join-Path $FixtureDirectory 'rejects.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
Assert-CdlPayload $packet $packet.requestId
foreach($altered in $invalid){$rejected=$false;try{Assert-CdlPayload $altered $packet.requestId}catch{$rejected=$true};if(!$rejected){throw 'Native Cdl importer accepted malformed packet.'}}
Write-Output ('PASS: native Cdl payload validation and '+$invalid.Count+' malformed request rejections.')
if(!$ExerciseOrigin){return}
$owned=$null;$book=$null;$sheet=$null;$column=$null;$cv=$null;$fit=$null;$cvLayer=$null;$fitLayer=$null;$new=@()
$previous=@(Get-Process -Name Origin64,Origin -ErrorAction SilentlyContinue|ForEach-Object Id)
try{
    $owned=New-Object -ComObject Origin.Application
    $new=@(Get-Process -Name Origin64,Origin -ErrorAction SilentlyContinue|Where-Object Id -notin $previous)
    if($new.Count -ne 1){throw 'Cannot prove isolated QA Origin process ownership; no data changed.'}
    $owned.Visible=0
    $result=Write-OriginCdl $owned $packet
    $book=$owned.WorksheetPages($result.bookName)
    if($book.Layers.Count -ne $packet.sheets.Count){throw 'Origin Cdl worksheet count mismatch.'}
    $sheet=$owned.FindWorksheet('['+$result.bookName+']CV1');$column=$sheet.Columns.Item(1);$current=$column.GetData(1,0,4,0)
    if([Math]::Abs($current[1]+.38) -gt 1e-12 -or [Math]::Abs($current[3]+.62) -gt 1e-12){throw 'Origin lost signed selected-loop CV values.'}
    Release-Com $column;$column=$null;Release-Com $sheet;$sheet=$null
    $sheet=$owned.FindWorksheet('['+$result.bookName+']ElectrodeFits');$column=$sheet.Columns.Item(3);$cdl=$column.GetData(1,0,1,0)
    if([Math]::Abs($cdl[0]-12) -gt 1e-9 -or [Math]::Abs($cdl[1]-18) -gt 1e-9){throw 'Origin independent Cdl fit values mismatch.'}
    Release-Com $column;$column=$sheet.Columns.Item(5);$slopes=$column.GetData(1,0,1,0)
    Release-Com $column;$column=$sheet.Columns.Item(6);$intercepts=$column.GetData(1,0,1,0)
    if([Math]::Abs($slopes[0]-12) -gt 1e-9 -or [Math]::Abs($slopes[1]-18) -gt 1e-9 -or [Math]::Abs($intercepts[0]) -gt 1e-9 -or [Math]::Abs($intercepts[1]) -gt 1e-9){throw 'Origin slope or intercept mismatch.'}
    $cv=$owned.GraphPages($result.cvGraphName);$cvLayer=$cv.Layers.Item(0)
    $fit=$owned.GraphPages($result.fitGraphName);$fitLayer=$fit.Layers.Item(0)
    $fitCount=if($Reference){6}else{4}
    if($cvLayer.DataPlots.Count -ne 14 -or $fitLayer.DataPlots.Count -ne $fitCount){throw 'Origin editable Cdl/CV curve count mismatch.'}
    $referenceValue=$null
    if($Reference){
        Release-Com $column;$column=$null;Release-Com $sheet;$sheet=$null
        $sheet=$owned.FindWorksheet('['+$result.bookName+']ReferenceFits');$column=$sheet.Columns.Item(2);$referenceValue=$column.GetData(1,0,0,0)
        if([Math]::Abs([double]$referenceValue[0]-99) -gt 1e-9){throw 'Origin reference meanCurve fit was lost.'}
        if($packet.electrodeCount -ne 2){throw 'Reference meanCurve incorrectly counted as independent electrode.'}
    }
    $proofPrefix=if($Reference){'cdl-reference'}else{'cdl'}
    if(!$owned.Save((Join-Path $FixtureDirectory ($proofPrefix+'-origin-proof.opju')))){throw 'Could not save isolated Cdl QA Origin project.'}
    $output=$FixtureDirectory.Replace('\','/')
    [void]$cv.Activate();Invoke-LabTalk $owned ('expGraph type:=png path:="'+$output+'" filename:="'+$proofPrefix+'-cv-proof" overwrite:=replace;')
    [void]$fit.Activate();Invoke-LabTalk $owned ('expGraph type:=png path:="'+$output+'" filename:="'+$proofPrefix+'-fit-proof" overwrite:=replace;')
    $proof=[ordered]@{ownedOriginId=$new[0].Id;existingOriginIds=$previous;bookName=$result.bookName;cvGraphName=$result.cvGraphName;fitGraphName=$result.fitGraphName;sheets=$book.Layers.Count;cvCurves=$cvLayer.DataPlots.Count;fitCurves=$fitLayer.DataPlots.Count;cdl=@($cdl);slopes=@($slopes);intercepts=@($intercepts);selectedCV=@($current);allWorksheetCellsReadBack=$true;allPlotXYSourceColumnUIDsReadBack=$true;xTitleRaw=$owned.LTStr('xb.text$');yTitleRaw=$owned.LTStr('yl.text$');legendRaw=$owned.LTStr('legend.text$');legendFontSize=$owned.LTVar('legend.fsize')}
    $proof['referenceCdl']=$referenceValue;$proof['originVisibleDuringQA']=0
    [IO.File]::WriteAllText((Join-Path $FixtureDirectory $(if($Reference){'reference-proof.json'}else{'proof.json'})),($proof|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
    Write-Output ($proof|ConvertTo-Json -Depth 8)
}finally{
    Release-Com $fitLayer;Release-Com $cvLayer;Release-Com $fit;Release-Com $cv;Release-Com $column;Release-Com $sheet;Release-Com $book
    # Only close the independently created test instance, never a pre-existing window.
    if($owned -and $new.Count -eq 1){try{[void]$owned.Save((Join-Path $FixtureDirectory 'cdl-origin-proof.opju'));[void]$owned.Exit()}catch{}}
    Release-Com $owned
}
