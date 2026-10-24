import { strFromU8, unzipSync } from "fflate";
import { parseChiLsvBin } from "./chi-lsv-bin";
import { parseChiEisBin } from "./chi-eis-bin";
import type { CurrentUnit, Point } from "./lsv-math";
export type DataTable = { id: string; source: string; name: string; headers: string[]; rows: (number | null)[][] };
export type ColumnPair = { e: number; current: number; name: string; unit: CurrentUnit };
export type ImportProfile = "lsv" | "eis" | "xrd" | "raman";
export const isBodeColumn=(h:string)=>/freq(?:uency)?|phase|频率|相位|\|\s*z\s*\||zmod|modulus|magnitude|^\s*z\s*(?:[/([]|$)/i.test(h);
export const eisImaginaryConvention=(header:string):"raw"|"negative"=>/(?:^|\s)[-−]\s*(?:z\s*(?:["″“”]|''|imag\d*\b|im\d*\b)|im\s*\()/i.test(header)?"negative":"raw";
export function axisRole(header: string, profile: ImportProfile): "x" | "y" | undefined {
  if(profile==="lsv")return isPotential(header)?"x":isCurrent(header)?"y":undefined;
  const h=header.trim().replace(/′/g,"'").replace(/["″“”]/g,"''").replace(/−/g,"-");
  if(profile==="eis") {
    if(/(?:^|\b)(?:zreal|zre)\d*(?:\b|[(/])|re\s*\(\s*z\s*\)|(?:^|\s)z\s*'(?!')/i.test(h))return "x";
    if(/(?:^|\b)(?:zimag|zim)\d*(?:\b|[(/])|im\s*\(\s*z\s*\)|(?:^|\s)-?\s*z\s*''/i.test(h))return "y";
    return;
  }
  if(/intensity|counts|cps|强度/i.test(h))return "y";
  if(profile==="xrd"&&/2\s*[-_]?\s*(?:theta|θ)|angle|衍射角/i.test(h))return "x";
  if(profile==="raman"&&/raman\s*shift|wavenumber|^shift|拉曼位移|波数/i.test(h))return "x";
}
const isPotential = (s: string) => /potential|voltage|电位|电压|^e\d*(?:\b|[(/])/i.test(s.trim());
const isCurrent = (s: string) => /current|电流|^i\d*(?:\b|[(/])|^j\d*(?:\b|[(/])/i.test(s.trim());
export function numberCell(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim().replace(/\u2212/g,"-");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(text)) return null;
  const n = Number(text.replace(/[dD]/,"e")); return Number.isFinite(n) ? n : null;
}
function fields(line: string, delimiter: string): string[] {
  if (delimiter === " ") return line.trim().split(/\s+/);
  const cells: string[] = []; let cell = "", quoted = false;
  for (let n=0;n<line.length;n++) { const c=line[n]; if (c==='"') { if (quoted && line[n+1]==='"') {cell+='"';n++;} else if (quoted) quoted=false; else if (!cell.trim()) quoted=true; else cell+=c; } else if (c===delimiter && !quoted) {cells.push(cell.trim());cell="";} else cell+=c; }
  cells.push(cell.trim()); return cells;
}
function tableFromGrid(grid: (string | number | null)[][], name: string, source: string, profile: ImportProfile = "lsv"): DataTable | null {
  const limit = 50000;
  let start = -1, header = -1;
  for (let n=0;n<grid.length;n++) { const cells = grid[n].map(String); if (cells.some(h=>axisRole(h,profile)==="x") && cells.some(h=>axisRole(h,profile)==="y") && !cells.some(c=>/peak|result|parameter|峰值|结果|参数/i.test(c)) && !cells.every(c=>numberCell(c)!==null)) { header=n; for (let j=n+1;j<Math.min(n+15,grid.length);j++) if (grid[j].filter(c=>numberCell(c)!==null).length>=2) {start=j;break;} if (start>=0) break; } }
  if (start<0) { for (let n=0;n<grid.length-1;n++) { if (grid[n].filter(c=>numberCell(c)!==null).length>=2 && grid[n+1].filter(c=>numberCell(c)!==null).length>=2) {start=n;break;} } if(start>0 && grid[start-1].length>=2 && grid[start-1].some(c=>numberCell(c)===null && String(c??"").trim())) header=start-1; }
  if(start<0) return null;
  const rows: (number|null)[][]=[]; let columns=2;
  for(let n=start;n<grid.length;n++) { const raw=grid[n]; if(raw.every(c=>!String(c??"").trim())) continue; const row=raw.map(numberCell); if(row.filter(c=>c!==null).length<2 && raw.some(c=>String(c??"").trim() && numberCell(c)===null && !/^(?:na|n\/a|nan|null|--?|—)$/i.test(String(c).trim()))) break; if(row.every(c=>c===null)) continue; if(row.length>64) throw new Error("数据超过 64 列，请只保留需要的电位和电流列"); columns=Math.max(columns,row.length);rows.push(row); if(rows.length>limit) throw new Error("单个数据表超过 50,000 行，请拆分文件后导入"); }
  if(rows.length<2) return null;
  const headers=Array.from({length:columns},(_,n)=>String(header>=0?grid[header][n]??"":"").trim() || `第 ${n+1} 列`);
  return {id:crypto.randomUUID(),source,name,headers,rows};
}
export function parseText(text: string, name="粘贴数据", source=name, profile:ImportProfile="lsv"): DataTable {
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(l=>l.trim());
  let best: { score: number; table: DataTable } | null=null;
  for(const delimiter of ["\t",",",";"," "]) { const grid=lines.map(l=>fields(l,delimiter));const table=tableFromGrid(grid,name,source,profile);if(!table) continue; const score=table.rows.reduce((sum,row)=>sum+row.filter(c=>c!==null).length,0) + table.headers.filter(h=>axisRole(h,profile)).length*100; if(!best||score>best.score) best={score,table}; }
  if(!best) throw new Error("未找到至少两行、两列有效数值。请检查分隔符和数值格式。");
  return best.table;
}
export function suggestedPairs(table: DataTable): ColumnPair[] {
  const potentials=table.headers.map((h,n)=>isPotential(h)?n:-1).filter(n=>n>=0), currents=table.headers.map((h,n)=>isCurrent(h)?n:-1).filter(n=>n>=0);
  const nameFor=(n:number,index:number)=>currents.length>1?`${table.name} · ${table.headers[n]}`:table.name;
  const unitFor=(n:number):CurrentUnit=>{const h=table.headers[n],density=/cm|厘米/i.test(h);if(/[uμµ]A/i.test(h))return density?"uA/cm2":"uA";if(/mA/i.test(h))return density?"mA/cm2":"mA";if(/nA/.test(h))return "nA";return density?"A/cm2":"A";};
  if(potentials.length===1 && currents.length) return currents.map((current,n)=>({e:potentials[0],current,name:nameFor(current,n),unit:unitFor(current)}));
  if(potentials.length>1 && currents.length) { const suffix=(h:string)=>/(?:potential|voltage|current|^[eij]|电位|电流|电压)\s*[_-]?(\d+)/i.exec(h)?.[1]; const pairs=potentials.map((e,n)=>{const key=suffix(table.headers[e]);const matches=key?currents.filter(i=>suffix(table.headers[i])===key):currents.filter(i=>i===e+1);return matches.length===1?{e,current:matches[0],name:`${table.name} · ${key??n+1}`,unit:unitFor(matches[0])}:null;});return pairs.every(p=>p!==null)?pairs as ColumnPair[]:[]; }
  return table.headers.length===2?[{e:0,current:1,name:table.name,unit:unitFor(1)}]:[];
}
export function pointsFor(table: DataTable, pair: ColumnPair): {points:Point[]; skipped:number} {
  if(pair.e===pair.current) throw new Error("电位列与电流列不能相同");
  if(/mV|μV|µV|uV/.test(table.headers[pair.e]))throw new Error(`“${pair.name}”的电位单位不是 V；请先换算为 V 后再导入。`);
  if(/(?:pA|kA|MA|nA.{0,15}cm)/.test(table.headers[pair.current]))throw new Error(`“${pair.name}”的电流单位暂不支持，请先换算为 A、mA 或 μA。`);
  let skipped=0;const points=table.rows.map(row=>{const e=row[pair.e],current=row[pair.current];if(e===null||current===null||e===undefined||current===undefined){skipped++;return null;}return {e,current};}).filter((p):p is Point=>p!==null);
  if(points.length<2) throw new Error(`“${pair.name}”不足两个有效的数据点`);
  return {points,skipped};
}
function xml(bytes:Uint8Array) { const doc=new DOMParser().parseFromString(strFromU8(bytes),"application/xml");if(doc.getElementsByTagName("parsererror").length)throw new Error("Excel XML 无法读取");return doc; }
function tags(root:Document|Element,name:string) {return Array.from(root.getElementsByTagNameNS("*",name));}
function colIndex(ref:string) {let n=0;for(const c of ref.toUpperCase().replace(/\d/g,""))n=n*26+c.charCodeAt(0)-64;return n-1;}
function resolvePart(base:string,target:string) {const parts=(target.startsWith("/")?target.slice(1):base+target).split("/");const output:string[]=[];for(const part of parts)if(part==="..")output.pop();else if(part&&part!==".")output.push(part);return output.join("/");}
export async function parseDataFile(file:File,profile:ImportProfile="lsv"):Promise<DataTable[]> {
  if(file.size>20*1024*1024)throw new Error("单个文件不能超过 20 MB");
  const bytes=new Uint8Array(await file.arrayBuffer()),name=file.name.replace(/\.[^.]+$/,"");
  if(/\.bin$/i.test(file.name)){if(profile==="eis")return [parseChiEisBin(bytes,name,file.name)];if(profile!=="lsv")throw new Error("此 BIN 读取器仅适用于已验证的辰华电化学格式，请为当前绘图类型导出文本。");return [parseChiLsvBin(bytes,name,file.name)];}
  if(!/\.xlsx$/i.test(file.name)) {if(!/\.(txt|csv|tsv|dat)$/i.test(file.name))throw new Error("请上传 TXT、辰华兼容 BIN、CSV、TSV、DAT 或 XLSX。");let text=new TextDecoder("utf-8").decode(bytes);if(text.includes("�"))text=new TextDecoder("gb18030").decode(bytes);return [parseText(text,name,file.name,profile)];}
  let total=0;
  const entries=unzipSync(bytes,{filter:entry=>{if(!/^xl\/.*\.xml$/.test(entry.name)&&entry.name!=="xl/_rels/workbook.xml.rels")return false;total+=entry.originalSize;if(total>80*1024*1024||entry.originalSize>40*1024*1024)throw new Error("Excel 解压后过大，请减少工作表或拆分文件");return true;}});
  if(!entries["xl/workbook.xml"]||!entries["xl/_rels/workbook.xml.rels"])throw new Error("不是可读取的 XLSX 工作簿");
  const strings=entries["xl/sharedStrings.xml"]?tags(xml(entries["xl/sharedStrings.xml"]),"si").map(si=>tags(si,"t").map(t=>t.textContent??"").join("")):[];
  const relation=tags(xml(entries["xl/_rels/workbook.xml.rels"]),"Relationship");const rels=new Map(relation.map(r=>[r.getAttribute("Id"),r.getAttribute("Target")??""]));
  const dateFormats=new Set<number>([14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58]);
  let dateStyles:number[]=[];if(entries["xl/styles.xml"]){const styles=xml(entries["xl/styles.xml"]);for(const format of tags(styles,"numFmt"))if(/[ymdhis]/i.test((format.getAttribute("formatCode")??"").replace(/"[^"]*"|\[[^\]]*\]/g,"")))dateFormats.add(Number(format.getAttribute("numFmtId")));const xfs=tags(styles,"cellXfs")[0];if(xfs)dateStyles=tags(xfs,"xf").map((xf,n)=>dateFormats.has(Number(xf.getAttribute("numFmtId")))?n:-1).filter(n=>n>=0);}
  const result:DataTable[]=[];
  for(const sheet of tags(xml(entries["xl/workbook.xml"]),"sheet")){const target=rels.get(sheet.getAttribute("r:id")||sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id"));if(!target)continue;const key=resolvePart("xl/",target),part=entries[key];if(!part)continue;const grid:(string|number|null)[][]=[];
    for(const row of tags(xml(part),"row")){const cells:(string|number|null)[]=[];for(const cell of tags(row,"c")){const n=colIndex(cell.getAttribute("r")??"");if(n<0||n>=64)continue;const type=cell.getAttribute("t"),value=tags(cell,"v")[0]?.textContent??"";if(tags(cell,"f").length&&!value)throw new Error("Excel 公式没有缓存值，请在 Excel 中重新计算并保存后导入");if(type==="s")cells[n]=strings[Number(value)]??"";else if(type==="inlineStr")cells[n]=tags(cell,"t").map(t=>t.textContent??"").join("");else if(type==="str")cells[n]=value;else if(["b","e","d"].includes(type??"")||dateStyles.includes(Number(cell.getAttribute("s")??-1)))cells[n]=null;else cells[n]=numberCell(value);}grid.push(Array.from({length:cells.length},(_,n)=>cells[n]??null));if(grid.length>50200)throw new Error("工作表超过 50,000 行，请拆分后导入");}
    const sheetName=sheet.getAttribute("name")??"工作表";const table=tableFromGrid(grid,`${name} · ${sheetName}`,file.name,profile);if(table)result.push(table);
  }
  if(!result.length)throw new Error("Excel 中未找到至少两列有效数值。");return result;
}

export function rawPairs(table:DataTable,profile:ImportProfile):ColumnPair[] {
  const xs=table.headers.map((h,n)=>axisRole(h,profile)==="x"?n:-1).filter(n=>n>=0);
  const ys=table.headers.map((h,n)=>axisRole(h,profile)==="y"?n:-1).filter(n=>n>=0);
  // Our EIS export includes raw Z″ and its derived −Z″ beside the same X.
  // Reimport that pair once instead of creating two copies of one sample.
  const sameImaginary=(a:string,b:string)=>a.replace(/[-−\s]/g,"")===b.replace(/[-−\s]/g,"");
  if(profile==="eis"&&xs.length===1&&ys.length===2&&ys[0]===xs[0]+1&&ys[1]===xs[0]+2&&sameImaginary(table.headers[ys[0]],table.headers[ys[1]]))return [{e:xs[0],current:ys[0],name:table.name,unit:"A"}];
  if(xs.length===1&&ys.length)return ys.map(y=>({e:xs[0],current:y,name:ys.length===1?table.name:`${table.name} · ${table.headers[y]}`,unit:"A"}));
  if(xs.length>1&&xs.every(x=>ys.includes(x+1)))return xs.map((x,n)=>({e:x,current:x+1,name:profile==="eis"?table.headers[x].replace(/\s*(?:zreal\d*|zre\d*|z\s*[′'])(?:.*)$/i,"").trim()||`${table.name} · ${n+1}`:`${table.name} · ${n+1}`,unit:"A"}));
  return table.headers.length===2&&!(profile==="eis"&&table.headers.some(isBodeColumn))?[{e:0,current:1,name:table.name,unit:"A"}]:[];
}
export function rawPointsFor(table:DataTable,pair:ColumnPair):{points:Point[];skipped:number} {
  if(pair.e===pair.current)throw new Error("X 列与 Y 列不能相同");
  let skipped=0;
  const points=table.rows.flatMap(row=>{const e=row[pair.e],current=row[pair.current];if(e==null||current==null||!Number.isFinite(e)||!Number.isFinite(current)){skipped++;return [];}return [{e,current}];});
  if(points.length<2)throw new Error(`“${pair.name}”不足两个有效数据点`);
  return {points,skipped};
}
