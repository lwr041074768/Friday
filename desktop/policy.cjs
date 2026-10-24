const path = require('node:path');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function validateId(value) { if (typeof value !== 'string' || !ID.test(value)) throw Error('请求标识无效。'); return value; }
function validateOriginRequest(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 64 * 1024 * 1024) throw Error('Origin 数据包过大或格式无效。');
  const payload = JSON.parse(text);
  if (!payload || !['lsv-origin/v1', 'xy-origin/v1'].includes(payload.schema)) throw Error('Origin 数据包类型无效。');
  validateId(payload.requestId);
  const sampleLimit=payload.schema==='xy-origin/v1'&&payload.kind==='raman'?80:10;
  if (!Array.isArray(payload.samples) || payload.samples.length < 1 || payload.samples.length > sampleLimit) throw Error(`每次需导入 1–${sampleLimit} 个样品。`);
  if (payload.schema === 'xy-origin/v1' && !['eis', 'xrd', 'raman'].includes(payload.kind)) throw Error('Origin 数据类型无效。');
  // The existing native helper performs detailed shape, value, column, unit and
  // formula validation before creating a new Origin instance.
  return payload;
}
function validateOverpotentialRequest(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw Error('过电位 Origin 数据包过大或格式无效。');
  const packet = JSON.parse(text);
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12;
  const nullable = value => value === null || number(value);
  const string = (value, maximum) => typeof value === 'string' && value.length <= maximum && !value.includes('\0');
  if (!exact(packet, ['schema', 'requestId', 'createdAt', 'scan', 'demo', 'target', 'axes', 'samples']) || packet.schema !== 'overpotential-origin/v1') throw Error('过电位 Origin 数据包类型无效。');
  validateId(packet.requestId);
  if (!string(packet.createdAt, 64) || !Number.isFinite(Date.parse(packet.createdAt)) || !['all', 'up', 'down'].includes(packet.scan) || typeof packet.demo !== 'boolean') throw Error('过电位导出信息无效。');
  if (!exact(packet.target, ['current', 'equilibriumVoltage', 'unit']) || packet.target.current !== 10 || packet.target.equilibriumVoltage !== 1.23 || packet.target.unit !== 'mV') throw Error('过电位目标参数无效。');
  if (!exact(packet.axes, ['x', 'y'])) throw Error('过电位坐标轴参数无效。');
  for (const axis of [packet.axes.x, packet.axes.y]) {
    if (!exact(axis, ['min', 'max', 'major', 'minorCount', 'majorTicks', 'minorTicks']) || !number(axis.min) || !number(axis.max) || !(axis.min < axis.max) || !number(axis.major) || !(axis.major > 0) || !Number.isInteger(axis.minorCount) || axis.minorCount < 0 || axis.minorCount > 10) throw Error('过电位坐标轴范围或刻度无效。');
    for (const [ticks, maximum] of [[axis.majorTicks, 1000], [axis.minorTicks, 1000]]) {
      if (!Array.isArray(ticks) || ticks.length > maximum || ticks.some((value, index) => !number(value) || value < axis.min - 1e-8 || value > axis.max + 1e-8 || (index > 0 && !(value > ticks[index - 1])))) throw Error('过电位刻度位置无效。');
    }
    if (axis.majorTicks.length + axis.minorTicks.length > 1000) throw Error('过电位刻度总数过多。');
  }
  if (!Array.isArray(packet.samples) || packet.samples.length < 1 || packet.samples.length > 10) throw Error('每次需导出 1–10 个样品。');
  const sampleKeys = ['id', 'order', 'name', 'color', 'source', 'eta10MV', 'xAt10', 'eAt10', 'status', 'note', 'candidate', 'demo', 'visible', 'irVoltage', 'unit', 'area', 'compensation'];
  for (const [index, sample] of packet.samples.entries()) {
    if (!exact(sample, sampleKeys) || !string(sample.id, 256) || !sample.id || sample.order !== index + 1 || !string(sample.name, 1024) || !sample.name || !/^#[0-9a-f]{6}$/i.test(sample.color) || !string(sample.source, 8192) || !string(sample.status, 128) || !string(sample.note, 16384) || !string(sample.unit, 64) || !string(sample.area, 256) || !['raw', 'corrected', 'unknown'].includes(sample.compensation)) throw Error(`第 ${index + 1} 个过电位样品信息无效。`);
    if (![sample.eta10MV, sample.xAt10, sample.eAt10, sample.irVoltage].every(nullable) || [sample.candidate, sample.demo, sample.visible].some(value => typeof value !== 'boolean')) throw Error(`第 ${index + 1} 个过电位样品读数无效。`);
    if ((sample.eta10MV === null) !== (sample.xAt10 === null) || (sample.eta10MV === null) !== (sample.eAt10 === null) || (sample.eta10MV !== null && Math.abs(sample.eta10MV - (sample.xAt10 - 1.23) * 1000) > 1e-7 * Math.max(1, Math.abs(sample.eta10MV)))) throw Error(`第 ${index + 1} 个过电位读数与 LSV 交点不一致。`);
  }
  return packet;
}
function resolveAsset(value, root) {
  const url = new URL(value);
  if (url.protocol !== 'plot-app:' || url.host !== 'studio' || url.username || url.password) throw Error('Invalid origin');
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (relative.includes('\0') || relative.includes('\\')) throw Error('Invalid path');
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) throw Error('Invalid path');
  return file;
}
function validateCdlRequest(text) {
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>64*1024*1024)throw Error('Cdl Origin 数据包过大或格式无效。');
  const packet=JSON.parse(text);
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const number=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e12;
  const string=(value,max)=>typeof value==='string'&&value.length<=max&&!value.includes('\0');
  if(!exact(packet,['schema','requestId','createdAt','label','settings','sheets','cvPlots','fitPlots','currentUnit','electrodeCount'])||packet.schema!=='cdl-origin/v1')throw Error('Cdl Origin 数据包类型无效。');
  validateId(packet.requestId);
  if(!string(packet.createdAt,64)||!Number.isFinite(Date.parse(packet.createdAt))||!string(packet.label,1024)||!['mA','mA/cm2','mixed'].includes(packet.currentUnit)||!Number.isInteger(packet.electrodeCount)||packet.electrodeCount<0||packet.electrodeCount>60)throw Error('Cdl 导出信息无效。');
  const settings=packet.settings;
  if(!settings||Object.keys(settings).some(key=>!['e0','currentUnit','normalizeArea','areaCM2','cycle','halfDelta','throughOrigin'].includes(key))||!number(settings.e0)||!['A','mA','uA','nA','A/cm2','mA/cm2','uA/cm2'].includes(settings.currentUnit)||['normalizeArea','halfDelta','throughOrigin'].some(key=>typeof settings[key]!=='boolean')||(settings.areaCM2!==undefined&&(!number(settings.areaCM2)||settings.areaCM2<=0))||(settings.cycle!=='last'&&(!Number.isInteger(settings.cycle)||settings.cycle<1)))throw Error('Cdl 计算设置无效。');
  if(!Array.isArray(packet.sheets)||!packet.sheets.length||packet.sheets.length>70)throw Error('Cdl 工作表数量无效。');
  const names=new Map();let cells=0;
  for(const sheet of packet.sheets){
    if(!exact(sheet,['name','label','columns'])||!/^([A-Za-z][A-Za-z0-9]{0,30})$/.test(sheet.name)||names.has(sheet.name)||!string(sheet.label,1024)||!Array.isArray(sheet.columns)||!sheet.columns.length||sheet.columns.length>2000)throw Error('Cdl 工作表定义无效。');
    names.set(sheet.name,sheet);
    for(const column of sheet.columns){
      if(!exact(column,['label','unit','kind','designation','values'])||!string(column.label,4096)||!string(column.unit,64)||!['number','text'].includes(column.kind)||!['X','Y','none'].includes(column.designation)||!Array.isArray(column.values)||column.values.length>1000000)throw Error('Cdl 工作表列定义无效。');
      cells+=column.values.length;
      if(cells>2000000||column.values.some(value=>value!==null&&(column.kind==='number'?!number(value):!string(value,1048576))))throw Error('Cdl 工作表数值或容量无效。');
    }
  }
  for(const plots of [packet.cvPlots,packet.fitPlots]){
    if(!Array.isArray(plots)||plots.length>1000)throw Error('Cdl 图形绑定数量无效。');
    for(const plot of plots){
      const sheet=names.get(plot?.sheet);
      if(!exact(plot,['sheet','x','y','kind','color'])||!sheet||!Number.isInteger(plot.x)||!Number.isInteger(plot.y)||plot.x<1||plot.y<1||plot.x>sheet.columns.length||plot.y>sheet.columns.length||!['line','scatter'].includes(plot.kind)||!/^#[0-9a-f]{6}$/i.test(plot.color)||[plot.x,plot.y].some(index=>sheet.columns[index-1].kind!=='number')||sheet.columns[plot.x-1].values.length!==sheet.columns[plot.y-1].values.length)throw Error('Cdl 图形数据绑定无效。');
    }
  }
  return packet;
}
function validatePhRequest(text) {
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>64*1024*1024)throw Error('pH Origin 数据包过大或格式无效。');
  const p=JSON.parse(text),exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  const string=(v,max)=>typeof v==='string'&&v.length<=max&&!v.includes('\0');
  const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
  if(!exact(p,['schema','requestId','createdAt','label','settings','sheets','rawPlots','fitPlots'])||p.schema!=='ph-origin/v1')throw Error('pH Origin 数据包类型无效。');
  validateId(p.requestId);
  if(!string(p.createdAt,64)||!Number.isFinite(Date.parse(p.createdAt))||!string(p.label,1024))throw Error('pH 导出信息无效。');
  const s=p.settings,strings=['potential','mode','inputScale','scan','cycle','outputUnit','fraction','reference','filling','offset','temperature'],booleans=['absolute','applyIr','referenceConfirmed'];
  if(s&&Object.hasOwn(s,'fitGrouping'))strings.push('fitGrouping');
  if(!exact(s,[...strings,...booleans])||strings.some(k=>!string(s[k],2048))||booleans.some(k=>typeof s[k]!=='boolean')||!['raw','rhe'].includes(s.mode)||!['reference','rhe'].includes(s.inputScale)||!['up','down'].includes(s.scan)||!['mA/cm2','uA/cm2'].includes(s.outputUnit)||!s.potential.trim()||!number(Number(s.potential)))throw Error('pH 计算设置无效。');
  if(s.fitGrouping!==undefined&&!['auto','groups','combined'].includes(s.fitGrouping))throw Error('pH 拟合分组无效。');
  if(!Array.isArray(p.sheets)||!p.sheets.length||p.sheets.length>130)throw Error('pH 工作表数量无效。');
  const names=new Map();let cells=0;
  for(const sheet of p.sheets){
    if(!exact(sheet,['name','label','columns'])||!/^([A-Za-z][A-Za-z0-9]{0,30})$/.test(sheet.name)||names.has(sheet.name)||!string(sheet.label,1024)||!Array.isArray(sheet.columns)||!sheet.columns.length||sheet.columns.length>2000)throw Error('pH 工作表定义无效。');
    names.set(sheet.name,sheet);
    for(const column of sheet.columns){
      if(!exact(column,['label','unit','kind','designation','values'])||!string(column.label,4096)||!string(column.unit,64)||!['number','text'].includes(column.kind)||!['X','Y','none'].includes(column.designation)||!Array.isArray(column.values)||column.values.length>1000000)throw Error('pH 列定义无效。');
      cells+=column.values.length;if(cells>3000000||column.values.some(v=>v!==null&&(column.kind==='number'?!number(v):!string(v,1048576))))throw Error('pH 工作表数值或容量无效。');
    }
  }
  for(const plots of [p.rawPlots,p.fitPlots]){
    if(!Array.isArray(plots)||plots.length>1000)throw Error('pH 图形绑定数量无效。');
    for(const plot of plots){const sheet=names.get(plot?.sheet);if(!exact(plot,['sheet','x','y','kind','color'])||!sheet||!Number.isInteger(plot.x)||!Number.isInteger(plot.y)||plot.x<1||plot.y<1||plot.x>sheet.columns.length||plot.y>sheet.columns.length||!['line','scatter'].includes(plot.kind)||!/^#[0-9a-f]{6}$/i.test(plot.color)||[plot.x,plot.y].some(i=>sheet.columns[i-1].kind!=='number')||sheet.columns[plot.x-1].values.length!==sheet.columns[plot.y-1].values.length)throw Error('pH 图形数据绑定无效。');}
  }
  return p;
}
function psLiteral(value) { if (typeof value !== 'string' || /[\0\r\n]/.test(value)) throw Error('Invalid argument'); return "'" + value.replace(/'/g, "''") + "'"; }
function windowsArgument(value) {
  if (/[\0\r\n]/.test(value)) throw Error('Invalid argument');
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
module.exports = { validateId, validateOriginRequest, validateOverpotentialRequest, validateCdlRequest, validatePhRequest, resolveAsset, psLiteral, windowsArgument };
