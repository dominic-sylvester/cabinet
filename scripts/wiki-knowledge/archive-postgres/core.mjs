import { createHash } from 'node:crypto';
export const VERSION = 1;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function stableId(path) {
  const h = sha256(`cabinet-wiki:v1:${path}`);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function chunks(text, max = 12288) {
  const result = []; let part = ''; let bytes = 0;
  // Preserve all separators, and prefer paragraph boundaries when possible.
  for (const paragraph of text.split(/(?<=\n\n)/u)) {
    const size = Buffer.byteLength(paragraph);
    if (part && bytes + size > max) { result.push(part); part = ''; bytes = 0; }
    for (const ch of paragraph) {
      const n = Buffer.byteLength(ch);
      if (bytes + n > max) { result.push(part); part = ''; bytes = 0; }
      part += ch; bytes += n;
    }
  }
  if (part) result.push(part);
  return result;
}
export function makeRow(path, bytes) {
  let text = null, reason = null;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { reason = 'invalid_utf8'; }
  const search_text = text === null ? null : text.replaceAll('\0', '');
  if (text?.includes('\0')) { reason = 'nul'; text = null; }
  return { id: stableId(path), path, category: path.includes('/') ? path.split('/')[0] : '(root)',
    sha256: sha256(bytes), bytes: bytes.length, raw: bytes.toString('base64'), text,
    search_text, searchable: search_text !== null, reason, chunks: search_text === null ? [] : chunks(search_text) };
}
export function metadata(row) {
  return { id: row.id, path: row.path, category: row.category,
    sha256: row.sha256, bytes: row.bytes, searchable: row.searchable, reason: row.reason };
}
export const manifestDigest = rows => sha256(rows.map(r => JSON.stringify(metadata(r))).join('\n'));
export const sqlText = value => `convert_from(decode('${Buffer.from(String(value)).toString('base64')}','base64'),'UTF8')`;
export const sqlJson = value => `${sqlText(JSON.stringify(value))}::jsonb`;
export function positive(value, fallback, max = 10000000) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(`Invalid integer: ${value}`);
  return n;
}
