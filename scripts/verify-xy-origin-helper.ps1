param([Parameter(Mandatory = $true)][string]$FixtureDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$OriginMissing = [double](-1.23456789e-300)
$importer = Join-Path $PSScriptRoot '..\public\origin-helper\Import-LsvOrigin.ps1'
$parseTokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($importer), [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
# Load definitions only. Never execute the script's launching/installing body.
$definitions = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)
foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) }
function Check([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Reject($Payload, [string]$Message) {
    $rejected = $false
    try { Validate-Payload $Payload '11111111-2222-4333-8444-555555555555' } catch { $rejected = $true }
    Check $rejected $Message
}
$xrd = Read-Payload (Join-Path $FixtureDirectory 'xrd.lsvdata')
$eis = Read-Payload (Join-Path $FixtureDirectory 'eis.lsvdata')
$eisCompact = Read-Payload (Join-Path $FixtureDirectory 'eis-origin.lsvdata')
Validate-Payload $xrd '11111111-2222-4333-8444-555555555555'
Validate-Payload $eis '11111111-2222-4333-8444-555555555555'
Validate-Payload $eisCompact '11111111-2222-4333-8444-555555555555'
Check (Test-CompactEisPayload $eisCompact) 'Compact EIS layout was not recognized.'
Check (!(Test-CompactEisPayload $eis)) 'Legacy EIS was treated as compact.'
Check (!(Test-CompactEisPayload $xrd)) 'XRD was treated as compact EIS.'
$xp = Get-OriginColumnPlan $xrd $xrd.samples[1]
Check (($xp.Types -join ',') -ceq '3,0,3,0') 'XRD X/Y designation mismatch.'
Check (($xp.Units -join ',') -ceq 'deg,a.u.,deg,a.u.') 'XRD units mismatch.'
Check ($xp.Comments.Contains('网页可见: False') -and $xp.Comments.Contains('measured-b.txt') -and $xp.Comments.Contains('"normalize":true')) 'XRD source/visibility/settings absent.'
$ep = Get-OriginColumnPlan $eis $eis.samples[1]
Check (($ep.Types -join ',') -ceq '3,0,0,0,1,3,0') 'EIS X/Y/frequency designation mismatch.'
Check (($ep.Units -join ',') -ceq 'ohm,ohm,ohm,ohm,Hz,ohm,ohm') 'EIS units mismatch.'
Check ($ep.Comments.Contains('negative') -and !$ep.Comments.Contains('eta10') -and !$ep.Comments.Contains('IR:')) 'EIS metadata must retain sign convention without LSV semantics.'
Check ($eis.samples[1].rows[0][4] -eq .0123456789012345) 'Frequency precision was lost.'
$ecp = Get-OriginColumnPlan $eisCompact $eisCompact.samples[1]
Check (($ecp.Types -join ',') -ceq '3,0,3,0') 'Compact EIS X/Y designation mismatch.'
Check (($ecp.Units -join ',') -ceq 'ohm,ohm,ohm,ohm') 'Compact EIS units mismatch.'
Check ($ecp.Comments.Contains('negative') -and $ecp.Comments.Contains('网页可见: False')) 'Compact EIS sign/visibility metadata absent.'
for ($s = 0; $s -lt $eis.samples.Count; $s++) {
    Check ($eisCompact.samples[$s].rows.Count -eq $eis.samples[$s].rows.Count) 'Compact EIS lost original rows.'
    for ($r = 0; $r -lt $eis.samples[$s].rows.Count; $r++) {
        $original = $eis.samples[$s].rows[$r]
        $compact = $eisCompact.samples[$s].rows[$r]
        for ($c = 0; $c -lt 4; $c++) {
            $oldIndex = @(0,1,5,6)[$c]
            Check ($compact[$c] -eq $original[$oldIndex]) 'Compact EIS changed raw/plot values, sign, precision, gaps or row order.'
        }
    }
}
$invalid = $eis | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.samples[1].rows[1][3] = 2
Reject $invalid 'Incorrect EIS negative sign must be rejected.'
$invalid = $eisCompact | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.columns[2].key = 'frequency'
Reject $invalid 'Incorrect compact EIS keys must be rejected.'
$invalid = $eisCompact | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.columns[2].role = 'y'
Reject $invalid 'Incorrect compact EIS X/Y designation must be rejected.'
$invalid = $eisCompact | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.columns[1].unit = 'Hz'
Reject $invalid 'Incorrect compact EIS units must be rejected.'
$invalid = $eisCompact | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.samples[1].rows[1][2] = 7
Reject $invalid 'Partial compact EIS XY gap must be rejected.'
$invalid = $eisCompact | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.samples[0].rows[0][0] = '1'
Reject $invalid 'String compact EIS data must be rejected.'
$invalid = $eisCompact | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.samples[0].rows[0] = @(1,-3,1)
Reject $invalid 'Incorrect compact EIS row width must be rejected.'
$invalid = $eisCompact | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.requestId = 'wrong'
Reject $invalid 'Mismatched compact EIS request ID must be rejected.'
$invalid = $xrd | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.columns[2].role = 'y'
Reject $invalid 'Incorrect X/Y designation must be rejected.'
$invalid = $xrd | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.samples[0].rows[1][2] = 10
Reject $invalid 'Partial XY gap must be rejected.'
$invalid = $xrd | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.samples[0].rows[0][0] = '10'
Reject $invalid 'String data must be rejected.'
$invalid = $xrd | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$invalid.requestId = 'wrong'
Reject $invalid 'Mismatched request ID must be rejected.'
$legacy = [pscustomobject]@{ schema='lsv-origin/v1'; requestId=$xrd.requestId; createdAt=$xrd.createdAt;
    formulas=[pscustomobject]@{x='第一列 - iR * B1 + 0.059 * 13.65 + 0.197'; y='第二列 * 1000'}; scan='all';
    samples=@([pscustomobject]@{name='LSV regression'; source='legacy.txt'; unit='A';area='1';ir=0;compensation='raw';visible=$true;demo=$false;rows=@(@(.2,.001,1.2,1),@(.3,.002,1.3,2));eta10MV=$null;note='legacy notes'}) }
Validate-Payload $legacy $xrd.requestId
$lp = Get-OriginColumnPlan $legacy $legacy.samples[0]
Check (($lp.Types -join ',') -ceq '3,0,3,0') 'Legacy LSV designation changed.'
Check ($lp.Units[-1] -ceq 'mA cm^-2') 'Legacy LSV unit changed.'
Check ($lp.Comments.Contains('IR: 0') -and $lp.Comments.Contains('eta10(mV):')) 'Legacy LSV metadata changed.'

# Execute the actual importer worksheet-writing body against an in-memory
# implementation of the COM surface. This checks offsets/matrices/roles and
# readback, without creating an Origin process or changing any existing project.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public sealed class XyExportTestColumn {
    private int format;
    public int DataFormat { get { return format; } set { format=value; Values=new double[0]; } }
    public int Type { get; set; }
    public string LongName { get; set; }
    public string Units { get; set; }
    public string Comments { get; set; }
    public double[] Values=new double[0];
    public double[] GetData(int mode, int first, int last, int flags) {
        if(mode!=1 || first!=0 || flags!=0 || last>=Values.Length) throw new Exception("Incorrect numeric readback range.");
        double[] result=new double[last-first+1]; Array.Copy(Values,first,result,0,result.Length); return result;
    }
}
public sealed class XyExportTestColumns {
    public XyExportTestColumn[] Items=new XyExportTestColumn[100];
    public XyExportTestColumns() { for(int i=0;i<Items.Length;i++) Items[i]=new XyExportTestColumn(); }
    public XyExportTestColumn Item(int index) { return Items[index]; }
}
public sealed class XyExportTestSheet {
    public string Name { get; set; } public string LongName { get; set; }
    public int Cols { get; set; } public int Rows { get; set; }
    public XyExportTestColumns Columns=new XyExportTestColumns();
}
public sealed class XyExportTestLayers {
    public XyExportTestSheet Sheet=new XyExportTestSheet();
    public XyExportTestSheet Item(int index) { if(index!=0) throw new Exception("Incorrect worksheet layer."); return Sheet; }
}
public sealed class XyExportTestBook { public XyExportTestLayers Layers=new XyExportTestLayers(); }
public sealed class XyExportTestWrite {
    public string Target; public int StartColumn; public int Rows; public int Columns;
}
public sealed class XyExportTestOrigin {
    public XyExportTestSheet Sheet;
    public List<XyExportTestWrite> Writes=new List<XyExportTestWrite>();
    public XyExportTestOrigin(XyExportTestSheet sheet) { Sheet=sheet; }
    public bool PutWorksheet(string target, double[,] matrix, int rowStart, int columnStart) {
        if(rowStart!=0 || columnStart+matrix.GetLength(1)>Sheet.Cols) throw new Exception("Wrong worksheet data range.");
        Writes.Add(new XyExportTestWrite {Target=target,StartColumn=columnStart,Rows=matrix.GetLength(0),Columns=matrix.GetLength(1)});
        for(int c=0;c<matrix.GetLength(1);c++) {
            double[] values=new double[Sheet.Rows];
            for(int r=0;r<values.Length;r++) values[r]=-1.23456789e-300;
            for(int r=0;r<matrix.GetLength(0);r++) values[r]=matrix[r,c];
            Sheet.Columns.Item(columnStart+c).Values=values;
        }
        return true;
    }
}
'@
$importerText = [IO.File]::ReadAllText($importer)
$bodyStart = $importerText.IndexOf('    $sheet = $book.Layers.Item(0)', [StringComparison]::Ordinal)
$bodyEnd = $importerText.IndexOf('    [void]$book.Activate()', [StringComparison]::Ordinal)
Check ($bodyStart -gt 0 -and $bodyEnd -gt $bodyStart) 'Actual worksheet writing body was not found.'
$writeBody = [scriptblock]::Create($importerText.Substring($bodyStart, $bodyEnd - $bodyStart))
function Verify-ActualWrite($Payload, [int[]]$ExpectedStarts, [int[]]$ExpectedTypes) {
    function Write-ProgressState { param($Stage, $Message) }
    $kindName = if ($Payload.schema -ceq 'xy-origin/v1') { $Payload.kind.ToUpperInvariant() } else { 'LSV' }
    $dataColumns = if ($Payload.schema -ceq 'xy-origin/v1') { $Payload.columns.Count } else { 4 }
    $markerColumns = if (Test-CompactEisPayload $Payload) { 0 } else { 1 }
    $groupColumns = $dataColumns + $markerColumns
    $createdBookName = 'ExportTestBook'
    $requestId = $Payload.requestId
    $book = New-Object XyExportTestBook
    $origin = New-Object XyExportTestOrigin($book.Layers.Sheet)
    . $writeBody
    Check ($sheet.Cols -eq $groupColumns * $Payload.samples.Count) 'Actual worksheet column count is wrong.'
    Check ($sheet.Rows -eq ($Payload.samples | ForEach-Object {$_.rows.Count} | Measure-Object -Maximum).Maximum) 'Actual worksheet row count is wrong.'
    Check ($sheet.Name -ceq $kindName) 'Actual worksheet name is wrong.'
    Check ($origin.Writes.Count -eq $Payload.samples.Count) 'A sample was omitted from actual writes.'
    for ($s = 0; $s -lt $Payload.samples.Count; $s++) {
        $sample = $Payload.samples[$s]
        $write = $origin.Writes[$s]
        Check ($write.StartColumn -eq $ExpectedStarts[$s] -and $write.Columns -eq $dataColumns -and $write.Rows -eq $sample.rows.Count) 'Wrong actual matrix size or worksheet offset.'
        Check ($write.Target -ceq ('[ExportTestBook]' + $kindName)) 'Wrong actual worksheet target.'
        if ($markerColumns) {
            $marker = $sheet.Columns.Item($write.StartColumn - 1)
            Check ($marker.Values.Length -eq 0 -and $marker.Comments -ceq ('Sample' + ($s+1) + [char]0x2192)) 'Sample marker is not blank or is misplaced.'
        }
        for ($c = 0; $c -lt $dataColumns; $c++) {
            $actual = $sheet.Columns.Item($write.StartColumn + $c)
            Check ($actual.Type -eq $ExpectedTypes[$c]) 'Actual column designation differs from expected X/Y/data role.'
            Check ($actual.Comments.Contains($sample.source) -and $actual.Comments.Contains("网页可见: $($sample.visible)")) 'Actual columns lost source or visibility metadata.'
            for ($r = 0; $r -lt $sheet.Rows; $r++) {
                $expected = if ($r -ge $sample.rows.Count -or $null -eq $sample.rows[$r][$c]) { $OriginMissing } else { [double]$sample.rows[$r][$c] }
                Check ($actual.Values[$r] -eq $expected) 'Actual numeric write lost row order, precision, sign, frequency, gap or unequal-length padding.'
            }
        }
    }
}
Verify-ActualWrite $xrd @(1,6) @(3,0,3,0)
Verify-ActualWrite $eis @(1,9) @(3,0,0,0,1,3,0)
Verify-ActualWrite $eisCompact @(0,4) @(3,0,3,0)
Verify-ActualWrite $legacy @(1) @(3,0,3,0)
foreach ($file in @('Import-LsvOrigin.ps1','Start-LsvOrigin.ps1','Install-OriginHelper.ps1')) {
    [void][Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText((Join-Path $PSScriptRoot "..\public\origin-helper\$file")), [ref]$parseTokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
}
Write-Output 'PASS: PowerShell syntax, full/compact EIS validation and exact four-column/no-marker write/readback, XY schema/sign/gap/ID rejection, correct offsets/matrices/X/Y/frequency roles, hidden/unequal/gapped samples, XRD and legacy LSV. No Origin or installer was launched.'
