/** Decode local measurement text without turning UTF-16 byte pairs into NULs. */
export function decodeMeasurementText(bytes: Uint8Array): string {
  let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8';
  else {
    // Instrument exports are mostly ASCII numbers. Detect BOM-less UTF-16 by
    // the consistent NUL-byte lane; require several printable byte pairs.
    const count = Math.min(Math.floor(bytes.length / 2), 512);
    let even = 0, odd = 0;
    for (let n = 0; n < count; n++) {
      if (bytes[n * 2] === 0 && bytes[n * 2 + 1] >= 9 && bytes[n * 2 + 1] <= 126) even++;
      if (bytes[n * 2 + 1] === 0 && bytes[n * 2] >= 9 && bytes[n * 2] <= 126) odd++;
    }
    if (count >= 8 && odd / count > 0.6 && even / count < 0.1) encoding = 'utf-16le';
    else if (count >= 8 && even / count > 0.6 && odd / count < 0.1) encoding = 'utf-16be';
  }
  if (encoding?.startsWith('utf-16') && bytes.length % 2) throw Error('UTF-16 文本不完整，请重新保存或导出该文件。');
  let text: string;
  try { text = new TextDecoder(encoding || 'utf-8', { fatal: true }).decode(bytes); }
  catch {
    if (encoding) throw Error('文本编码或内容不完整，请重新保存或导出该文件。');
    try { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
    catch { throw Error('无法识别文本编码，请另存为 UTF-8、Unicode 或 GBK 文本。'); }
  }
  if (text.includes('\0')) throw Error('文件包含二进制内容，请选择原始 BIN 文件，或重新导出纯文本数据。');
  return text.replace(/^\uFEFF/, '');
}
