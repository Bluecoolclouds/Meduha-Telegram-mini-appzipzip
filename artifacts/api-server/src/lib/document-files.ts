export const DOCUMENT_TYPES = [
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/markdown', 'text/plain',
];
/** Bounded inspection only; documents are never executed or rendered as HTML. */
export function hasDocumentSignature(bytes: Buffer, type: string) {
  if (bytes.length > 10 * 1024 * 1024 || !bytes.length) return false;
  if (type === 'application/pdf') return bytes.toString('ascii', 0, 5) === '%PDF-' && bytes.subarray(-2048).includes(Buffer.from('%%EOF'));
  if (type === 'text/markdown' || type === 'text/plain') {
    try { return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return false; }
  }
  const required = type.includes('wordprocessingml') ? 'word/document.xml'
    : type.includes('spreadsheetml') ? 'xl/workbook.xml'
      : type.includes('presentationml') ? 'ppt/presentation.xml' : null;
  if (!required || bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < Math.max(0, bytes.length - 65557) || end + 22 > bytes.length) return false;
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) return false;
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16), expanded = 0;
  if (count > 2048 || cursor + bytes.readUInt32LE(end + 12) !== end) return false;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50 || (bytes.readUInt16LE(cursor + 8) & 1)) return false;
    expanded += bytes.readUInt32LE(cursor + 24);
    const length = bytes.readUInt16LE(cursor + 28);
    const next = cursor + 46 + length + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if (next > end || expanded > 100 * 1024 * 1024) return false;
    names.add(bytes.toString('utf8', cursor + 46, cursor + 46 + length));
    cursor = next;
  }
  return cursor === end && names.has(required) && names.has('[Content_Types].xml');
}
