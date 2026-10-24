import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import sharp from 'sharp';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(directory);
const appDirectory = path.join(directory, 'build/app');
await fs.mkdir(appDirectory, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
const preloadSource=await fs.readFile(path.join(directory,'preload.cjs'),'utf8');
if(!preloadSource.includes(`version: '${manifest.version}'`))throw Error('Desktop manifest and preload versions differ.');
await fs.writeFile(path.join(appDirectory, 'package.json'), JSON.stringify({ name: manifest.name, productName: manifest.productName, version: manifest.version, description: manifest.description, main: 'main.cjs' }, null, 2));
for (const file of ['main.cjs', 'preload.cjs', 'policy.cjs', 'updater.cjs', 'vector-pdf.cjs', 'folder-import.cjs']) await fs.copyFile(path.join(directory, file), path.join(appDirectory, file));
const sourceFiles=new Set();
await build({ configFile: path.join(directory, 'vite.config.mjs'),plugins:[{name:'desktop-source-manifest',generateBundle(){for(const id of this.getModuleIds()){const clean=path.normalize(id.split('?')[0]);if(path.isAbsolute(clean)&&!clean.includes('node_modules')&&clean.startsWith(root+path.sep))sourceFiles.add(path.relative(root,clean).replaceAll('\\','/'));}}}] });
await fs.writeFile(path.join(directory,'build/source-manifest.json'),JSON.stringify([...sourceFiles].sort(),null,2));
const manual=path.join(root,'docs','科研绘图台使用说明书.pdf');
try{await fs.access(manual);await fs.mkdir(path.join(directory,'build/docs'),{recursive:true});await fs.copyFile(manual,path.join(directory,'build/docs','科研绘图台使用说明书.pdf'));}catch(error){if(error.code!=='ENOENT')throw error;}

// Rasterize the existing vector logo for the Windows application icon.
const logo = await fs.readFile(path.join(root, 'public/favicon.svg'));
const png = await sharp(logo).resize(256, 256).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await fs.writeFile(path.join(appDirectory, 'icon.ico'), Buffer.concat([header, png]));

const nativeDirectory = path.join(appDirectory, 'native');
await fs.mkdir(nativeDirectory, { recursive: true });
await fs.copyFile(path.join(directory, 'native/Install-DesktopUpdate.ps1'), path.join(nativeDirectory, 'Install-DesktopUpdate.ps1'));
await fs.copyFile(path.join(directory, 'native/Import-OverpotentialOrigin.ps1'), path.join(nativeDirectory, 'Import-OverpotentialOrigin.ps1'));
await fs.copyFile(path.join(directory, 'native/Import-CdlOrigin.ps1'), path.join(nativeDirectory, 'Import-CdlOrigin.ps1'));
await fs.copyFile(path.join(directory, 'native/Import-PhOrigin.ps1'), path.join(nativeDirectory, 'Import-PhOrigin.ps1'));
function replaceExactly(text, original, replacement, label) {
  if (!text.includes(original)) throw Error(`Native bridge source changed: ${label}`);
  return text.replace(original, replacement);
}
let origin = (await fs.readFile(path.join(root, 'public/origin-helper/Import-LsvOrigin.ps1'), 'utf8')).replace(/^\uFEFF+/, '');
origin = replaceExactly(origin, 'param([string]$RequestUri)', 'param([string]$RequestUri,[string]$PayloadPath)', 'Origin parameters');
origin = replaceExactly(origin, 'function Find-Payload([string]$Id) {', `function Find-Payload([string]$Id) {
    if ($PayloadPath) {
        if (![IO.Path]::IsPathRooted($PayloadPath) -or [IO.Path]::GetFileName($PayloadPath) -cne ('lsv-origin-'+$Id+'.lsvdata') -or ![IO.File]::Exists($PayloadPath)) { throw '桌面版交接文件路径无效。' }
        return $PayloadPath
    }`, 'Origin explicit payload');
origin = replaceExactly(origin, "$logFolder = Join-Path $PSScriptRoot 'Logs'", "$logFolder = Join-Path ([Environment]::GetEnvironmentVariable('PLOT_DESKTOP_WORK_DIRECTORY')) 'Logs'", 'Origin logs');
// Raman shares the checked four-column writer. Keep the hosted helper and
// LSV/EIS/XRD contracts unchanged; only the desktop copy accepts Raman units.
const xyStart=origin.indexOf('function Validate-XyPayload('),xyEnd=origin.indexOf('function Validate-Payload(');
if(xyStart<0||xyEnd<=xyStart)throw Error('Native XY validation boundaries changed.');
let xy=origin.slice(xyStart,xyEnd);
xy=replaceExactly(xy,"$Payload.kind -notin @('xrd','eis')","$Payload.kind -notin @('xrd','eis','raman')",'Raman kind');
xy=replaceExactly(xy,"$keys = if ($Payload.kind -eq 'xrd')","$keys = if ($Payload.kind -in @('xrd','raman'))",'Raman columns');
xy=replaceExactly(xy,"$Payload.kind -eq 'xrd' -or $compactEis","$Payload.kind -in @('xrd','raman') -or $compactEis",'Raman designations');
xy=replaceExactly(xy,"} elseif ($c -eq 4) { 'Hz' }","} elseif ($Payload.kind -eq 'raman') { if ($c -in @(0,2)) { 'cm^-1' } else { 'a.u.' } } elseif ($c -eq 4) { 'Hz' }",'Raman units');
xy=replaceExactly(xy,"if ($Payload.samples -isnot [Array] -or $Payload.samples.Count -lt 1 -or $Payload.samples.Count -gt 10) { throw '每次必须导入 1 至 10 个样品。' }","$sampleLimit = if ($Payload.kind -eq 'raman') { 80 } else { 10 }\n    if ($Payload.samples -isnot [Array] -or $Payload.samples.Count -lt 1 -or $Payload.samples.Count -gt $sampleLimit) { throw \"每次必须导入 1 至 $sampleLimit 个样品。\" }",'Raman sample limit');
xy=replaceExactly(xy,"$Payload.kind -eq 'xrd' -and $null -ne $sample.imaginary","$Payload.kind -in @('xrd','raman') -and $null -ne $sample.imaginary",'Raman nullable convention');
origin=origin.slice(0,xyStart)+xy+origin.slice(xyEnd);
await fs.writeFile(path.join(nativeDirectory, 'Import-LsvOrigin.ps1'), '\uFEFF' + origin);

let jade = (await fs.readFile(path.join(root, 'public/origin-helper/Read-JadeCard.ps1'), 'utf8')).replace(/^\uFEFF+/, '');
jade = replaceExactly(jade, 'param([string]$RequestUri,[long]$ReturnWindow=0)', 'param([string]$RequestUri,[long]$ReturnWindow=0,[string]$ResultDirectory)', 'JADE parameters');
jade = replaceExactly(jade, "$requestId=$Matches[1].ToLowerInvariant()", `$requestId=$Matches[1].ToLowerInvariant()
if (!$ResultDirectory -or ![IO.Path]::IsPathRooted($ResultDirectory)) { throw '桌面版返回目录无效。' }
[void][IO.Directory]::CreateDirectory($ResultDirectory)
function Write-DesktopJadeResult($Value) {
 $target=Join-Path $ResultDirectory ('jade-'+$requestId+'.json')
 $temporary=$target+'.tmp'
 [IO.File]::WriteAllText($temporary,($Value|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
 [IO.File]::Move($temporary,$target)
}`, 'JADE result path');
jade = replaceExactly(jade, '[Windows.Forms.Clipboard]::SetText("SCIENTIFIC_PLOT_JADE_V1`n"+($packet|ConvertTo-Json -Compress))', 'Write-DesktopJadeResult $packet', 'JADE success transport');
jade = replaceExactly(jade, 'try{[Windows.Forms.Clipboard]::SetText("SCIENTIFIC_PLOT_JADE_V1`n"+([ordered]@{schema=\'jade-card/v1\';requestId=$requestId;error=$failureMessage}|ConvertTo-Json -Compress))}catch{}', "try{Write-DesktopJadeResult ([ordered]@{schema='jade-card/v1';requestId=$requestId;error=$failureMessage})}catch{}", 'JADE error transport');
jade = jade.replaceAll("Join-Path $PSScriptRoot 'Logs'", "Join-Path $ResultDirectory 'Logs'");
jade = replaceExactly(jade, '$failureMessage=$_.Exception.Message', '$failureMessage=if ($_.Exception.InnerException) {$_.Exception.InnerException.Message} else {$_.Exception.Message}', 'JADE readable errors');
await fs.writeFile(path.join(nativeDirectory, 'Read-JadeCard.ps1'), '\uFEFF' + jade);
console.log(`Desktop ${manifest.version} prepared at ${appDirectory}`);
