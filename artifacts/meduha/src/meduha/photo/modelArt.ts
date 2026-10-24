// Illustrative art for photo models. These are Meduha's own reference illustrations,
// not outputs of the listed models. Mapped by model family.
import type { PhotoCatalogModel } from '@workspace/api-client-react';

const families: [RegExp, string][] = [
  [/soul/, 'portrait'], [/influencer/, 'fashion'], [/grok/, 'astronaut'], [/ideogram/, 'city'],
  [/recraft/, 'wave'], [/qwen.*edit/, 'flower'], [/qwen/, 'mountain'], [/z-image/, 'car'],
  [/product-shots|marketplace/, 'perfume'], [/graphic-ads|ads-studio|marketing/, 'car'],
];
export const photoModelArt = (m: PhotoCatalogModel) => families.find(([r]) => r.test(m.id))?.[1] ?? 'portrait';

export const photoProvider = (m: PhotoCatalogModel) => (m.endpoint || m.id).split('/')[0];
const providerNames: Record<string, string> = { 'higgsfield-ai': 'Higgsfield', higgsfield: 'Higgsfield', xai: 'xAI', ideogram: 'Ideogram', alibaba: 'Alibaba', workflows: 'Higgsfield Workflows', recraft: 'Recraft', 'marketing-studio': 'Marketing Studio' };
export const photoProviderLabel = (p: string) => providerNames[p] ?? p;
