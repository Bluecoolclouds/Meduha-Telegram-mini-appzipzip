export type BroadcastButton = { text: string; url: string; kind: 'url' | 'web_app' };
export type BroadcastContent = { title: string; text: string; mediaId?: string | null; buttons: BroadcastButton[] };
export function parseBroadcast(value: unknown): BroadcastContent {
  if (!value || typeof value !== 'object') throw new Error('Неверный пост.');
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 100) throw new Error('Название: от 1 до 100 символов.');
  if (typeof v.text !== 'string' || !v.text.trim() || v.text.length > (v.mediaId ? 1024 : 4096)) throw new Error('Текст: до 4096 символов, с медиа — до 1024.');
  if (v.mediaId != null && (typeof v.mediaId !== 'string' || !/^[a-f0-9-]{36}$/.test(v.mediaId))) throw new Error('Неверное медиа.');
  if (!Array.isArray(v.buttons) || v.buttons.length > 6) throw new Error('Допустимо до 6 кнопок.');
  const buttons = v.buttons.map((raw): BroadcastButton => {
    if (!raw || typeof raw !== 'object') throw new Error('Неверная кнопка.');
    const b = raw as Record<string, unknown>;
    if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 64 || typeof b.url !== 'string' || b.url.length > 2048 || !['url', 'web_app'].includes(String(b.kind))) throw new Error('Проверь название, тип и адрес кнопки.');
    const url = new URL(b.url);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) throw new Error('Для кнопок нужен публичный HTTPS-адрес.');
    return { text: b.text.trim(), url: url.href, kind: b.kind as BroadcastButton['kind'] };
  });
  return { title: v.title.trim(), text: v.text, mediaId: v.mediaId as string | null | undefined, buttons };
}
export function broadcastParameters(text: string, buttons: BroadcastButton[], chatId: string, kind?: string, media?: string | Blob) {
  return {
    chat_id: chatId,
    ...(kind ? { [kind]: media, caption: text, ...(kind === 'video' ? { supports_streaming: true } : {}) } : { text }),
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons.map(b => [{ text: b.text, ...(b.kind === 'web_app' ? { web_app: { url: b.url } } : { url: b.url }) }]) } } : {}),
  };
}
