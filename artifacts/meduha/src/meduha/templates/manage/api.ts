import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { completeTemplateUpload, createTemplate, getTemplateAccess, listTemplates, requestTemplateUpload, setTemplatePublication, updateTemplate } from '@workspace/api-client-react';
import type { ListTemplatesScope, StudioTemplate, TemplateInput, TemplatePublicationInputAction, TemplateUploadInputContentType } from '@workspace/api-client-react';

const mutate = { credentials: 'same-origin' as const, headers: { 'X-Meduha-Request': '1' } };
const read = { credentials: 'same-origin' as const };
export const LIMIT = 12;
export const useAccess = (accountId: string | undefined) => useQuery({ queryKey: ['/api/meduha/templates/access', accountId ?? 'guest'], queryFn: ({ signal }) => getTemplateAccess({ ...read, signal }), enabled: !!accountId, retry: false });
export const useManagedTemplates = (accountId: string | undefined, scope: ListTemplatesScope, query: string) => useInfiniteQuery({
  queryKey: ['/api/meduha/templates', 'manage', accountId ?? 'guest', scope, query],
  enabled: !!accountId, retry: false, initialPageParam: undefined as number | undefined,
  queryFn: ({ pageParam, signal }) => listTemplates({ scope, limit: LIMIT, ...(query ? { query } : {}), ...(pageParam ? { cursor: pageParam } : {}) }, { ...read, signal }),
  getNextPageParam: page => page.nextCursor ?? undefined,
});
function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['/api/meduha/templates'] }), qc.invalidateQueries({ queryKey: ['meduha-template-feed'] })]);
}
export function useSaveTemplate() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: ({ id, data }: { id?: string; data: TemplateInput }): Promise<StudioTemplate> => id ? updateTemplate(id, data, mutate) : createTemplate(data, mutate), onSuccess: () => refresh() });
}
export function usePublication() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: ({ id, action }: { id: string; action: TemplatePublicationInputAction }) => setTemplatePublication(id, { action }, mutate), onSuccess: () => refresh() });
}
export const MAX_IMAGE = 10 * 1024 * 1024, MAX_VIDEO = 100 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'], VIDEO_TYPES = ['video/mp4', 'video/webm'];
export const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav'];
export function validateFile(file: File, video: boolean | 'audio'): string | null {
  if (video === 'audio') {
    if (!AUDIO_TYPES.includes(file.type)) return 'Нужен MP3 или WAV.';
    return file.size > MAX_VIDEO ? 'Аудио больше 100 МБ.' : file.size === 0 ? 'Аудиофайл пуст.' : null;
  }
  if (!(video ? VIDEO_TYPES : IMAGE_TYPES).includes(file.type)) return video ? 'Нужен MP4 или WebM.' : 'Нужен JPEG, PNG или WebP.';
  if (file.size > (video ? MAX_VIDEO : MAX_IMAGE)) return video ? 'Видео больше 100 МБ.' : 'Обложка больше 10 МБ.';
  return null;
}
export async function uploadMedia(file: File): Promise<string> {
  const req = await requestTemplateUpload({ contentType: file.type as TemplateUploadInputContentType, size: file.size }, mutate);
  const put = await fetch(req.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error(`Хранилище отклонило файл (${put.status}).`);
  return (await completeTemplateUpload(req.id, mutate)).objectPath;
}
