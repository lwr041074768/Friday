import { XRD_REFERENCE_COLORS, type ReferenceCard, type ReferencePeak } from "./xrd-reference-types";

export const JADE_CLIPBOARD_PREFIX = "SCIENTIFIC_PLOT_JADE_V1\n";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD=/^\d{2}-\d{3}-\d{4}$/;
type JadePacket={schema:"jade-card/v1";requestId:string;cardNumber:string;text:string;wavelength:number};

/** Read a copied JADE 9 card table, never OCR or a card-number database guess. */
export function parseJadeCardText(text:string, sourceWavelength?:number):ReferenceCard {
  if(typeof text!=="string"||text.length>1_000_000)throw Error("JADE 卡片内容过长。");
  const lines=text.replace(/^\ufeff/,"").split(/\r?\n/);
  const caption=lines[0]?.trim(),cardNumber=caption?.match(/^PDF#(\d{2}-\d{3}-\d{4}):/i)?.[1];
  if(!cardNumber)throw Error("未读到 JADE 标准卡片标题，请打开卡片详细窗口。");
  const headerIndex=lines.findIndex(line=>/^2[θϑ]\s*\t\s*d\(/i.test(line));
  if(headerIndex<0)throw Error("卡片缺少完整峰表，请在 JADE 打开“峰线”页签后重试。");
  const headers=lines[headerIndex].split("\t").map(s=>s.trim());
  if(!/^I\(/i.test(headers[2]??"")||!/^\(\s*h\s+k\s+l\s*\)$/i.test(headers[3]??""))throw Error("这张卡片的峰表格式暂不支持，请核对 JADE 峰线表。");
  const copiedWave=Number(text.match(/波长\s*=\s*([\d.]+)/)?.[1]);
  const wavelength=sourceWavelength??copiedWave;
  if(!Number.isFinite(wavelength)||wavelength<=0||wavelength>10)throw Error("未读到有效的卡片波长。");
  if(Number.isFinite(copiedWave)&&Math.abs(wavelength-copiedWave)>0.001)throw Error("JADE 窗口与复制卡片的波长不一致，请重新读取。");
  const peaks:ReferencePeak[]=[];
  let qualified=0;
  for(const line of lines.slice(headerIndex+1)) {
    if(!line.trim())continue;
    const cells=line.split("\t").map(s=>s.trim());
    if(cells.length!==headers.length)throw Error("峰表行列不完整，未添加卡片。");
    const twoTheta=Number(cells[0]),d=Number(cells[1]);
    const qualifier=cells[2].match(/^([<>])?\s*(\d+(?:\.\d+)?)$/);
    if(!qualifier||!Number.isFinite(twoTheta)||twoTheta<=0||twoTheta>=180||!Number.isFinite(d)||d<=0)throw Error("峰表含无效峰位或强度，未添加卡片。");
    const intensity=Number(qualifier[2]);
    if(!Number.isFinite(intensity)||intensity<0||!/^\(\s*-?\d+\s+-?\d+\s+-?\d+\s*\)$/.test(cells[3]))throw Error("峰表强度或 hkl 无效，未添加卡片。");
    const sine=wavelength/(2*d);
    if(!(sine>0&&sine<1)||Math.abs(2*Math.asin(sine)*180/Math.PI-twoTheta)>0.03)throw Error("峰位与 d 值、波长不一致，未添加卡片。");
    if(peaks.length&&twoTheta<=peaks.at(-1)!.twoTheta)throw Error("峰线顺序异常，未添加卡片。");
    if(qualifier[1])qualified++;
    peaks.push({twoTheta,d,intensity,hkl:cells[3].replace(/[()]/g,"").trim(),...(qualifier[1]?{intensityQualifier:qualifier[1] as "<"|">"}:{})});
    if(peaks.length>4000)throw Error("单张卡片最多读取 4,000 条峰线。");
  }
  if(peaks.length<2||!peaks.some(peak=>peak.intensity>0))throw Error("未读到可绘制的完整峰表。");
  const warnings=["读自 JADE 的卡片峰表，数值精度沿用源表；卡片编号不用于猜测或替换数据。"];
  if(/计算值/.test(caption))warnings.push("源卡片标注为计算值，不能视为实测参考谱。");
  if(/I=\(未知\)/.test(caption))warnings.push("源卡片的强度质量标记为未知，保留 JADE 给出的相对强度。");
  if(qualified)warnings.push(`${qualified} 条峰线含强度上下限标记：峰棒使用界限值显示，鼠标提示保留 < 或 >，不表示精确强度。`);
  return {id:crypto.randomUUID(),name:lines[1]?.trim()||`JADE ${cardNumber}`,formula:lines[2]?.trim(),source:"jade",sourceId:cardNumber,sourceFile:"JADE 当前标准卡片",wavelength,peaks,warnings,citation:lines.filter(line=>/^文献:|^附注:/.test(line)).join("\n"),calculation:caption,visible:true,color:XRD_REFERENCE_COLORS[0],preserveSourceAngles:true};
}

/** Match the one pending click; stale clipboard packets are ignored. */
export function readJadeClipboardPacket(value:string, requestId:string):ReferenceCard|null {
  if(!UUID.test(requestId))throw Error("JADE 读取请求无效。");
  if(!value.startsWith(JADE_CLIPBOARD_PREFIX))return null;
  if(value.length>1_100_000)throw Error("JADE 传输内容过长。");
  const packet=JSON.parse(value.slice(JADE_CLIPBOARD_PREFIX.length)) as JadePacket;
  if(packet.requestId!==requestId)return null;
  const failure=(packet as JadePacket&{error?:unknown}).error;
  if(typeof failure==="string")throw Error(failure.slice(0,2048));
  if(packet.schema!=="jade-card/v1"||!CARD.test(packet.cardNumber)||typeof packet.text!=="string")throw Error("JADE 助手返回的数据格式不符。");
  const card=parseJadeCardText(packet.text,packet.wavelength);
  if(card.sourceId!==packet.cardNumber)throw Error("JADE 返回的卡号与峰表不一致。");
  return card;
}
