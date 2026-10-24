param([Parameter(Mandatory=$true)][string]$FixtureDirectory,[switch]$ExerciseOrigin,[switch]$Cropped)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../desktop/native/Import-OverpotentialOrigin.ps1') -ValidateOnly
$packet=[IO.File]::ReadAllText((Join-Path $FixtureDirectory 'fixture.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
$invalid=[IO.File]::ReadAllText((Join-Path $FixtureDirectory 'rejects.json'),[Text.Encoding]::UTF8)|ConvertFrom-Json
Assert-OverpotentialPayload $packet '11111111-2222-3333-4444-555555555555'
foreach ($altered in $invalid) {
    $rejected=$false
    try { Assert-OverpotentialPayload $altered '11111111-2222-3333-4444-555555555555' } catch { $rejected=$true }
    if (!$rejected) { throw 'Native importer accepted malformed packet.' }
}
Write-Output 'PASS: native PowerShell rejects malformed requests, strings in numeric fields, inconsistent gaps, reordered ticks, invalid colors and extra fields.'
if (!$ExerciseOrigin) { return }
if ($Cropped) {
    $packet.requestId='22222222-2222-3333-4444-555555555555'
    $packet.axes.x.min=2.5;$packet.axes.x.max=8.5
    $packet.axes.x.majorTicks=@(3,5,7)
    $packet.axes.x.minorTicks=@(2.5,3.5,4,4.5,5.5,6,6.5,7.5,8,8.5)
    Assert-OverpotentialPayload $packet $packet.requestId
}
$owned=$null;$book=$null;$sheet=$null;$column=$null;$graph=$null;$layer=$null;$plot=$null
$previous=@(Get-Process -Name Origin64,Origin -ErrorAction SilentlyContinue | ForEach-Object Id)
try {
    $owned=New-Object -ComObject Origin.Application
    $new=@(Get-Process -Name Origin64,Origin -ErrorAction SilentlyContinue | Where-Object Id -notin $previous)
    if ($new.Count -ne 1) { throw 'Cannot prove isolated QA Origin process ownership; no data changed.' }
    $owned.Visible=0
    $result=Write-OriginOverpotential $owned $packet
    $book=$owned.WorksheetPages($result.bookName);$sheet=$book.Layers.Item(0)
    if ($sheet.Cols -ne 18) { throw 'Origin summary column count mismatch.' }
    $column=$sheet.Columns.Item(1);$values=$column.GetData(1,0,9,0)
    if ($values[0] -ge 0 -or $values[4] -ne $OriginMissing) { throw 'Signed or missing eta lost in Origin.' }
    Release-Com $column;$column=$null
    $column=$sheet.Columns.Item(2);$names=$column.GetData(6,0,9,0)
    if ([string]$names[3] -cne $packet.samples[3].name) { throw 'Origin sample name text changed.' }
    Release-Com $column;$column=$null
    $graph=$owned.GraphPages($result.graphName);$layer=$graph.Layers.Item(0);$plot=$layer.DataPlots.Item(0)
    if ([int]$owned.LTVar('etaPlotType') -ne 203) { throw 'Origin graph is not an editable column plot.' }
    $rgbGetter=$owned.Execute('get etaPlot -pfbr etaRGBSource$;')
    $tickSheet=$owned.FindWorksheet('['+$result.bookName+']AxisTicks')
    $column=$tickSheet.Columns.Item(1);$tickNames=$column.GetData(6,0,($packet.axes.x.majorTicks.Count-1),0)
    for ($i=0;$i -lt $tickNames.Count;$i++) { if ([string]$tickNames[$i] -cne [string]$packet.samples[[int]$packet.axes.x.majorTicks[$i]-1].name) { throw 'Custom X tick names mapped to wrong sample rows.' } }
    Release-Com $column;$column=$null;Release-Com $tickSheet;$tickSheet=$null
    $proofName=if ($Cropped) {'overpotential-origin-cropped-proof'} else {'overpotential-origin-proof'}
    $opju=Join-Path $FixtureDirectory ($proofName+'.opju')
    if (!$owned.Save($opju)) { throw 'Could not save isolated QA Origin project.' }
    $output=$FixtureDirectory.Replace('\','/')
    Invoke-LabTalk $owned ('expGraph type:=png path:="'+$output+'" filename:="'+$proofName+'" overwrite:=replace;')
    $proof=[ordered]@{ownedOriginId=$new[0].Id;existingOriginIds=$previous;bookName=$result.bookName;graphName=$result.graphName;sampleCount=10;columns=18;plotType=[int]$owned.LTVar('etaPlotType');signedEta=$values[0];missingEta=$values[4];sampleLabels=@($names);xMin=$owned.LTVar('layer.x.from');xMax=$owned.LTVar('layer.x.to');xStep=$owned.LTVar('layer.x.inc');xMinor=$owned.LTVar('layer.x.minorTicks');yMin=$owned.LTVar('layer.y.from');yMax=$owned.LTVar('layer.y.to');yStep=$owned.LTVar('layer.y.inc');yMinor=$owned.LTVar('layer.y.minorTicks');rgbMode=$owned.LTVar('etaRGBMode');rgbGetter=[bool]$rgbGetter;rgbSource=$owned.LTStr('etaRGBSource$');xTickNames=@($tickNames);xLabelDataset=$owned.LTStr('layer.x.label.dataset$');xLabelType=$owned.LTVar('layer.x.label.type');xMajorPositions=$owned.LTStr('layer.x.ticksbydata$');xMinorPositions=$owned.LTStr('layer.x.mticksbydata$');yMajorPositions=$owned.LTStr('layer.y.ticksbydata$');yMinorPositions=$owned.LTStr('layer.y.mticksbydata$')}
    [IO.File]::WriteAllText((Join-Path $FixtureDirectory $(if ($Cropped) {'cropped-proof.json'} else {'proof.json'})),($proof|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
    Write-Output ($proof|ConvertTo-Json -Depth 8)
    # Close only the Application instance created above and saved in the QA folder.
    [void]$owned.Exit()
    $owned=$null
} catch {
    if ($owned) {
        Write-Output ('DEBUG xminor='+$owned.LTVar('layer.x.minorTicks')+' xmajor='+$owned.LTStr('layer.x.ticksbydata$')+' xminorticks='+$owned.LTStr('layer.x.mticksbydata$'))
    }
    throw
} finally {
    Release-Com $plot;Release-Com $layer;Release-Com $graph;Release-Com $column;Release-Com $sheet;Release-Com $book
    if ($owned -and $new.Count -eq 1) { try { [void]$owned.Save((Join-Path $FixtureDirectory 'failed-proof.opju')); [void]$owned.Exit() } catch {} }
    Release-Com $owned
}
