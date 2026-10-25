import manifest from './model-preview-media.json' with { type: 'json' };

type PhotoPreviewEntry = { source: string; image?: string; unavailable?: string };
const previews: Record<string, PhotoPreviewEntry> = manifest.models;

export function photoModelPreview(modelId: string): { image: string } | null {
  if (!Object.hasOwn(previews, modelId)) return null;
  const entry = previews[modelId];
  return entry.image ? { image: entry.image } : null;
}
