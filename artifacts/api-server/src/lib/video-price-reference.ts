// Verified against model-specific playground pricing, not discounted comparison
// tables. These rates do not set administrator prices or enable any spending.
export const videoPriceReference = {
  reviewedAt: '2026-10-26',
  seedanceRates: (['480p', '720p', '1080p'] as const).flatMap(resolution => [
    { resolution, videoInput: false, usdPer1000Tokens: resolution === '1080p' ? 0.0234 : 0.0214 },
    { resolution, videoInput: true, usdPer1000Tokens: resolution === '1080p' ? 0.01404 : 0.01284 },
  ]),
  genjutsuRates: (['genjutsu', 'object-swap', 'restyle'] as const).flatMap(scenario =>
    (['480p', '720p', '1080p'] as const).map((resolution, index) => ({
      scenario, resolution, usdPerSecond: [0.318, 0.681, 1.632][index], exact: scenario !== 'restyle',
    }))),
  klingRates: [
    { endpoint: 'kling-video/v3.0/std/text-to-video', usdPerSecondMin: 0.084, usdPerSecondMax: 0.084,
      note: 'Опубликованная стандартная ставка без рекламной скидки. Точный итог — из сметы аккаунта.' },
    { endpoint: 'kling-video/v3.0/std/image-to-video', usdPerSecondMin: 0.084, usdPerSecondMax: 0.126,
      note: 'Опубликован диапазон стандартных ставок. Зависимость от всех настроек не подтверждена — выбирать ставку вручную по звуку нельзя; используется смета аккаунта.' },
  ],
  sources: [
    'https://docs.higgsfield.ai/docs/concepts/billing-and-retention',
    ...['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit', 'video-extend']
      .map(mode => `https://open.higgsfield.ai/models/bytedance/seedance-2.5/${mode}/playground`),
    ...['motion-transfer', 'object-swap', 'restyle']
      .map(mode => `https://open.higgsfield.ai/models/higgsfield/genjutsu/${mode}/v1.0/playground`),
    'https://open.higgsfield.ai/models/kling-video/v3.0/std/text-to-video/playground',
    'https://open.higgsfield.ai/models/kling-video/v3.0/std/text-to-video/api-reference',
    'https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/playground',
    'https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/api-reference',
  ],
  notes: [
    'Seedance: ceil(высота × ширина × (входные + выходные секунды) × 24 / 1024) видеотокенов. Изображения и аудио не считаются входным видео.',
    'Ставки указаны до индивидуальных скидок. Для Seedance итог берётся из сметы авторизованного аккаунта по тем же параметрам.',
    'Genjutsu: длительность исходного видео проверяется сервером, округляется вверх и ограничивается 30 секундами.',
    'Ставки Restyle опубликованы как приблизительные; автоматическое заполнение точных тарифов для него недоступно.',
    'Курс USD в кредиты задаёт администратор. Просмотр справки и подготовка черновика тарифов не включают списания.',
    'Kling 3.0 Standard: Input Schema допускает 3–15 секунд. Упоминание 1 секунды в прайсе не расширяет допустимый ввод.',
    'Рекламная скидка 50% на страницах Kling не назначается автоматически. Точная стоимость всех настроек берётся из сметы аккаунта.',
  ],
};
