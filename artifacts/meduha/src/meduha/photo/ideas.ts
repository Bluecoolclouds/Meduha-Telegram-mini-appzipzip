export type PhotoCategory = 'portrait' | 'editorial' | 'product' | 'cinema' | 'fantasy' | 'travel' | 'social';
export type PhotoIdea = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  category: PhotoCategory;
  prompt: string;
  keywords: string[];
};

export const photoCategories: { id: 'all' | PhotoCategory; label: string }[] = [
  { id: 'all', label: 'Все идеи' },
  { id: 'portrait', label: 'Портрет' },
  { id: 'editorial', label: 'Мода' },
  { id: 'product', label: 'Предметы' },
  { id: 'cinema', label: 'Кино' },
  { id: 'fantasy', label: 'Фантазия' },
  { id: 'travel', label: 'Путешествия' },
  { id: 'social', label: 'Для соцсетей' },
];

export const photoIdeas: PhotoIdea[] = [
  { id: 'golden-hour', title: 'Портрет в золотой час', subtitle: 'Мягкий свет, живой ветер и ощущение личного кино', image: 'portrait', category: 'portrait', prompt: 'Портрет девушки в золотой час: мягкий тёплый свет заката, лёгкий ветер в волосах, естественная выразительная поза, малая глубина резкости, кинематографичная цветокоррекция. Сохранить живое и естественное настроение.', keywords: ['портрет', 'девушка', 'закат', 'свет', 'фотосессия', 'человек'] },
  { id: 'editorial-noir', title: 'Редакционная съёмка', subtitle: 'Выразительный образ и контрастная студийная подача', image: 'fashion', category: 'editorial', prompt: 'Высокая модная редакционная съёмка: выразительный образ, фактурная одежда, уверенная поза, тёмный лаконичный фон, направленный студийный свет и журнальная композиция. Сдержанная палитра, тонкая детализация ткани.', keywords: ['мода', 'fashion', 'редакция', 'журнал', 'стиль', 'одежда', 'editorial'] },
  { id: 'perfume-campaign', title: 'Аромат как история', subtitle: 'Предметная реклама с дымкой и драматичным светом', image: 'perfume', category: 'product', prompt: 'Предметная рекламная фотография флакона духов на выразительной фактурной поверхности. Драматичный боковой свет, тонкая дымка, глубокие тени, чистый центр композиции и ощущение дорогой журнальной кампании. Не добавлять надписи или логотипы.', keywords: ['продукт', 'предмет', 'духи', 'парфюм', 'реклама', 'товар', 'флакон'] },
  { id: 'city-after-rain', title: 'Город после дождя', subtitle: 'Отражения, вечерний свет и один тихий момент', image: 'city', category: 'cinema', prompt: 'Кинематографичная городская сцена сразу после дождя: мокрая улица отражает вечерние огни, редкие прохожие вдали, глубокая перспектива, атмосферная дымка и выразительный свет. Кадр как стоп-кадр авторского фильма.', keywords: ['город', 'кино', 'сцена', 'ночь', 'дождь', 'фильм', 'cinema'] },
  { id: 'moon-garden', title: 'Сад на другой планете', subtitle: 'Неземной пейзаж с цветами и мягким свечением', image: 'flower', category: 'fantasy', prompt: 'Фантазийная иллюстрация сада на далёкой планете: необычные цветы, плавные формы, лёгкое свечение в сумерках и слоистый дальний план. Поэтичная атмосфера, богатые детали, цельная композиция без текста.', keywords: ['фантазия', 'цветы', 'сад', 'иллюстрация', 'космос', 'сказка', 'другая планета'] },
  { id: 'mountain-route', title: 'Туда, где выше облаков', subtitle: 'Путешествие в горы на рассвете', image: 'mountain', category: 'travel', prompt: 'Пейзаж для тревел-истории: горная дорога уходит к облакам на рассвете, холодный воздух, тёплая полоска солнца на вершинах, масштабная перспектива и естественная фотографическая фактура.', keywords: ['путешествие', 'горы', 'дорога', 'пейзаж', 'тревел', 'природа', 'отпуск'] },
  { id: 'coastal-drive', title: 'Маршрут вдоль моря', subtitle: 'Автомобильная история с широким дыханием', image: 'car', category: 'travel', prompt: 'Кинематографичная фотография автомобиля на прибрежной дороге: широкая перспектива, море и скалы, мягкий свет позднего дня, ощущение движения и свободы. Автомобиль органично вписан в пейзаж, без читаемых марок и текста.', keywords: ['автомобиль', 'машина', 'море', 'дорога', 'путешествие', 'поездка', 'пейзаж'] },
  { id: 'cosmic-self', title: 'Дневник космонавта', subtitle: 'Портрет героя среди звёздной тишины', image: 'astronaut', category: 'fantasy', prompt: 'Образ космонавта в тихом фантастическом путешествии: выразительный портрет в скафандре на фоне далёкой планеты, отражения звёзд на стекле шлема, мягкий контровой свет и спокойное чувство масштаба.', keywords: ['космонавт', 'космос', 'астронавт', 'портрет', 'фантазия', 'планета', 'герой'] },
  { id: 'wave-poster', title: 'Волна настроения', subtitle: 'Графичная иллюстрация для яркой публикации', image: 'wave', category: 'social', prompt: 'Выразительная графичная иллюстрация большой волны для публикации в соцсетях: ясный силуэт, продуманные цветовые плоскости, энергичная композиция и свободное место для последующей подписи. Не добавлять текст.', keywords: ['соцсети', 'пост', 'волна', 'иллюстрация', 'обложка', 'публикация', 'графика'] },
];

const normalize = (value: string) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const stem = (word: string) => word.length > 5 ? word.slice(0, -2) : word;

export function searchPhotoIdeas(query: string): PhotoIdea[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return photoIdeas;
  return photoIdeas.map((idea, index) => {
    const title = normalize(idea.title);
    const subtitle = normalize(idea.subtitle);
    const keywords = idea.keywords.map(normalize);
    const score = tokens.reduce((sum, token) => sum + (title.includes(token) ? 8 : keywords.some(word => word.includes(token) || stem(word) === stem(token)) ? 5 : subtitle.includes(token) ? 1 : 0), 0);
    return { idea, index, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map(row => row.idea);
}

const categoryModels: Record<PhotoCategory, string> = {
  portrait: 'higgsfield-ai/soul/v2/standard',
  editorial: 'higgsfield-ai/soul/v2/standard',
  product: 'marketing-studio/image',
  cinema: 'xai/grok-imagine-image-2.0',
  fantasy: 'xai/grok-imagine-image-2.0',
  travel: 'xai/grok-imagine-image-2.0',
  social: 'recraft/v4.1/text-to-image',
};

export const photoIdeaModel = (idea: PhotoIdea): string => categoryModels[idea.category];

/** Use the actual model's input field; AI Influencer accepts a brief, not a prompt. */
export function photoIdeaParameters(idea: PhotoIdea, schema: { properties?: Record<string, unknown> }): Record<string, unknown> {
  if (schema.properties?.prompt) return { prompt: idea.prompt };
  if (schema.properties?.brief) return { brief: idea.prompt };
  return {};
}

export function photoIdeaHref(idea: PhotoIdea, modelId = photoIdeaModel(idea)): string {
  const query = new URLSearchParams({ type: 'photo', photoModel: modelId, photoIdea: idea.id });
  return `/create?${query.toString()}`;
}
