param([string]$PayloadPath,[string]$RequestId,[string]$OperationId,[string]$StatusPath,[switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$OriginMissing = -1.23456789e-300
$Invariant = [Globalization.CultureInfo]::InvariantCulture

function Assert-Exact($Value,[string[]]$Keys) {
    if ($null -eq $Value -or $Value -is [Array]) { throw '数据结构无效。' }
    $actual = @($Value.PSObject.Properties.Name)
    if ($actual.Count -ne $Keys.Count) { throw '数据字段无效。' }
    foreach ($key in $Keys) { if ($key -cnotin $actual) { throw '数据字段缺失。' } }
}
function Test-Number($Value) {
    if ($null -eq $Value -or $Value -is [string] -or $Value -is [bool]) { return $false }
    if ($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]) { return $false }
    return ![double]::IsNaN([double]$Value) -and ![double]::IsInfinity([double]$Value) -and [Math]::Abs([double]$Value) -le 1e12
}
function Assert-Text($Value,[int]$Maximum) {
    if ($Value -isnot [string] -or $Value.Length -gt $Maximum -or $Value.Contains([string][char]0)) { throw '文本字段无效。' }
}
function Assert-Id([string]$Value) {
    if ($Value -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw '请求标识无效。' }
}
function Assert-OverpotentialPayload($Packet,[string]$ExpectedId) {
    Assert-Exact $Packet @('schema','requestId','createdAt','scan','demo','target','axes','samples')
    Assert-Id $Packet.requestId
    if ($Packet.schema -cne 'overpotential-origin/v1' -or $Packet.requestId -cne $ExpectedId) { throw '过电位数据包类型或请求标识无效。' }
    Assert-Text $Packet.createdAt 64
    $parsed = [DateTime]::MinValue
    if (![DateTime]::TryParse($Packet.createdAt,$Invariant,[Globalization.DateTimeStyles]::RoundtripKind,[ref]$parsed) -or $Packet.scan -cnotin @('all','up','down') -or $Packet.demo -isnot [bool]) { throw '过电位导出信息无效。' }
    Assert-Exact $Packet.target @('current','equilibriumVoltage','unit')
    if (!(Test-Number $Packet.target.current) -or !(Test-Number $Packet.target.equilibriumVoltage) -or $Packet.target.current -ne 10 -or $Packet.target.equilibriumVoltage -ne 1.23 -or $Packet.target.unit -cne 'mV') { throw '过电位目标参数无效。' }
    Assert-Exact $Packet.axes @('x','y')
    foreach ($axis in @($Packet.axes.x,$Packet.axes.y)) {
        Assert-Exact $axis @('min','max','major','minorCount','majorTicks','minorTicks')
        if (!(Test-Number $axis.min) -or !(Test-Number $axis.max) -or $axis.min -ge $axis.max -or !(Test-Number $axis.major) -or $axis.major -le 0 -or !(Test-Number $axis.minorCount) -or $axis.minorCount -ne [Math]::Floor($axis.minorCount) -or $axis.minorCount -lt 0 -or $axis.minorCount -gt 10) { throw '过电位坐标轴范围或刻度无效。' }
        foreach ($key in @('majorTicks','minorTicks')) {
            $ticks = $axis.$key
            $maximum = 1000
            if ($ticks -isnot [Array] -or $ticks.Count -gt $maximum) { throw '过电位刻度数量无效。' }
            for ($i=0;$i -lt $ticks.Count;$i++) {
                if (!(Test-Number $ticks[$i]) -or $ticks[$i] -lt $axis.min - 1e-8 -or $ticks[$i] -gt $axis.max + 1e-8 -or ($i -gt 0 -and $ticks[$i] -le $ticks[$i-1])) { throw '过电位刻度位置无效。' }
            }
        }
        if ($axis.majorTicks.Count + $axis.minorTicks.Count -gt 1000) { throw '过电位刻度总数过多。' }
    }
    if ($Packet.samples -isnot [Array] -or $Packet.samples.Count -lt 1 -or $Packet.samples.Count -gt 10) { throw '每次需导出 1–10 个样品。' }
    $sampleKeys = @('id','order','name','color','source','eta10MV','xAt10','eAt10','status','note','candidate','demo','visible','irVoltage','unit','area','compensation')
    for ($i=0;$i -lt $Packet.samples.Count;$i++) {
        $sample=$Packet.samples[$i]
        Assert-Exact $sample $sampleKeys
        Assert-Text $sample.id 256; Assert-Text $sample.name 1024; Assert-Text $sample.source 8192
        Assert-Text $sample.status 128; Assert-Text $sample.note 16384; Assert-Text $sample.unit 64; Assert-Text $sample.area 256
        if (!$sample.id -or !$sample.name -or !(Test-Number $sample.order) -or $sample.order -ne $i+1 -or $sample.color -notmatch '^#[0-9a-fA-F]{6}$' -or $sample.compensation -cnotin @('raw','corrected','unknown')) { throw '过电位样品信息无效。' }
        foreach ($key in @('eta10MV','xAt10','eAt10','irVoltage')) { if ($null -ne $sample.$key -and !(Test-Number $sample.$key)) { throw '过电位样品数值无效。' } }
        foreach ($key in @('candidate','demo','visible')) { if ($sample.$key -isnot [bool]) { throw '过电位样品状态无效。' } }
        if (($null -eq $sample.eta10MV) -ne ($null -eq $sample.xAt10) -or ($null -eq $sample.eta10MV) -ne ($null -eq $sample.eAt10)) { throw '过电位样品缺失值不一致。' }
        if ($null -ne $sample.eta10MV -and [Math]::Abs($sample.eta10MV-($sample.xAt10-1.23)*1000) -gt 1e-7*[Math]::Max(1,[Math]::Abs($sample.eta10MV))) { throw '过电位读数与 LSV 交点不一致。' }
    }
}
function Release-Com($Value) { if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) } }
function LabTalk-Number($Value) { return ([double]$Value).ToString('G17',$Invariant) }
function Invoke-LabTalk($Origin,[string]$Command) { if (!$Origin.Execute($Command)) { throw ('Origin 执行失败：'+$Command) } }
function Assert-LabTalkNumber($Origin,[string]$Property,$Expected) {
    $received=[double]$Origin.LTVar($Property)
    if ([Math]::Abs($received-[double]$Expected) -gt 1e-8*[Math]::Max(1,[Math]::Abs([double]$Expected))) { throw ('Origin 坐标轴读回不一致：'+$Property+' expected='+$Expected+' actual='+$received) }
}
function Assert-LabTalkTicks($Origin,[string]$Property,$Expected) {
    $text=[string]$Origin.LTStr($Property)
    $actual=@($text.Trim() -split '\s+' | Where-Object { $_ -ne '' })
    if ($actual.Count -ne $Expected.Count) { throw ('Origin 刻度数量读回不一致：'+$Property) }
    for ($i=0;$i -lt $actual.Count;$i++) {
        $value=[double]::Parse($actual[$i],[Globalization.NumberStyles]::Float,$Invariant)
        if ([Math]::Abs($value-[double]$Expected[$i]) -gt 1e-8*[Math]::Max(1,[Math]::Abs([double]$Expected[$i]))) { throw ('Origin 刻度位置读回不一致：'+$Property) }
    }
}
function Write-OriginOverpotential($Origin,$Packet) {
    $book=$null;$sheet=$null;$column=$null;$graph=$null;$graphLayer=$null;$tickSheet=$null
    try {
        $bookName=[string]$Origin.CreatePage(2,('Eta'+$Packet.requestId.Replace('-','').Substring(0,12)),'origin',2)
        if ($bookName -notmatch '^[A-Za-z][A-Za-z0-9]*$') { throw 'Origin 未能创建安全命名的新工作簿。' }
        $book=$Origin.WorksheetPages($bookName)
        $book.LongName='Scientific Plot Studio Overpotential - '+$Packet.createdAt
        $sheet=$book.Layers.Item(0);$sheet.Name='Overpotential';$sheet.LongName='过电位样品读数'
        $sheet.Cols=18;$sheet.Rows=$Packet.samples.Count
        $definitions=@(
            @('Order','','order',0,3),@('η10 (applied IR)','mV','eta10MV',0,0),@('Sample','','name',1,4),
            @('X at Y=10 (applied IR)','V','xAt10',0,1),@('Original E at Y=10','V','eAt10',0,1),@('RGB','','rgb',0,1),
            @('Status','','status',1,1),@('Candidate','','candidate',0,1),@('Source','','source',1,1),
            @('Reading note','','note',1,1),@('Demo','','demo',0,1),@('LSV visible','','visible',0,1),
            @('Applied IR','V','irVoltage',0,1),@('Original current unit','','unit',1,1),@('Area label','','area',1,1),
            @('Compensation state','','compensation',1,1),@('Sample ID','','id',1,1),@('Color hex','','color',1,1)
        )
        for ($c=0;$c -lt $definitions.Count;$c++) {
            $definition=$definitions[$c];$key=[string]$definition[2]
            $column=$sheet.Columns.Item($c);$column.DataFormat=[int]$definition[3];$column.Type=[int]$definition[4]
            $column.LongName=[string]$definition[0];$column.Units=[string]$definition[1]
            $column.Comments='Y=10; eta=(X-1.23)*1000 mV; X includes applied LSV software IR; no repeated IR correction; original instrument compensation state recorded; scan='+$Packet.scan+'; order and missing values preserved; '+$Packet.createdAt
            if ($c -eq 0) { $column.Comments=[string]$column.Comments+'; axes='+($Packet.axes|ConvertTo-Json -Depth 6 -Compress) }
            $values=if ([int]$definition[3] -eq 1) { [Array]::CreateInstance([string],$Packet.samples.Count) } else { [Array]::CreateInstance([double],$Packet.samples.Count) }
            for ($r=0;$r -lt $Packet.samples.Count;$r++) {
                $sample=$Packet.samples[$r];$value=$sample.$key
                if ($key -ceq 'rgb') {
                    $red=[Convert]::ToInt32($sample.color.Substring(1,2),16);$green=[Convert]::ToInt32($sample.color.Substring(3,2),16);$blue=[Convert]::ToInt32($sample.color.Substring(5,2),16)
                    $value=$red+256*$green+65536*$blue
                }
                if ([int]$definition[3] -eq 1) { $values.SetValue([string]$value,$r) }
                else { $values.SetValue($(if ($null -eq $value) { $OriginMissing } elseif ($value -is [bool]) { [double][int]$value } else { [double]$value }),$r) }
            }
            if (!$column.SetData($values,0)) { throw ('Origin 拒绝写入第 '+($c+1)+' 列。') }
            $format=if ([int]$definition[3] -eq 1) { 6 } else { 1 }
            $received=$column.GetData($format,0,($Packet.samples.Count-1),0)
            if ($received -isnot [Array] -or $received.Count -ne $values.Count) { throw 'Origin 工作表读回行数不一致。' }
            for ($r=0;$r -lt $values.Count;$r++) { if ($received.GetValue($r) -cne $values.GetValue($r)) { throw ('Origin 工作表第 '+($r+1)+' 行第 '+($c+1)+' 列读回不一致。') } }
            if ([int]$column.Type -ne [int]$definition[4] -or [string]$column.LongName -cne [string]$definition[0] -or [string]$column.Units -cne [string]$definition[1]) { throw 'Origin 工作表列属性读回不一致。' }
            Release-Com $column;$column=$null
        }
        [void]$book.Activate()
        # Origin's Text from Dataset uses sequential custom-tick indices.
        # Store mapped labels separately so a step of 2 names samples 1,3,5...
        # while the summary keeps every original sample name in column C.
        Invoke-LabTalk $Origin 'newsheet name:=AxisTicks;'
        $tickSheet=$Origin.FindWorksheet('['+$bookName+']AxisTicks')
        $tickSheet.Cols=2;$tickSheet.Rows=[Math]::Max(1,$Packet.axes.x.majorTicks.Count)
        $positions=[Array]::CreateInstance([double],$Packet.axes.x.majorTicks.Count)
        $labels=[Array]::CreateInstance([string],$Packet.axes.x.majorTicks.Count)
        for ($i=0;$i -lt $Packet.axes.x.majorTicks.Count;$i++) {
            $position=$Packet.axes.x.majorTicks[$i];$positions.SetValue([double]$position,$i)
            $label=if ($position -ge 1 -and $position -le $Packet.samples.Count -and $position -eq [Math]::Round($position)) { [string]$Packet.samples[[int]$position-1].name } else { '' }
            $labels.SetValue($label,$i)
        }
        for ($c=0;$c -lt 2;$c++) {
            $column=$tickSheet.Columns.Item($c);$column.DataFormat=$c;$column.Type=1
            $column.LongName=if ($c -eq 0) { 'X major tick position' } else { 'Sample at X major tick' }
            $column.Comments='Mapped by original LSV sample order; complete names remain in Overpotential column C.'
            $values=if ($c -eq 0) { $positions } else { $labels }
            if ($values.Count) {
                if (!$column.SetData($values,0)) { throw 'Origin 轴标签写入失败。' }
                $received=$column.GetData($(if ($c -eq 0) {1} else {6}),0,($values.Count-1),0)
                if ($received.Count -ne $values.Count) { throw 'Origin 轴标签读回数量不一致。' }
                for ($r=0;$r -lt $values.Count;$r++) { if ($received.GetValue($r) -cne $values.GetValue($r)) { throw 'Origin 轴标签对应样品读回不一致。' } }
            }
            Release-Com $column;$column=$null
        }
        $graphName='EtaGraph'+$Packet.requestId.Replace('-','').Substring(0,12)
        Invoke-LabTalk $Origin ('plotxy iy:=['+$bookName+']Overpotential!(1,2) plot:=203 legend:=0 ogl:=[<new template:=column name:='+$graphName+'>];')
        # A redraw barrier before styling prevents commands racing page creation.
        Invoke-LabTalk $Origin 'doc -uw;'
        $graph=$Origin.GraphPages($graphName);$graph.LongName='过电位 η10 / mV（按已应用 IR）';$graphLayer=$graph.Layers.Item(0)
        if ([int]$graphLayer.DataPlots.Count -ne 1) { throw 'Origin 柱状图数据绑定失败。' }
        $graphName=[string]$graph.Name
        Invoke-LabTalk $Origin ('range etaColors=['+$bookName+']Overpotential!col(6);range etaPlot=['+$graphName+']1!1;')
        Invoke-LabTalk $Origin 'set etaPlot -pfbr etaColors;'
        Invoke-LabTalk $Origin 'set etaPlot -pbcr etaColors;'
        Invoke-LabTalk $Origin 'get etaPlot -pt etaPlotType;'
        Assert-LabTalkNumber $Origin 'etaPlotType' 203
        Invoke-LabTalk $Origin 'get etaPlot -pfbo etaRGBMode;'
        Assert-LabTalkNumber $Origin 'etaRGBMode' 4
        Invoke-LabTalk $Origin 'get etaPlot -pfbr etaRGBSource$;'
        if ([string]$Origin.LTStr('etaRGBSource$') -cne ($bookName+'_F')) { throw 'Origin 柱状图颜色数据绑定读回不一致。' }
        foreach ($key in @('x','y')) {
            $axis=$Packet.axes.$key
            $major=(@($axis.majorTicks | ForEach-Object { LabTalk-Number $_ }) -join ' ')
            $minor=(@($axis.minorTicks | ForEach-Object { LabTalk-Number $_ }) -join ' ')
            $marks=$(if ($major) { 2 } else { 0 })+$(if ($minor) { 8 } else { 0 })
            $labels=if ($major) { 1 } else { 0 }
            Invoke-LabTalk $Origin ('layer.'+$key+'.from='+ (LabTalk-Number $axis.min)+';layer.'+$key+'.to='+(LabTalk-Number $axis.max)+';layer.'+$key+'.inc='+(LabTalk-Number $axis.major)+';layer.'+$key+'.minorTicks='+$axis.minorCount+';layer.'+$key+'.ticks='+$marks+';layer.'+$key+'.showLabels='+$labels+';')
            # Exact supplied positions preserve the canvas tick anchor, including
            # manually chosen axis limits that are not multiples of the step.
            if ($major) { Invoke-LabTalk $Origin ('layer.'+$key+'.ticksbydata$="'+$major+'";') }
            if ($minor) { Invoke-LabTalk $Origin ('layer.'+$key+'.mticksbydata$="'+$minor+'";') }
            if ($major) { Assert-LabTalkTicks $Origin ('layer.'+$key+'.ticksbydata$') $axis.majorTicks }
            if ($minor) { Assert-LabTalkTicks $Origin ('layer.'+$key+'.mticksbydata$') $axis.minorTicks }
            else { Assert-LabTalkNumber $Origin ('layer.'+$key+'.ticks') $marks }
            foreach ($property in @('from','to','inc')) {
                $expected=switch ($property) { 'from' {$axis.min} 'to' {$axis.max} 'inc' {$axis.major} 'minorTicks' {$axis.minorCount} }
                Assert-LabTalkNumber $Origin ('layer.'+$key+'.'+$property) $expected
            }
        }
        # Names travel through text data, never interpolated into LabTalk code.
        Invoke-LabTalk $Origin ('layer.x.label.type=2;layer.x.label.dataset$="['+$bookName+']AxisTicks!col(2)";layer.x.label.rotate=45;layer.x.label.offsetV=-25;layer.y.label.type=1;layer.x2.ticks=0;layer.y2.ticks=0;')
        Invoke-LabTalk $Origin 'layer.unit=1;layer.left=18;layer.top=8;layer.width=75;layer.height=65;layer.factor=0.7;'
        Invoke-LabTalk $Origin 'xb.text$="Sample";xb.fsize=20;yl.text$="\g(h)\-(10) (mV)";yl.fsize=20;legend.show=0;doc -uw;'
        Assert-LabTalkNumber $Origin 'layer.x.label.type' 2
        Assert-LabTalkNumber $Origin 'layer.y.label.type' 1
        $labelSource=[string]$Origin.LTStr('layer.x.label.dataset$')
        if (!$labelSource.StartsWith('['+$bookName+']AxisTicks!B')) { throw 'Origin 样品轴标签数据绑定读回不一致。' }
        [void]$graph.Activate()
        return [ordered]@{bookName=$bookName;graphName=$graphName;sampleCount=$Packet.samples.Count;columns=18}
    } finally { Release-Com $graphLayer;Release-Com $graph;Release-Com $column;Release-Com $tickSheet;Release-Com $sheet;Release-Com $book }
}
function Write-Status([string]$Stage,[string]$Message,[bool]$Failed=$false,$Result=$null) {
    $state=[ordered]@{schema='overpotential-origin-status/v1';requestId=$RequestId;operationId=$OperationId;stage=$Stage;done=($Stage -eq 'complete' -or $Failed);failed=$Failed;message=$Message}
    if ($Result) { $state.bookName=$Result.bookName;$state.graphName=$Result.graphName;$state.sampleCount=$Result.sampleCount }
    $temporary=$StatusPath+'.tmp'
    [IO.File]::WriteAllText($temporary,($state|ConvertTo-Json -Depth 10 -Compress),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $StatusPath -Force
}

if ($ValidateOnly) { return }
$origin=$null
$safeStatus=$false
try {
    Assert-Id $RequestId;Assert-Id $OperationId
    $work=[Environment]::GetEnvironmentVariable('PLOT_DESKTOP_WORK_DIRECTORY')
    if (!$work -or ![IO.Path]::IsPathRooted($work)) { throw '本机操作目录无效。' }
    $expectedPayload=Join-Path (Join-Path $work 'OverpotentialTransfers') ('overpotential-origin-'+$RequestId+'.json')
    $expectedStatus=Join-Path (Join-Path $work 'Logs') ('overpotential-'+$OperationId+'.status.json')
    if (![IO.Path]::IsPathRooted($PayloadPath) -or [IO.Path]::GetFullPath($PayloadPath) -ine [IO.Path]::GetFullPath($expectedPayload) -or ![IO.Path]::IsPathRooted($StatusPath) -or [IO.Path]::GetFullPath($StatusPath) -ine [IO.Path]::GetFullPath($expectedStatus)) { throw '本机交接文件路径无效。' }
    $safeStatus=$true
    $file=Get-Item -LiteralPath $PayloadPath
    if ($file.PSIsContainer -or $file.Length -gt 1MB) { throw '过电位数据包大小无效。' }
    $packet=[IO.File]::ReadAllText($PayloadPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
    Assert-OverpotentialPayload $packet $RequestId
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($StatusPath))
    Write-Status 'opening' '正在打开一个新的 Origin 窗口。'
    # Application creates an independent instance. Never connect ApplicationSI,
    # load/reset a project, or close an existing user window.
    $origin=New-Object -ComObject Origin.Application
    $origin.Visible=1
    Write-Status 'writing' '正在写入样品数据并绘制柱状图。'
    $result=Write-OriginOverpotential $origin $packet
    $origin.Visible=100
    Write-Status 'complete' '过电位样品数据、柱状图和坐标轴已核对。' $false $result
} catch {
    $message=$_.Exception.Message
    try { if ($safeStatus -and [IO.Directory]::Exists([IO.Path]::GetDirectoryName($StatusPath))) { Write-Status 'failed' $message $true } } catch {}
    [Console]::Error.WriteLine($message)
    exit 1
} finally { Release-Com $origin }
