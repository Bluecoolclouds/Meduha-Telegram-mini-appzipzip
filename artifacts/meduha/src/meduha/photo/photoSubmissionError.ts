// Classify only the structured server code, never HTTP status or error text:
// balance, concurrency and pricing failures can all use the same 409 response.
export function isPhotoDailyLimitError(error: unknown): boolean {
  return (error as { data?: { code?: unknown } } | null)?.data?.code === 'DAILY_LIMIT_EXCEEDED';
}

export const PHOTO_DAILY_LIMIT_MESSAGE = 'При подтверждении сервер проверил дневной лимит заново: сейчас его недостаточно для этого пакета. После расчёта остаток мог измениться, например из-за другой генерации. Эта генерация не запущена. Пересчитай стоимость или уменьши число изображений в пакете и рассчитай заново. Новый расчёт не запускает генерацию — потребуется твоё подтверждение.';
