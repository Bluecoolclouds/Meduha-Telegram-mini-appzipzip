import type { QueryClient } from '@tanstack/react-query';

export const isAdminKey = (key: readonly unknown[]) => {
  const path = key[0];
  return typeof path === 'string' && path.startsWith('/api/meduha/admin') && !path.startsWith('/api/meduha/admin/login');
};

/** Keep only the status query so the login gate can recheck without a loop. */
export async function clearAdminQueries(qc: QueryClient) {
  await qc.cancelQueries({ predicate: q => isAdminKey(q.queryKey) });
  qc.removeQueries({ predicate: q => isAdminKey(q.queryKey) });
  const mutations = qc.getMutationCache();
  for (const mutation of mutations.getAll()) {
    const name = mutation.options.mutationKey?.[0];
    if (typeof name === 'string' && (name.includes('Admin') || name === 'importHiggsfieldCatalogModels')) {
      mutations.remove(mutation);
    }
  }
}
