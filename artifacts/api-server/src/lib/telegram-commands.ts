import type { TelegramApi } from './telegram-api';

export type TelegramUpdate = {
  update_id: number;
  message?: { text?: string; chat?: { id: number; type: string } };
};

function commandOf(update: TelegramUpdate) {
  return update.message?.text?.match(/^\/(start|help)(?:@([a-zA-Z0-9_]+))?(?:\s|$)/i);
}

/** Coalesce commands retried before the bot was online; don't greet a chat repeatedly. */
export function pendingCommands(updates: TelegramUpdate[]) {
  const latest = new Map<number, number>();
  for (const update of updates) {
    if (commandOf(update) && update.message?.chat) latest.set(update.message.chat.id, update.update_id);
  }
  return updates.filter(update => !commandOf(update) || !update.message?.chat || latest.get(update.message.chat.id) === update.update_id);
}

export function createTelegramCommandHandler(api: TelegramApi, username: string, recordFirstUser?: (id: string) => Promise<void>) {
  return async (update: TelegramUpdate) => {
    const match = commandOf(update), chat = update.message?.chat;
    if (!match || !chat || !Number.isSafeInteger(chat.id)) return;
    if (match[2] && match[2].toLowerCase() !== username.toLowerCase()) return;
    if (chat.type !== 'private') {
      await api('sendMessage', { chat_id: chat.id, text: 'Открой личный чат с meduha, чтобы запустить студию.', reply_markup: { inline_keyboard: [[{ text: 'Перейти к боту', url: `https://t.me/${username}` }]] } });
      return;
    }
    if (chat.id > 0) await recordFirstUser?.(String(chat.id));
    let appUrl: string | null = null;
    let menuAvailable = true;
    try {
      const menu = await api('getChatMenuButton') as { type?: string; web_app?: { url?: string } };
      if (menu.type === 'web_app' && menu.web_app?.url) {
        const url = new URL(menu.web_app.url);
        if (url.protocol === 'https:' && !url.username && !url.password) appUrl = url.href;
      }
    } catch { menuAvailable = false; }
    const introduction = 'Привет! Я meduha — твоя творческая студия для идей фото, видео и музыки.';
    const details = appUrl
      ? 'Открой студию кнопкой ниже. Вход через Telegram произойдёт автоматически, затем загрузятся твой профиль и сохранённые идеи.'
      : menuAvailable
        ? 'Бот уже на связи. Миниапп ещё не опубликован, поэтому кнопка открытия студии пока недоступна. После подключения постоянного адреса здесь появится вход в meduha.'
        : 'Бот на связи, но сейчас не удалось получить ссылку на студию. Попробуй /start немного позже.';
    await api('sendMessage', {
      chat_id: chat.id, text: `${introduction}\n\n${details}`,
      ...(appUrl ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть meduha', web_app: { url: appUrl } }]] } } : {}),
    });
  };
}
