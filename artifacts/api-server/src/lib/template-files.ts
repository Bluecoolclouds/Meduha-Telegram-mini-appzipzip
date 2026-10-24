import { randomUUID } from 'node:crypto';
import { templateFile } from './objectStorage';
import { DOCUMENT_TYPES, hasDocumentSignature } from './document-files';

export function hasMediaSignature(bytes: Buffer, type: string) {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (type === 'video/mp4' || type === 'video/quicktime') return bytes.toString('ascii', 4, 8) === 'ftyp';
  if (type === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (type === 'audio/wav' || type === 'audio/x-wav') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
  if (type === 'audio/mpeg') {
    const id3 = bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'ID3'
      && bytes[3] >= 2 && bytes[3] <= 4 && bytes.subarray(6, 10).every(byte => byte < 128);
    const frame = bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0
      && (bytes[1] & 0x18) !== 8 && (bytes[1] & 6) !== 0
      && (bytes[2] & 0xf0) !== 0 && (bytes[2] & 0xf0) !== 0xf0 && (bytes[2] & 12) !== 12;
    return id3 || frame;
  }
  return false;
}

export class InvalidMediaError extends Error {}
export async function finalizeMedia(id: string, size: number, type: string) {
  const staging = templateFile(id, true);
  // Copy first: validation and serving refer to the same immutable generation,
  // even if the short-lived staging PUT URL is used again.
  const snapshot = templateFile(randomUUID(), true);
  try {
    await staging.copy(snapshot);
    const [metadata] = await snapshot.getMetadata();
    if (Number(metadata.size) !== size || metadata.contentType !== type) {
      throw new InvalidMediaError('Размер или тип загруженного файла не совпадает с выбранным.');
    }
    const isDocument = DOCUMENT_TYPES.includes(type);
    if (isDocument && size > 10 * 1024 * 1024) throw new InvalidMediaError('Документ должен быть не больше 10 МБ.');
    const [bytes] = await snapshot.download({ start: 0, end: isDocument ? size - 1 : Math.min(31, size - 1) });
    if (!(isDocument ? hasDocumentSignature(bytes, type) : hasMediaSignature(bytes, type))) throw new InvalidMediaError('Содержимое файла не соответствует формату.');
    await snapshot.copy(templateFile(id));
    await staging.delete({ ignoreNotFound: true });
  } catch (caught) {
    if (caught instanceof InvalidMediaError) {
      // Invalid uploads cannot be completed on retry, so release their staging
      // object. Storage/read errors are deliberately left untouched for retry.
      await staging.delete({ ignoreNotFound: true });
    }
    throw caught;
  } finally {
    await snapshot.delete({ ignoreNotFound: true }).catch(() => undefined);
  }
}
