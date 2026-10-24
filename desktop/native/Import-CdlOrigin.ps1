param([string]$PayloadPath,[string]$RequestId,[string]$OperationId,[string]$StatusPath,[switch]$ValidateOnly)
$ErrorActionPreference='Stop'
$OriginMissing=-1.23456789e-300
$Invariant=[Globalization.CultureInfo]::InvariantCulture
function Assert-Exact($Value,[string[]]$Keys){
    if($null -eq $Value -or $Value -is [Array]){throw 'Cdl 数据结构无效。'}
    $actual=@($Value.PSObject.Properties.Name)
    if($actual.Count -ne $Keys.Count){throw 'Cdl 数据字段无效。'}
    foreach($key in $Keys){if($key -cnotin $actual){throw 'Cdl 数据字段缺失。'}}
}
function Test-Number($Value){
    if($null -eq $Value -or $Value -is [string] -or $Value -is [bool]){return $false}
    if($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]){return $false}
    return ![double]::IsNaN([double]$Value) -and ![double]::IsInfinity([double]$Value) -and [Math]::Abs([double]$Value) -le 1e12
}
function Assert-Text($Value,[int]$Maximum){if($Value -isnot [string] -or $Value.Length -gt $Maximum -or $Value.Contains([string][char]0)){throw 'Cdl 文本字段无效。'}}
function Assert-Id([string]$Value){if($Value -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'){throw '请求标识无效。'}}
function Assert-CdlPayload($Packet,[string]$ExpectedId){
    Assert-Exact $Packet @('schema','requestId','createdAt','label','settings','sheets','cvPlots','fitPlots','currentUnit','electrodeCount')
    Assert-Id $Packet.requestId
    if($Packet.schema -cne 'cdl-origin/v1' -or $Packet.requestId -cne $ExpectedId){throw 'Cdl 数据包类型或请求标识无效。'}
    Assert-Text $Packet.createdAt 64;Assert-Text $Packet.label 1024
    $parsed=[DateTime]::MinValue
    if(![DateTime]::TryParse($Packet.createdAt,$Invariant,[Globalization.DateTimeStyles]::RoundtripKind,[ref]$parsed) -or $Packet.currentUnit -cnotin @('mA','mA/cm2','mixed') -or !(Test-Number $Packet.electrodeCount) -or $Packet.electrodeCount -ne [Math]::Floor($Packet.electrodeCount) -or $Packet.electrodeCount -lt 0 -or $Packet.electrodeCount -gt 60){throw 'Cdl 导出信息无效。'}
    $settings=$Packet.settings
    if($null -eq $settings -or $settings -is [Array]){throw 'Cdl 计算设置无效。'}
    foreach($key in @($settings.PSObject.Properties.Name)){if($key -cnotin @('e0','currentUnit','normalizeArea','areaCM2','cycle','halfDelta','throughOrigin')){throw 'Cdl 计算设置字段无效。'}}
    if(!(Test-Number $settings.e0) -or $settings.currentUnit -cnotin @('A','mA','uA','nA','A/cm2','mA/cm2','uA/cm2')){throw 'Cdl 取点电位或单位无效。'}
    foreach($key in @('normalizeArea','halfDelta','throughOrigin')){if($settings.$key -isnot [bool]){throw 'Cdl 计算选项无效。'}}
    if($null -ne $settings.areaCM2 -and (!(Test-Number $settings.areaCM2) -or $settings.areaCM2 -le 0)){throw 'Cdl 面积无效。'}
    if($settings.cycle -cne 'last' -and (!(Test-Number $settings.cycle) -or $settings.cycle -ne [Math]::Floor($settings.cycle) -or $settings.cycle -lt 1)){throw 'Cdl 选圈无效。'}
    if($Packet.sheets -isnot [Array] -or $Packet.sheets.Count -lt 1 -or $Packet.sheets.Count -gt 70){throw 'Cdl 工作表数量无效。'}
    $names=@{};$cells=0
    foreach($sheet in $Packet.sheets){
        Assert-Exact $sheet @('name','label','columns');Assert-Text $sheet.label 1024
        if($sheet.name -cnotmatch '^[A-Za-z][A-Za-z0-9]{0,30}$' -or $names.ContainsKey($sheet.name) -or $sheet.columns -isnot [Array] -or $sheet.columns.Count -lt 1 -or $sheet.columns.Count -gt 2000){throw 'Cdl 工作表定义无效。'}
        $names[$sheet.name]=$sheet
        foreach($column in $sheet.columns){
            Assert-Exact $column @('label','unit','kind','designation','values');Assert-Text $column.label 4096;Assert-Text $column.unit 64
            if($column.kind -cnotin @('number','text') -or $column.designation -cnotin @('X','Y','none') -or $column.values -isnot [Array] -or $column.values.Count -gt 1000000){throw 'Cdl 工作表列定义无效。'}
            $cells+=$column.values.Count;if($cells -gt 2000000){throw 'Cdl 工作表容量过大。'}
            foreach($value in $column.values){if($null -eq $value){continue};if($column.kind -ceq 'number'){if(!(Test-Number $value)){throw 'Cdl 数值列包含无效值。'}}else{Assert-Text $value 1048576}}
        }
    }
    foreach($key in @('cvPlots','fitPlots')){
        $plots=$Packet.$key
        if($plots -isnot [Array] -or $plots.Count -gt 1000){throw 'Cdl 图形绑定数量无效。'}
        foreach($plot in $plots){
            Assert-Exact $plot @('sheet','x','y','kind','color');$sheet=$names[$plot.sheet]
            if(!$sheet -or !(Test-Number $plot.x) -or !(Test-Number $plot.y) -or $plot.x -ne [Math]::Floor($plot.x) -or $plot.y -ne [Math]::Floor($plot.y) -or $plot.x -lt 1 -or $plot.y -lt 1 -or $plot.x -gt $sheet.columns.Count -or $plot.y -gt $sheet.columns.Count -or $plot.kind -cnotin @('line','scatter') -or $plot.color -notmatch '^#[0-9a-fA-F]{6}$'){throw 'Cdl 图形数据绑定无效。'}
            $x=$sheet.columns[[int]$plot.x-1];$y=$sheet.columns[[int]$plot.y-1]
            if($x.kind -cne 'number' -or $y.kind -cne 'number' -or $x.values.Count -ne $y.values.Count){throw 'Cdl 图形数据列不一致。'}
        }
    }
}
function Release-Com($Value){if($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)}}
function Invoke-LabTalk($Origin,[string]$Command){if(!$Origin.Execute($Command)){throw ('Origin 执行失败：'+$Command)}}
function Write-CdlSheet($Origin,$Book,[string]$BookName,$Definition,[bool]$First,[string]$Context='Cdl selected-cycle export'){
    $sheet=$null;$column=$null
    try{
        [void]$Book.Activate()
        if($First){$sheet=$Book.Layers.Item(0);$sheet.Name=$Definition.name}else{Invoke-LabTalk $Origin ('newsheet name:='+$Definition.name+';');$sheet=$Origin.FindWorksheet('['+$BookName+']'+$Definition.name)}
        $sheet.LongName=$Definition.label;$sheet.Cols=$Definition.columns.Count
        $rows=0;foreach($definitionColumn in $Definition.columns){$rows=[Math]::Max($rows,$definitionColumn.values.Count)}
        $sheet.Rows=[Math]::Max(1,$rows)
        for($c=0;$c -lt $Definition.columns.Count;$c++){
            $definitionColumn=$Definition.columns[$c];$column=$sheet.Columns.Item($c);$text=$definitionColumn.kind -ceq 'text'
            $format=if($text){1}else{0};$designation=switch($definitionColumn.designation){'X'{3};'Y'{0};default{1}}
            $column.DataFormat=$format;$column.Type=$designation;$column.LongName=$definitionColumn.label;$column.Units=$definitionColumn.unit
            $column.Comments=$Context+'; source and calculation settings in Metadata; no point reduction; '+$BookName
            $count=$definitionColumn.values.Count
            if($count){
                $values=if($text){,[Array]::CreateInstance([string],$count)}else{,[Array]::CreateInstance([double],$count)}
                for($r=0;$r -lt $count;$r++){$value=$definitionColumn.values[$r];if($text){$values.SetValue([string]$value,$r)}else{$values.SetValue($(if($null -eq $value){$OriginMissing}else{[double]$value}),$r)}}
                if(!$column.SetData($values,0)){throw ('Origin 写入失败：'+$Definition.name+' 第 '+($c+1)+' 列。')}
                $received=$column.GetData($(if($text){6}else{1}),0,($count-1),0)
                if($received -isnot [Array] -or $received.Count -ne $count){throw 'Origin 工作表读回行数不一致。'}
                for($r=0;$r -lt $count;$r++){if($received.GetValue($r) -cne $values.GetValue($r)){throw ('Origin 数据读回不一致：'+$Definition.name+' 第 '+($c+1)+' 列，第 '+($r+1)+' 行。expectedLength='+([string]$values.GetValue($r)).Length+' actualLength='+([string]$received.GetValue($r)).Length)}}
            }
            if([int]$column.Type -ne $designation -or [string]$column.LongName -cne $definitionColumn.label -or [string]$column.Units -cne $definitionColumn.unit){throw 'Origin 列属性读回不一致。'}
            Release-Com $column;$column=$null
        }
    }finally{Release-Com $column;Release-Com $sheet}
}
function New-CdlGraph($Origin,[string]$BookName,[string]$Name,[string]$Label,$Plots,[string]$XTitle,[string]$YTitle){
    if(!$Plots.Count){return ''}
    $graph=$null;$layer=$null
    try{
        $index=0
        foreach($plot in $Plots){
            $type=if($plot.kind -ceq 'scatter'){201}else{200}
            $destination=if($index -eq 0){'[<new template:=line name:='+$Name+'>]'}else{'['+$Name+']1!'}
            Invoke-LabTalk $Origin ('plotxy iy:=['+$BookName+']'+$plot.sheet+'!('+$plot.x+','+$plot.y+') plot:='+$type+' ogl:='+$destination+';')
            Invoke-LabTalk $Origin 'doc -uw;'
            if($index -eq 0){$graph=$Origin.GraphPages($Name);$Name=[string]$graph.Name;$graph.LongName=$Label;$layer=$graph.Layers.Item(0)}
            $index++
            if([int]$layer.DataPlots.Count -ne $index){throw 'Origin 曲线绑定数量不一致。'}
            Invoke-LabTalk $Origin ('range -wx cdlSourceX=['+$Name+']1!'+$index+';range -wy cdlSourceY=['+$Name+']1!'+$index+';range cdlExpectedX=['+$BookName+']'+$plot.sheet+'!col('+$plot.x+');range cdlExpectedY=['+$BookName+']'+$plot.sheet+'!col('+$plot.y+');cdlActualX=range2uid(cdlSourceX);cdlActualY=range2uid(cdlSourceY);cdlExpectedXId=range2uid(cdlExpectedX);cdlExpectedYId=range2uid(cdlExpectedY);')
            if([double]$Origin.LTVar('cdlActualX') -le 0 -or [double]$Origin.LTVar('cdlActualY') -le 0 -or [double]$Origin.LTVar('cdlActualX') -ne [double]$Origin.LTVar('cdlExpectedXId') -or [double]$Origin.LTVar('cdlActualY') -ne [double]$Origin.LTVar('cdlExpectedYId')){throw 'Origin 曲线对应的 X/Y 源列读回不一致。'}
            Invoke-LabTalk $Origin ('range cdlPlot=['+$Name+']1!'+$index+';')
            $red=[Convert]::ToInt32($plot.color.Substring(1,2),16);$green=[Convert]::ToInt32($plot.color.Substring(3,2),16);$blue=[Convert]::ToInt32($plot.color.Substring(5,2),16)
            Invoke-LabTalk $Origin ('set cdlPlot -c color('+$red+','+$green+','+$blue+');')
            if($plot.kind -ceq 'scatter'){Invoke-LabTalk $Origin 'set cdlPlot -k 2;';Invoke-LabTalk $Origin 'set cdlPlot -z 7;'}else{Invoke-LabTalk $Origin 'set cdlPlot -w 400;'}
            Invoke-LabTalk $Origin 'get cdlPlot -pt cdlPlotType;'
            if([int]$Origin.LTVar('cdlPlotType') -ne $type){throw 'Origin 曲线类型读回不一致。'}
        }
        $isCV=$Name.StartsWith('CdlCV')
        $layout=if($isCV){'layer.left=14;layer.width=54;'}else{'layer.left=17;layer.width=73;'}
        Invoke-LabTalk $Origin ('layer -a;layer.x2.ticks=0;layer.y2.ticks=0;layer.unit=1;layer.top=8;layer.height=72;'+$layout)
        Invoke-LabTalk $Origin ('label -xb "'+$XTitle+'";xb.fsize=20;xb.font=font(Arial);xb.background=0;label -yl "'+$YTitle+'";yl.fsize=20;yl.font=font(Arial);yl.background=0;legend -r;legendupdate mode:=lname;legend.fsize=12;legend.font=font(Arial);legend.background=0;doc -uw;')
        $legendX=if($isCV){'legend.x=layer.x.to+legend.dx/2+(layer.x.to-layer.x.from)*.04;'}else{'legend.x=layer.x.from+legend.dx/2;'}
        Invoke-LabTalk $Origin ($legendX+'legend.y=layer.y.to-legend.dy/2;doc -uw;')
        [void]$graph.Activate()
        return $Name
    }finally{Release-Com $layer;Release-Com $graph}
}
function Write-OriginCdl($Origin,$Packet){
    $book=$null
    try{
        $bookName=[string]$Origin.CreatePage(2,('Cdl'+$Packet.requestId.Replace('-','').Substring(0,12)),'origin',2)
        if($bookName -notmatch '^[A-Za-z][A-Za-z0-9]*$'){throw 'Origin 未能创建安全命名的新工作簿。'}
        $book=$Origin.WorksheetPages($bookName);$book.LongName=$Packet.label+' · Cdl · '+$Packet.createdAt
        for($i=0;$i -lt $Packet.sheets.Count;$i++){Write-CdlSheet $Origin $book $bookName $Packet.sheets[$i] ($i -eq 0)}
        $suffix=$Packet.requestId.Replace('-','').Substring(0,12)
        $current=if($Packet.currentUnit -ceq 'mA/cm2'){'mA/cm\+(2)'}else{'mA'}
        $fitY=if($Packet.settings.halfDelta){'(I\-(a)-I\-(c))/2 ('+$current+')'}else{'I\-(a)-I\-(c) ('+$current+')'}
        $cv=New-CdlGraph $Origin $bookName ('CdlCV'+$suffix) ($Packet.label+' · CV') $Packet.cvPlots 'Potential (V)' ('Current ('+$current+')')
        $fit=New-CdlGraph $Origin $bookName ('CdlFit'+$suffix) ($Packet.label+' · Cdl') $Packet.fitPlots 'Scan rate (mV/s)' $fitY
        return [ordered]@{bookName=$bookName;cvGraphName=[string]$cv;fitGraphName=[string]$fit;sheetCount=$Packet.sheets.Count;cvPlotCount=$Packet.cvPlots.Count;fitPlotCount=$Packet.fitPlots.Count}
    }finally{Release-Com $book}
}
function Write-Status([string]$Stage,[string]$Message,[bool]$Failed=$false,$Result=$null){
    $state=[ordered]@{schema='cdl-origin-status/v1';requestId=$RequestId;operationId=$OperationId;stage=$Stage;done=($Stage -eq 'complete' -or $Failed);failed=$Failed;message=$Message}
    if($Result){foreach($key in @('bookName','cvGraphName','fitGraphName','sheetCount','cvPlotCount','fitPlotCount')){$state[$key]=$Result[$key]}}
    $temporary=$StatusPath+'.tmp';[IO.File]::WriteAllText($temporary,($state|ConvertTo-Json -Depth 8 -Compress),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $StatusPath -Force
}
if($ValidateOnly){return}
$origin=$null;$safeStatus=$false
try{
    Assert-Id $RequestId;Assert-Id $OperationId
    $work=[Environment]::GetEnvironmentVariable('PLOT_DESKTOP_WORK_DIRECTORY')
    if(!$work -or ![IO.Path]::IsPathRooted($work)){throw '本机操作目录无效。'}
    $expectedPayload=Join-Path (Join-Path $work 'CdlTransfers') ('cdl-origin-'+$RequestId+'.json')
    $expectedStatus=Join-Path (Join-Path $work 'Logs') ('cdl-'+$OperationId+'.status.json')
    if(![IO.Path]::IsPathRooted($PayloadPath) -or [IO.Path]::GetFullPath($PayloadPath) -ine [IO.Path]::GetFullPath($expectedPayload) -or ![IO.Path]::IsPathRooted($StatusPath) -or [IO.Path]::GetFullPath($StatusPath) -ine [IO.Path]::GetFullPath($expectedStatus)){throw '本机交接文件路径无效。'}
    $safeStatus=$true;$file=Get-Item -LiteralPath $PayloadPath
    if($file.PSIsContainer -or $file.Length -gt 64MB){throw 'Cdl 数据包大小无效。'}
    $packet=[IO.File]::ReadAllText($PayloadPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
    Assert-CdlPayload $packet $RequestId
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($StatusPath))
    Write-Status 'opening' '正在打开一个新的 Origin 窗口。'
    # Create a separate instance; never attach/reset/close the user's open project.
    $origin=New-Object -ComObject Origin.Application;$origin.Visible=1
    Write-Status 'writing' '正在写入当前完整 CV 圈、独立电极拟合和来源设置。'
    $result=Write-OriginCdl $origin $packet
    $origin.Visible=100
    Write-Status 'complete' 'Cdl 工作表和可编辑图形已逐点核对。' $false $result
}catch{
    $message=$_.Exception.Message
    try{if($safeStatus -and [IO.Directory]::Exists([IO.Path]::GetDirectoryName($StatusPath))){Write-Status 'failed' $message $true}}catch{}
    [Console]::Error.WriteLine($message);exit 1
}finally{Release-Com $origin}
