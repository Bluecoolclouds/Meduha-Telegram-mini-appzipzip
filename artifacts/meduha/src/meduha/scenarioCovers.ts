import { photoModelPreview } from './photo/modelPreviews.ts';
import { photoIdeaModel, type PhotoIdea } from './photo/ideas.ts';
import { videoModelPreview } from './video/modelPreviews.ts';
import { videoScenarioModel } from './video/scenarioGeneration.ts';
import manifest from './cover-media.json' with { type: 'json' };

export type CoverSize = 'thumb' | 'card' | 'hero';
type CoverVariants = Record<CoverSize | 'original', string>;
const covers: Record<string, CoverVariants> = manifest.covers;
const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');

/** New catalogue entries retain their verified source until derivatives are imported. */
export function optimizedCover(source: string, size: CoverSize = 'card'): string {
  return Object.hasOwn(covers, source) ? `${base}/api/meduha/example-media/${covers[source][size]}` : source;
}

// A neutral placeholder, never an unrelated model's demonstration.
const placeholder = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#dcdcd9"/></svg>')}`;

export const photoModelCover = (modelId: string, size: CoverSize = 'card'): string => {
  const image = photoModelPreview(modelId)?.image;
  return image ? optimizedCover(image, size) : placeholder;
};
export const videoModelCover = (modelId: string, size: CoverSize = 'card'): string => {
  const image = videoModelPreview(modelId)?.thumb;
  return image ? optimizedCover(image, size) : placeholder;
};
export const photoIdeaCover = (idea: PhotoIdea, size: CoverSize = 'card'): string => photoModelCover(photoIdeaModel(idea), size);

const motionModels: Record<string, string> = {
  genjutsu: 'higgsfield/genjutsu/motion-transfer/v1.0',
  'object-swap': 'higgsfield/genjutsu/object-swap/v1.0',
  restyle: 'higgsfield/genjutsu/restyle/v1.0',
};

export function videoScenarioCover(scenarioId: string, size: CoverSize = 'card'): string {
  if (scenarioId === 'ai-blogger') return photoModelCover('higgsfield/ai-influencer', size);
  const modelId = Object.hasOwn(motionModels, scenarioId) ? motionModels[scenarioId] : videoScenarioModel(scenarioId);
  return modelId ? videoModelCover(modelId, size) : placeholder;
}
