import { useMemo } from 'react';
import { getListStudioContentQueryKey, useListStudioContent } from '@workspace/api-client-react';
import { contentCover, isContentEnabled, resolveContentUrl, toContentMap, type ContentMap } from './studioContent';

const base = import.meta.env?.BASE_URL ?? '/';

export type StudioContentState = {
  map: ContentMap;
  /** True once overrides are known; until then disabled items must not be shown. */
  ready: boolean;
  loading: boolean;
  error: unknown;
  retry: () => void;
  enabled: (key: string) => boolean;
  /** Override cover resolved for the browser, or the provided default. */
  cover: (key: string, fallback: string) => string;
};

/** Public curated overrides. Polls so admin edits reach other open sessions. */
export function useStudioContent(): StudioContentState {
  const query = useListStudioContent({
    request: { cache: 'no-store' },
    query: { queryKey: getListStudioContentQueryKey(), staleTime: 10_000, refetchInterval: 30_000, refetchOnWindowFocus: true, retry: 1 },
  });
  const map = useMemo(() => toContentMap(query.data), [query.data]);
  const ready = query.data !== undefined;
  const refetch = query.refetch;
  return useMemo(() => ({
    map,
    ready,
    loading: !ready && query.isLoading,
    error: !ready && query.isError ? query.error : null,
    retry: () => { void refetch(); },
    enabled: (key: string) => isContentEnabled(map, key),
    cover: (key: string, fallback: string) => { const c = contentCover(map, key); return c ? resolveContentUrl(c, base) : fallback; },
  }), [map, ready, query.isLoading, query.isError, query.error, refetch]);
}
