import type { StudioTemplate } from '@workspace/api-client-react';
import motionTransfer from '../../../public/templates/motion-transfer.json';

const photoCredit = 'Иллюстрация из стартовых материалов Meduha. Не публикация пользователя.';

export const exampleTemplates: StudioTemplate[] = [
  motionTransfer as StudioTemplate,
  {
    id: 'example-fantasy-film', status: 'published', kind: 'video',
    title: 'История дракона', description: 'Анимационный видеореференс Sintel. Промпт описывает настроение сцены; этот ролик не сгенерирован в Meduha.',
    poster: '/api/meduha/example-media/sintel.png', videoUrl: '/api/meduha/example-media/sintel.webm#t=5',
    width: 16, height: 9,
    prompt: 'Кинематографичная 3D-анимация о путешественнице и маленьком драконе, выразительные персонажи, масштабные пейзажи, мягкий драматичный свет, плавное движение камеры, атмосфера приключения.',
    tags: ['Анимация', 'Фэнтези'], sourceUrl: 'https://durian.blender.org/',
    credit: 'Sintel © Blender Foundation — CC BY 3.0. Демонстрационный референс.',
    parameters: { model: '', style: '', ratio: '16:9', duration: '' },
  },
  {
    id: 'example-space', status: 'published', kind: 'photo',
    title: 'Другая вселенная', description: 'Фото-пример для вдохновения.',
    poster: 'images/meduha/astronaut.png', videoUrl: null, width: 9, height: 16,
    prompt: 'Астронавт на далёкой планете, огромный спутник над горизонтом, реалистичная фактура скафандра, холодный космический свет, кинематографичный масштаб, вертикальный кадр.',
    tags: ['Космос', 'Фантастика'], credit: photoCredit,
    parameters: { model: '', style: '', ratio: '9:16', duration: '' },
  },
  {
    id: 'example-flower-film', status: 'published', kind: 'video',
    title: 'Жизнь в деталях', description: 'Видеореференс MDN: цветок и пчела крупным планом. Промпт — идея похожей сцены, а не исходный промпт этого ролика.',
    poster: 'images/meduha/flower.png', videoUrl: '/api/meduha/example-media/flower.webm',
    width: 16, height: 10,
    prompt: 'Макросъёмка пчелы на цветке, пыльца на лепестках, естественный дневной свет, малая глубина резкости, мягкий размытый фон, спокойная неподвижная камера и живое движение насекомого.',
    tags: ['Макро', 'Природа'], sourceUrl: 'https://github.com/mdn/interactive-examples',
    credit: 'Демонстрационное видео MDN, CC0. Не работа пользователя Meduha.',
    parameters: { model: '', style: '', ratio: '16:10', duration: '' },
  },
  {
    id: 'example-portrait', status: 'published', kind: 'photo',
    title: 'Золотой час', description: 'Фото-пример кинематографичного портрета.',
    poster: 'images/meduha/portrait.png', videoUrl: null, width: 3, height: 4,
    prompt: 'Кинематографичный портрет девушки на закате, тёплый контровой свет в волосах, солнечные блики на очках, естественная кожа, малая глубина резкости, плёночная цветокоррекция.',
    tags: ['Портрет', 'Кино'], credit: photoCredit,
    parameters: { model: '', style: '', ratio: '3:4', duration: '' },
  },
  {
    id: 'example-car', status: 'published', kind: 'photo',
    title: 'Ночной заезд', description: 'Рекламный фото-пример автомобиля.',
    poster: 'images/meduha/car.png', videoUrl: null, width: 4, height: 5,
    prompt: 'Рекламная фотография спортивного автомобиля, низкая точка съёмки, драматичный свет, выразительные отражения на кузове, глубокие тени, точная геометрия и кинематографичная палитра.',
    tags: ['Авто', 'Реклама'], credit: photoCredit,
    parameters: { model: '', style: '', ratio: '4:5', duration: '' },
  },
  {
    id: 'example-city', status: 'published', kind: 'photo',
    title: 'После дождя', description: 'Фото-пример атмосферного города.',
    poster: 'images/meduha/city.png', videoUrl: null, width: 9, height: 16,
    prompt: 'Ночной город после дождя, неоновые огни отражаются в мокром асфальте, глубокая перспектива улицы, атмосферная уличная фотография, мягкая дымка и выразительный цвет.',
    tags: ['Город', 'Неон'], credit: photoCredit,
    parameters: { model: '', style: '', ratio: '9:16', duration: '' },
  },
  {
    id: 'example-mountain', status: 'published', kind: 'photo',
    title: 'Тишина гор', description: 'Пейзажный фото-пример.',
    poster: 'images/meduha/mountain.png', videoUrl: null, width: 4, height: 3,
    prompt: 'Горный пейзаж на рассвете, холодные скалы и тёплый свет на вершинах, выразительное небо, атмосферная глубина, спокойная широкая композиция.',
    tags: ['Пейзаж', 'Природа'], credit: photoCredit,
    parameters: { model: '', style: '', ratio: '4:3', duration: '' },
  },
  {
    id: 'example-perfume', status: 'published', kind: 'photo',
    title: 'Свет и стекло', description: 'Предметный фото-пример.',
    poster: 'images/meduha/perfume.png', videoUrl: null, width: 4, height: 5,
    prompt: 'Предметная съёмка флакона парфюма, тёплый направленный свет, выразительная тень, чистое стекло и точные отражения, премиальная рекламная композиция без текста.',
    tags: ['Предметы', 'Реклама'], credit: photoCredit,
    parameters: { model: '', style: '', ratio: '4:5', duration: '' },
  },
];

export function isExampleTemplate(template: StudioTemplate): boolean {
  return exampleIds.has(template.id);
}

const exampleIds = new Set(exampleTemplates.map(template => template.id));

export function findExampleTemplate(id: string): StudioTemplate | undefined {
  return exampleTemplates.find(template => template.id === id);
}
export function findExamples(query = '', kind: 'all' | 'photo' | 'video' | 'audio' = 'all'): StudioTemplate[] {
  const title = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  return exampleTemplates.filter(item => (kind === 'all' || item.kind === kind)
    && (!title || item.title.toLocaleLowerCase('ru').includes(title)));
}
