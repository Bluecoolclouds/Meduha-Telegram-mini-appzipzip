import { photoModelPreview } from './photo/modelPreviews.ts';
import { photoIdeaModel, type PhotoIdea } from './photo/ideas.ts';
import { videoModelPreview } from './video/modelPreviews.ts';
import { videoScenarioModel } from './video/scenarioGeneration.ts';

// A neutral placeholder, never an unrelated model's demonstration.
const placeholder = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#dcdcd9"/></svg>')}`;

export const photoModelCover = (modelId: string): string => photoModelPreview(modelId)?.image ?? placeholder;
export const videoModelCover = (modelId: string): string => videoModelPreview(modelId)?.thumb ?? placeholder;
export const photoIdeaCover = (idea: PhotoIdea): string => photoModelCover(photoIdeaModel(idea));

const motionModels: Record<string, string> = {
  genjutsu: 'higgsfield/genjutsu/motion-transfer/v1.0',
  'object-swap': 'higgsfield/genjutsu/object-swap/v1.0',
  restyle: 'higgsfield/genjutsu/restyle/v1.0',
};

export function videoScenarioCover(scenarioId: string): string {
  if (scenarioId === 'ai-blogger') return photoModelCover('higgsfield/ai-influencer');
  const modelId = Object.hasOwn(motionModels, scenarioId) ? motionModels[scenarioId] : videoScenarioModel(scenarioId);
  return modelId ? videoModelCover(modelId) : placeholder;
}
