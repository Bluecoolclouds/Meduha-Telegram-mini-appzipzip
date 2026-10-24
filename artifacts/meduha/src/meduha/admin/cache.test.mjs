import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { clearAdminQueries } from './cache.ts';

test('logout removes admin queries and mutation data, preserving user data and status gate', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  const statusKey = ['/api/meduha/admin/login'];
  const userKey = ['/api/meduha/bootstrap'];
  const adminKey = ['/api/meduha/admin/users'];
  client.setQueryData(statusKey, { authenticated: false });
  client.setQueryData(userKey, { account: { id: 'fixture-user' } });
  client.setQueryData(adminKey, { items: [{ id: 'fixture-admin-data' }] });
  const cache = client.getMutationCache();
  for (const key of ['adjustAdminCredits', 'importHiggsfieldCatalogModels', 'saveMeduhaDraft']) {
    await cache.build(client, { mutationKey: [key], mutationFn: async value => value }).execute({ key });
  }
  await clearAdminQueries(client);
  assert.equal(client.getQueryData(adminKey), undefined);
  assert.deepEqual(client.getQueryData(statusKey), { authenticated: false });
  assert(client.getQueryData(userKey));
  assert.deepEqual(cache.getAll().map(m => m.options.mutationKey), [['saveMeduhaDraft']]);
  client.clear();
});
