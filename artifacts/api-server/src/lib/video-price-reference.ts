// Verified against model-specific playground pricing, not discounted comparison
// tables. These rates do not set administrator prices or enable any spending.
export const videoPriceReference = {
  reviewedAt: '2026-10-25',
  seedanceRates: (['480p', '720p', '1080p'] as const).flatMap(resolution => [
    { resolution, videoInput: false, usdPer1000Tokens: resolution === '1080p' ? 0.0234 : 0.0214 },
    { resolution, videoInput: true, usdPer1000Tokens: resolution === '1080p' ? 0.01404 : 0.01284 },
  ]),
  genjutsuRates: (['genjutsu', 'object-swap', 'restyle'] as const).flatMap(scenario =>
    (['480p', '720p', '1080p'] as const).map((resolution, index) => ({
      scenario, resolution, usdPerSecond: [0.318, 0.681, 1.632][index], exact: scenario !== 'restyle',
    }))),
  sources: [
    'https://docs.higgsfield.ai/docs/concepts/billing-and-retention',
    ...['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit', 'video-extend']
      .map(mode => `https://open.higgsfield.ai/models/bytedance/seedance-2.5/${mode}/playground`),
    ...['motion-transfer', 'object-swap', 'restyle']
      .map(mode => `https://open.higgsfield.ai/models/higgsfield/genjutsu/${mode}/v1.0/playground`),
  ],
  notes: [
    'Seedance: ceil(высота × ширина × (входные + выходные секунды) × 24 / 1024) видеотокенов. Изображения и аудио не считаются входным видео.',
    'Ставки указаны до индивидуальных скидок. Для Seedance итог берётся из сметы авторизованного аккаунта по тем же параметрам.',
    'Genjutsu: длительность исходного видео проверяется сервером, округляется вверх и ограничивается 30 секундами.',
    'Ставки Restyle опубликованы как приблизительные; автоматическое заполнение точных тарифов для него недоступно.',
    'Курс USD в кредиты задаёт администратор. Просмотр справки и подготовка черновика тарифов не включают списания.',
  ],
};
