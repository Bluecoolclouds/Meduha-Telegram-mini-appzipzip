import { randomUUID } from 'node:crypto';
import { GenerationVideoValidationError, objectStorageClient, validateProviderUrl } from './objectStorage';

export class PhotoResultValidationError extends GenerationVideoValidationError {}
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const types = ['image/png', 'image/jpeg', 'image/webp'];
export function generationImageFile(id: string, index: number) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(index) || index < 0 || index > 7) throw new Error('Invalid photo result ID');
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error('App Storage is not configured');
  const [bucket, ...prefix] = root.replace(/^\/+|\/+$/g, '').split('/');
  return objectStorageClient.bucket(bucket).file(`${prefix.join('/')}/generation-results/${id}/${index}.image`);
}
export function checkPhotoHeader(type: string, bytes: Buffer) {
  const valid = bytes.length >= 12 && (
    type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    || type === 'image/webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'
  );
  if (!valid) throw new PhotoResultValidationError('Invalid provider image bytes');
}
export async function downloadProviderPhoto(source: string, fetcher: typeof fetch = fetch) {
  let url = await validateProviderUrl(source);
  for (let redirect = 0; redirect < 4; redirect++) {
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { Accept: types.join(','), 'Accept-Encoding': 'identity' } });
    if ([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const next = response.headers.get('location');
      if (!next) throw new PhotoResultValidationError('Missing image redirect');
      url = await validateProviderUrl(new URL(next, url).href); continue;
    }
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const declared = response.headers.get('content-length');
    const length = declared === null ? null : Number(declared);
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      if (response.status >= 500 || response.status === 429) throw new Error('Image temporarily unavailable');
      throw new PhotoResultValidationError('Provider image unavailable');
    }
    if (!types.includes(type) || (length !== null && (!Number.isSafeInteger(length) || length < 12 || length > MAX_PHOTO_BYTES))) {
      await response.body.cancel(); throw new PhotoResultValidationError('Invalid provider image metadata');
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_PHOTO_BYTES || (length !== null && size > length)) throw new PhotoResultValidationError('Image exceeds size limit');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    if (length !== null && size !== length) throw new PhotoResultValidationError('Incomplete provider image');
    const bytes = Buffer.concat(chunks);
    checkPhotoHeader(type, bytes);
    return { bytes, type };
  }
  throw new PhotoResultValidationError('Too many provider redirects');
}
export async function storeGenerationImages(id: string, urls: string[]) {
  if (!urls.length || urls.length > 8) throw new PhotoResultValidationError('Invalid number of result images');
  const paths: string[] = [];
  for (let index = 0; index < urls.length; index++) {
    const final = generationImageFile(id, index);
    const [exists] = await final.exists();
    if (!exists) {
      const { bytes, type } = await downloadProviderPhoto(urls[index]);
      const temp = final.bucket.file(`${final.name}.tmp.${randomUUID()}`);
      try {
        await temp.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: type, cacheControl: 'private, no-store' } });
        try { await temp.copy(final, { preconditionOpts: { ifGenerationMatch: 0 } }); }
        catch (error) { if (![409,412].includes((error as { code: number }).code)) throw error; }
      } finally { await temp.delete({ ignoreNotFound: true }).catch(() => undefined); }
    }
    const [metadata] = await final.getMetadata();
    if (!types.includes(metadata.contentType ?? '') || Number(metadata.size) < 12 || Number(metadata.size) > MAX_PHOTO_BYTES) throw new PhotoResultValidationError('Stored photo invalid');
    paths.push(`/api/meduha/generations/${id}/images/${index}`);
  }
  return paths;
}

export async function storeChannelImage(id: string, image: { url?: string; b64_json?: string }) {
  if (!image.b64_json) {
    if (!image.url) throw new PhotoResultValidationError('No image');
    return storeGenerationImages(id, [image.url]);
  }
  const encoded = image.b64_json;
  if (encoded.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new PhotoResultValidationError('Invalid image payload');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 12 || bytes.length > MAX_PHOTO_BYTES) throw new PhotoResultValidationError('Invalid image size');
  const type = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : 'image/webp';
  checkPhotoHeader(type, bytes);
  const final = generationImageFile(id, 0);
  try {
    await final.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: type, cacheControl: 'private, no-store' } });
  } catch (error) {
    if (![409, 412].includes((error as { code: number }).code)) throw error;
  }
  const [metadata] = await final.getMetadata();
  if (!types.includes(metadata.contentType ?? '') || Number(metadata.size) < 12 || Number(metadata.size) > MAX_PHOTO_BYTES) throw new PhotoResultValidationError('Stored photo invalid');
  return [`/api/meduha/generations/${id}/images/0`];
}
