import { isDirectVideoScenario, videoScenarioGenerationHref } from './scenarioGeneration.ts';

export type VideoScenario = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  category: 'characters' | 'editing' | 'creation' | 'business';
  availability: 'documented' | 'workflow' | 'mcp';
  providerLabel: string;
  endpoint?: string;
  source: string;
  requirements: string;
  explanation: string;
  prompt: string;
  keywords: string[];
};

// Public documentation, not a promise of account access or live Mini App generation.
export const videoScenarios: VideoScenario[] = [
  {
    id: 'ai-blogger', title: 'ИИ блогер', subtitle: 'Свой персонаж для историй и роликов',
    image: 'fashion', category: 'characters', availability: 'documented',
    providerLabel: 'Сценарий персонажа', endpoint: 'higgsfield/ai-influencer',
    source: 'https://open.higgsfield.ai/models/higgsfield/ai-influencer/api-reference',
    requirements: 'Описание персонажа; при необходимости — фото с разрешением на использование лица. Для анимации нужен отдельный видеореференс.',
    explanation: 'Создание персонажа и ролика доступны отдельными шагами. Модель персонажа создаёт изображение-лист, а не готовое видео; для ролика нужно добавить готовое фото в видеостудии. Автоматическая цепочка не запускается.',
    prompt: 'Персонаж для ИИ-блога: внешность, характер, одежда и тема канала. Идея первого ролика:',
    keywords: ['блогер', 'блог', 'инфлюенсер', 'influencer', 'персонаж', 'аватар', 'ведущий', 'лицо', 'ugc', 'двойник', 'человек'],
  },
  {
    id: 'katana', title: 'Катана', subtitle: 'Повторить монтаж по видеореференсу',
    image: 'car', category: 'editing', availability: 'mcp', providerLabel: 'Katana · MCP / Claude',
    source: 'https://higgsfield.ai/blog/higgsfield-katana',
    requirements: 'Видео с разрешением на использование, до пяти фото персонажей или предметов и пожелания к монтажу.',
    explanation: 'Здесь можно подготовить бриф монтажа, но запуск этого сценария пока недоступен.',
    prompt: 'Бриф монтажа по референсу: порядок сцен, ритм, персонажи или товар, что сохранить и что заменить.',
    keywords: ['катана', 'katana', 'монтаж', 'эдит', 'edit', 'референс', 'повторить', 'склейки', 'ритм'],
  },
  {
    id: 'content-factory', title: 'Контент-завод', subtitle: 'От одной идеи к серии публикаций',
    image: 'perfume', category: 'business', availability: 'workflow', providerLabel: 'Составной сценарий',
    source: 'https://higgsfield.ai/higgsfield-api',
    requirements: 'Описание продукта, аудитория, площадка, количество идей и нужные форматы.',
    explanation: 'Это цепочка: идеи → сценарии → персонаж или товар → ролики. По брифу можно отдельно открыть создание одного ролика. Пакетная генерация и автопубликация не подключены.',
    prompt: 'Контент-план: продукт, аудитория, площадка, ключевое сообщение. Подготовить серию идей для коротких роликов:',
    keywords: ['контент', 'завод', 'фабрика', 'серия', 'массово', 'пакет', 'реклама', 'продажи', 'маркетинг', 'товар', 'бизнес', 'публикации', 'reels', 'рилс', 'shorts', 'tiktok'],
  },
  {
    id: 'genjutsu', title: 'Джиуджитсу', subtitle: 'Перенести движение на своего героя',
    image: 'astronaut', category: 'characters', availability: 'documented',
    providerLabel: 'Genjutsu · Motion transfer', endpoint: 'higgsfield/genjutsu/motion-transfer/v1.0',
    source: 'https://docs.higgsfield.ai/docs/models/genjutsu/motion-transfer',
    requirements: 'Исходное видео от 4 секунд и 1–8 фото-референсов. Видео длиннее 30 секунд обрезается провайдером.',
    explanation: 'Официальное название — Genjutsu. Переносит движения из видео на персонажа по фото. В Meduha цена рассчитывается после серверной проверки длительности видео с учётом сценария и выбранного качества.',
    prompt: 'Перенести движения из видеореференса на моего персонажа. Сохранить композицию и описать нужные отличия:',
    keywords: ['джиуджитсу', 'джиу', 'гендзюцу', 'genjutsu', 'jujutsu', 'дженджутсу', 'движение', 'танец', 'танцевать', 'повторять', 'повторял', 'персонаж', 'motion', 'анимация', 'пластика'],
  },
  {
    id: 'text-to-video', title: 'Видео из текста', subtitle: 'Опиши сцену — создай видео',
    image: 'mountain', category: 'creation', availability: 'documented',
    providerLabel: 'Seedance 2.5', endpoint: 'bytedance/seedance-2.5/text-to-video',
    source: 'https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference',
    requirements: 'Текстовое описание. API поддерживает 4–30 секунд, 480p, 720p и 1080p.',
    explanation: 'Открывает студию генерации с описанием сцены и выбором видеомодели. Доступность, настройки и цена проверяются до запуска.',
    prompt: 'Кинематографичная сцена: место, герой, действие, свет и движение камеры.',
    keywords: ['текст', 'описание', 'промпт', 'prompt', 'seedance', 'сгенерировать', 'создать', 'закат', 'сцена'],
  },
  {
    id: 'image-to-video', title: 'Оживить фото', subtitle: 'Добавь движение одному кадру',
    image: 'portrait', category: 'creation', availability: 'documented',
    providerLabel: 'Seedance 2.5 · Image to Video', endpoint: 'bytedance/seedance-2.5/image-to-video',
    source: 'https://open.higgsfield.ai/models/bytedance/seedance-2.5/image-to-video/api-reference',
    requirements: 'Начальное изображение и описание движения. Конечное изображение — необязательный параметр API.',
    explanation: 'Открывает отдельный режим генерации видео по исходному изображению. Загрузи фото и опиши движение в студии; обязательные исходники зависят от выбранной модели.',
    prompt: 'Оживить исходное фото: что двигается в кадре, как движется камера, какое настроение сохранить.',
    keywords: ['оживить', 'фото', 'изображение', 'картинка', 'кадр', 'image', 'анимировать', 'photo'],
  },
  {
    id: 'object-swap', title: 'Замена объектов', subtitle: 'Другой товар, одежда или герой в кадре',
    image: 'perfume', category: 'editing', availability: 'documented',
    providerLabel: 'Genjutsu · Object swap', endpoint: 'higgsfield/genjutsu/object-swap/v1.0',
    source: 'https://docs.higgsfield.ai/docs/models/genjutsu/object-swap',
    requirements: 'Видео от 4 секунд и 1–8 фото предметов или персонажей. Исходный кадр — не менее 409 600 пикселей.',
    explanation: 'Заменяет элементы в исходном видео с опорой на фотографии. API описан, но не подключён к пользовательскому редактору Meduha.',
    prompt: 'Заменить объект в исходном видео: какой элемент меняем, на что и какие детали сохранить.',
    keywords: ['заменить', 'замена', 'объект', 'swap', 'одежда', 'предмет', 'продукт', 'переодеть'],
  },
  {
    id: 'restyle', title: 'Новый стиль видео', subtitle: 'Та же сцена — другое визуальное решение',
    image: 'city', category: 'editing', availability: 'documented',
    providerLabel: 'Genjutsu · Restyle', endpoint: 'higgsfield/genjutsu/restyle/v1.0',
    source: 'https://docs.higgsfield.ai/docs/models/genjutsu/restyle',
    requirements: 'Видео от 4 секунд до 200 МиБ и актуальный preset_id из каталога стилей провайдера. До пяти фото персонажей — необязательно.',
    explanation: 'Меняет визуальный стиль видео, сохраняя основу движения. Перед запуском требуется получить действующий preset_id; один промпт его не заменяет. Генерация в Meduha не подключена.',
    prompt: 'Изменить визуальный стиль исходного видео. Желаемая эстетика, важные черты персонажа и что сохранить:',
    keywords: ['стиль', 'стилизация', 'аниме', 'мультфильм', 'рисованный', 'restyle', 'анимационный', 'визуальный'],
  },
  {
    id: 'cinema', title: 'Киносцена', subtitle: 'Камера, свет и режиссура одного эпизода',
    image: 'car', category: 'creation', availability: 'documented',
    providerLabel: 'Cinema Studio 4.0', endpoint: 'higgsfield/cinema-studio/4.0',
    source: 'https://docs.higgsfield.ai/docs/models/cinema-studio-4/generate',
    requirements: 'Описание сцены. Референсы и параметры режиссуры — необязательные настройки API.',
    explanation: 'Открывает студию генерации новой киносцены с управлением эпохой, жанром, светом и темпом. Это создание нового видео, не монтаж готового фильма.',
    prompt: 'Киносцена: жанр, эпоха, герой, действие, освещение, темп и движение камеры.',
    keywords: ['кино', 'фильм', 'cinema', 'режиссёр', 'режиссер', 'камера', 'свет', 'нуар', 'трейлер', 'кинематографичный'],
  },
];

// Provider IDs are the first segment of documented upstream model IDs.
// Composite/workflow cards without an endpoint are not listed as API providers.
export function scenarioProvider(scenario: VideoScenario): string | null {
  const provider = scenario.endpoint?.split('/').filter(Boolean)[0]?.toLowerCase();
  return provider || null;
}

export const videoScenarioProviders = [...new Set(videoScenarios.map(scenarioProvider).filter((provider): provider is string => Boolean(provider)))].sort();

export function videoScenarioProviderLabel(provider: string): string {
  if (provider === 'bytedance') return 'ByteDance';
  if (provider === 'higgsfield') return 'Модель Meduha';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

const stopWords = new Set(['хочу', 'нужно', 'надо', 'мне', 'для', 'как', 'сделать', 'чтобы', 'это', 'видео', 'ролик', 'свой', 'моего', 'мою', 'моё', 'мой']);
const normalize = (value: string) => value.toLowerCase().replaceAll('ё', 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const stem = (word: string) => word.length > 5 ? word.slice(0, -2) : word;

export function searchVideoScenarios(query: string): VideoScenario[] {
  const tokens = normalize(query).split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
  if (!tokens.length) return videoScenarios;
  return videoScenarios.map((scenario, index) => {
    const title = normalize(scenario.title);
    const keywords = scenario.keywords.map(normalize);
    const text = normalize(`${scenario.title} ${scenario.subtitle} ${scenario.providerLabel}`);
    const score = tokens.reduce((total, token) => total +
      (title.includes(token) ? 8 : keywords.some(k => k.includes(token) || stem(k) === stem(token)) ? 5 : text.includes(token) ? 1 : 0), 0);
    return { scenario, score, index };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.scenario);
}

export function scenarioDraftHref(scenario: VideoScenario, idea = ''): string {
  const prompt = `${scenario.prompt}${idea.trim() ? `\n\nМоя задача: ${idea.trim().slice(0, 1500)}` : ''}`;
  if (isDirectVideoScenario(scenario.id)) return videoScenarioGenerationHref(scenario, { prompt });
  const query = new URLSearchParams({ type: 'video', editor: '1', preset: scenario.title, scenario: scenario.id, prompt });
  return `/create?${query.toString()}`;
}
