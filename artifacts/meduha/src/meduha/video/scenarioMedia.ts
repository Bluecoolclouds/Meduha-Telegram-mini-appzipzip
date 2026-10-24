export type ScenarioMediaSpec = {
  video: boolean;
  photos: number;
  requiredPhotos?: number;
  photoLabel?: string;
  videoLabel?: string;
};

export type ScenarioMediaFile = Pick<File, 'name' | 'size' | 'type'>;

export const scenarioInputSpecs: Record<string, ScenarioMediaSpec> = {
  katana: { video: true, photos: 5, videoLabel: 'Видео для монтажа', photoLabel: 'Фото героев или предметов' },
  'image-to-video': { video: false, photos: 1, requiredPhotos: 1, photoLabel: 'Исходное фото' },
  'ai-blogger': { video: false, photos: 1, photoLabel: 'Фото персонажа · необязательно' },
  cinema: { video: false, photos: 5, photoLabel: 'Референсы сцены · необязательно' },
};

export function isScenarioImage(file: Pick<ScenarioMediaFile, 'type'>) {
  return file.type.startsWith('image/');
}

export function isScenarioVideo(file: Pick<ScenarioMediaFile, 'type'>) {
  return file.type.startsWith('video/');
}

export function scenarioMediaError(spec: ScenarioMediaSpec, files: readonly ScenarioMediaFile[]) {
  const videoFiles = files.filter(isScenarioVideo);
  const imageFiles = files.filter(isScenarioImage);

  for (const file of files) {
    if (isScenarioVideo(file)) {
      if (!spec.video || !['video/mp4', 'video/webm'].includes(file.type)) {
        return 'Выбери видео MP4 или WebM';
      }
      if (file.size > 200 * 1024 * 1024) return 'Видео — до 200 МиБ';
    } else if (!isScenarioImage(file) || file.size > 10 * 1024 * 1024) {
      return 'Выбери изображение до 10 МиБ';
    }
  }

  if (videoFiles.length > (spec.video ? 1 : 0) || imageFiles.length > spec.photos) {
    return spec.video
      ? `Можно добавить одно видео и до ${spec.photos} фото`
      : `Можно добавить до ${spec.photos} фото`;
  }

  return null;
}

export function missingRequiredScenarioMedia(spec: ScenarioMediaSpec, files: readonly ScenarioMediaFile[]) {
  return (spec.video && !files.some(isScenarioVideo))
    || files.filter(isScenarioImage).length < (spec.requiredPhotos ?? 0);
}

export function scenarioReferenceMetadata(files: readonly Pick<ScenarioMediaFile, 'name'>[]) {
  return files.length ? { referenceName: files.map(file => file.name).join(', ').slice(0, 180) } : {};
}
