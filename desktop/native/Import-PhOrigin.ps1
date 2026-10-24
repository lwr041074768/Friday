param([string]$PayloadPath,[string]$RequestId,[string]$OperationId,[string]$StatusPath,[switch]$ValidateOnly)
$ErrorActionPreference='Stop'
# Reuse only the reviewed literal worksheet writer and graph binding readback.
# Preserve this script's arguments because a dot-sourced script has parameters.
$phArguments=@{PayloadPath=$PayloadPath;RequestId=$RequestId;OperationId=$OperationId;StatusPath=$StatusPath;ValidateOnly=$ValidateOnly}
. (Join-Path $PSScriptRoot 'Import-CdlOrigin.ps1') -ValidateOnly
foreach($key in $phArguments.Keys){Set-Variable -Name $key -Value $phArguments[$key]}
function Assert-PhPayload($Packet,[string]$ExpectedId){
    Assert-Exact $Packet @('schema','requestId','createdAt','label','settings','sheets','rawPlots','fitPlots')
    Assert-Id $Packet.requestId
    if($Packet.schema -cne 'ph-origin/v1' -or $Packet.requestId -cne $ExpectedId){throw 'pH 数据包类型或标识无效。'}
    Assert-Text $Packet.label 1024;Assert-Text $Packet.createdAt 64
    $s=$Packet.settings
    $strings=@('potential','mode','inputScale','scan','cycle','outputUnit','fraction','reference','filling','offset','temperature')
    if('fitGrouping' -cin @($s.PSObject.Properties.Name)){$strings+=@('fitGrouping');if($s.fitGrouping -cnotin @('auto','groups','combined')){throw 'pH 拟合分组无效。'}}
    Assert-Exact $s ($strings+@('absolute','applyIr','referenceConfirmed'))
    foreach($key in $strings){Assert-Text $s.$key 2048}
    foreach($key in @('absolute','applyIr','referenceConfirmed')){if($s.$key -isnot [bool]){throw 'pH 选项无效。'}}
    if($s.mode -cnotin @('raw','rhe') -or $s.inputScale -cnotin @('reference','rhe') -or $s.scan -cnotin @('up','down') -or $s.outputUnit -cnotin @('mA/cm2','uA/cm2')){throw 'pH 计算设置无效。'}
    $target=0.0
    if(![double]::TryParse($s.potential,[Globalization.NumberStyles]::Float,$Invariant,[ref]$target) -or !(Test-Number $target)){throw '取点电位无效。'}
    if($Packet.sheets -isnot [Array] -or $Packet.sheets.Count -lt 1 -or $Packet.sheets.Count -gt 130){throw '工作表数量无效。'}
    $names=@{};$cells=0
    foreach($sheet in $Packet.sheets){
        Assert-Exact $sheet @('name','label','columns');Assert-Text $sheet.label 1024
        if($sheet.name -cnotmatch '^[A-Za-z][A-Za-z0-9]{0,30}$' -or $names.ContainsKey($sheet.name) -or $sheet.columns -isnot [Array] -or $sheet.columns.Count -lt 1 -or $sheet.columns.Count -gt 2000){throw '工作表定义无效。'}
        $names[$sheet.name]=$sheet
        foreach($column in $sheet.columns){
            Assert-Exact $column @('label','unit','kind','designation','values');Assert-Text $column.label 4096;Assert-Text $column.unit 64
            if($column.kind -cnotin @('number','text') -or $column.designation -cnotin @('X','Y','none') -or $column.values -isnot [Array] -or $column.values.Count -gt 1000000){throw '工作表列定义无效。'}
            $cells+=$column.values.Count;if($cells -gt 3000000){throw '工作表容量超限。'}
            foreach($value in $column.values){if($null -eq $value){continue};if($column.kind -ceq 'number'){if(!(Test-Number $value)){throw '无效数值。'}}else{Assert-Text $value 1048576}}
        }
    }
    foreach($key in @('rawPlots','fitPlots')){
        if($Packet.$key -isnot [Array] -or $Packet.$key.Count -gt 1000){throw '图形绑定数量无效。'}
        foreach($plot in $Packet.$key){
            Assert-Exact $plot @('sheet','x','y','kind','color');$sheet=$names[$plot.sheet]
            if(!$sheet -or !(Test-Number $plot.x) -or !(Test-Number $plot.y) -or $plot.x -ne [Math]::Floor($plot.x) -or $plot.y -ne [Math]::Floor($plot.y) -or $plot.x -lt 1 -or $plot.y -lt 1 -or $plot.x -gt $sheet.columns.Count -or $plot.y -gt $sheet.columns.Count -or $plot.kind -cnotin @('line','scatter') -or $plot.color -notmatch '^#[a-f0-9]{6}$'){throw '图形绑定无效。'}
            $x=$sheet.columns[[int]$plot.x-1];$y=$sheet.columns[[int]$plot.y-1]
            if($x.kind -cne 'number' -or $y.kind -cne 'number' -or $x.values.Count -ne $y.values.Count){throw 'X/Y 源列不一致。'}
        }
    }
}
function Write-OriginPh($Origin,$Packet){
    $book=$null
    try{
        $suffix=$Packet.requestId.Replace('-','').Substring(0,12)
        $bookName=[string]$Origin.CreatePage(2,('Ph'+$suffix),'origin',2)
        if($bookName -notmatch '^[A-Za-z][A-Za-z0-9]*$'){throw 'Origin 未创建新工作簿。'}
        $book=$Origin.WorksheetPages($bookName);$book.LongName='pH dependence '+$Packet.createdAt
        for($i=0;$i -lt $Packet.sheets.Count;$i++){Write-CdlSheet $Origin $book $bookName $Packet.sheets[$i] ($i -eq 0) 'pH dependence export: complete source rows, signed currents and selection flags'}
        $xTitle=if($Packet.settings.mode -ceq 'rhe' -or $Packet.settings.inputScale -ceq 'rhe'){'Potential vs. RHE (V)'}elseif($Packet.settings.applyIr){'iR-corrected recorded potential (V)'}else{'Recorded potential (V)'}
        $unit=if($Packet.settings.outputUnit -ceq 'uA/cm2'){'uA cm^-2'}else{'mA cm^-2'}
        $log=if($Packet.settings.absolute){'log10(|j| / '+$unit+')'}else{'log10(j / '+$unit+')'}
        $raw=New-CdlGraph $Origin $bookName ('PhRaw'+$suffix) 'pH selected scan branches' $Packet.rawPlots $xTitle ('j / '+$unit)
        $fit=New-CdlGraph $Origin $bookName ('PhFit'+$suffix) ('pH dependence at E = '+$Packet.settings.potential+' V') $Packet.fitPlots 'pH' $log
        return [ordered]@{bookName=$bookName;rawGraphName=[string]$raw;fitGraphName=[string]$fit}
    }finally{Release-Com $book}
}
function Write-PhStatus([string]$Stage,[string]$Message,[bool]$Failed=$false,$Result=$null){
    $state=[ordered]@{schema='ph-origin-status/v1';requestId=$RequestId;operationId=$OperationId;stage=$Stage;done=($Stage -eq 'complete' -or $Failed);failed=$Failed;message=$Message}
    if($Result){foreach($key in @('bookName','rawGraphName','fitGraphName')){$state[$key]=$Result[$key]}}
    $temporary=$StatusPath+'.tmp';[IO.File]::WriteAllText($temporary,($state|ConvertTo-Json -Depth 6 -Compress),(New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $StatusPath -Force
}
if($ValidateOnly){return}
$origin=$null;$safeStatus=$false
try{
    Assert-Id $RequestId;Assert-Id $OperationId
    $work=[Environment]::GetEnvironmentVariable('PLOT_DESKTOP_WORK_DIRECTORY')
    if(!$work -or ![IO.Path]::IsPathRooted($work)){throw '本机操作目录无效。'}
    $expectedPayload=Join-Path (Join-Path $work 'PhTransfers') ('ph-origin-'+$RequestId+'.json')
    $expectedStatus=Join-Path (Join-Path $work 'Logs') ('ph-'+$OperationId+'.status.json')
    if(![IO.Path]::IsPathRooted($PayloadPath) -or [IO.Path]::GetFullPath($PayloadPath) -ine [IO.Path]::GetFullPath($expectedPayload) -or ![IO.Path]::IsPathRooted($StatusPath) -or [IO.Path]::GetFullPath($StatusPath) -ine [IO.Path]::GetFullPath($expectedStatus)){throw '本机交接文件路径无效。'}
    $safeStatus=$true;$file=Get-Item -LiteralPath $PayloadPath
    if($file.PSIsContainer -or $file.Length -gt 64MB){throw '数据包大小无效。'}
    $packet=[IO.File]::ReadAllText($PayloadPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
    Assert-PhPayload $packet $RequestId
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($StatusPath))
    Write-PhStatus 'opening' '正在打开新的 Origin 窗口。'
    $origin=New-Object -ComObject Origin.Application;$origin.Visible=1
    Write-PhStatus 'writing' '正在写入完整数据、取点表和拟合。'
    $result=Write-OriginPh $origin $packet;$origin.Visible=100
    Write-PhStatus 'complete' 'pH 工作表和图形已逐点核对。' $false $result
}catch{
    $message=$_.Exception.Message
    try{if($safeStatus -and [IO.Directory]::Exists([IO.Path]::GetDirectoryName($StatusPath))){Write-PhStatus 'failed' $message $true}}catch{}
    [Console]::Error.WriteLine($message);exit 1
}finally{Release-Com $origin}
