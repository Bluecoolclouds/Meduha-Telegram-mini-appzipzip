import manifest from './model-preview-media.json' with { type: 'json' };

export type VideoPreviewMedia = { video?: string; thumb?: string; image?: string };
type PreviewEntry = VideoPreviewMedia & { source: string; unavailable?: string };
const previews: Record<string, PreviewEntry> = manifest.models;

/** Missing media must not borrow a demo from another model or a recommendation. */
export function videoModelPreview(modelId: string): VideoPreviewMedia | null {
  if (!Object.hasOwn(previews, modelId)) return null;
  const entry = previews[modelId];
  return entry.video ? { video: entry.video, thumb: entry.thumb } : null;
}
