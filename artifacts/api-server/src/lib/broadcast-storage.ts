import { objectStorageClient } from './objectStorage';

export function broadcastFile(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid media ID');
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error('App Storage is not configured');
  const [bucket, ...prefix] = root.replace(/^\/+|\/+$/g, '').split('/');
  return objectStorageClient.bucket(bucket).file(`${prefix.join('/')}/broadcasts/${id}`);
}
export function checkBroadcastMedia(type: string, bytes: Buffer): 'photo' | 'video' {
  if (!bytes.length) throw new Error('Пустой файл.');
  if (['image/png', 'image/jpeg'].includes(type)) {
    if (bytes.length > 10 * 1024 * 1024) throw new Error('Фото должно быть до 10 МБ.');
    const valid = type === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid) throw new Error('Содержимое файла не соответствует формату фото.');
    return 'photo';
  }
  if (type === 'video/mp4' && bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.length <= 50 * 1024 * 1024) return 'video';
  throw new Error('Поддерживаются JPEG/PNG до 10 МБ и MP4 до 50 МБ.');
}
