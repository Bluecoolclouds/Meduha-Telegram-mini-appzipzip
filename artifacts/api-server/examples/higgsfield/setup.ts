import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, pool, meduhaAiChannels, meduhaAiModels } from '@workspace/db';
import { discoverHiggsfieldCatalog, type HiggsfieldCatalogResult } from '../../src/lib/higgsfield-catalog';

// Development bootstrap, not an admin login or a paid connectivity test.
// The checked-in public documentation snapshot makes task merges reproducible
// without needing live network access during post-merge setup.
async function main() {
  const snapshotPath = resolve(process.cwd(), 'examples/higgsfield/catalog.json');
  const refresh = process.argv.includes('--refresh');
  const catalog = refresh
    ? await discoverHiggsfieldCatalog()
    : JSON.parse(await readFile(snapshotPath, 'utf8')) as HiggsfieldCatalogResult;
  if (!catalog.entries.length || catalog.status === 'stale'
    || catalog.entries.some(entry => new URL(entry.endpointUrl).origin !== 'https://api.higgsfield.ai'
      || new URL(entry.docsUrl).origin !== 'https://docs.higgsfield.ai'
      || new URL(entry.endpointUrl).pathname.slice(1) !== entry.endpointId)) {
    throw new Error('A nonempty verified Higgsfield documentation snapshot is required.');
  }
  if (refresh) await writeFile(snapshotPath, `${JSON.stringify(catalog, null, 2)}\n`);
  const imported = await db.transaction(async tx => {
    const defaultId = 'd893d592-8746-4258-a153-83e9204651cc';
    const candidates = await tx.select({ id: meduhaAiChannels.id }).from(meduhaAiChannels)
      .where(and(eq(meduhaAiChannels.adapter, 'higgsfield'), eq(meduhaAiChannels.baseUrl, 'https://api.higgsfield.ai')));
    if (candidates.length > 1 && !candidates.some(row => row.id === defaultId)) {
      throw new Error('Multiple Higgsfield channels exist; choose a channel explicitly before restoring the catalog.');
    }
    // Reuse the incoming photo studio's channel rather than creating a second
    // one with duplicate models when that studio was configured before merge.
    const channelId = candidates.length === 1 ? candidates[0].id : defaultId;
    await tx.insert(meduhaAiChannels).values({
      id: channelId, name: 'Higgsfield', baseUrl: 'https://api.higgsfield.ai',
      adapter: 'higgsfield', secretRef: 'secret://higgs_api', enabled: false,
      priority: 100, concurrencyLimit: 1, dailyCreditLimit: 0,
    }).onConflictDoNothing();
    const [channel] = await tx.select().from(meduhaAiChannels)
      .where(eq(meduhaAiChannels.id, channelId)).for('update').limit(1);
    if (!channel || channel.adapter !== 'higgsfield' || channel.baseUrl !== 'https://api.higgsfield.ai') {
      throw new Error('The bootstrap channel ID belongs to a different configuration.');
    }
    let count = 0;
    for (const entry of catalog.entries) {
      const [existing] = await tx.select({ id: meduhaAiModels.id }).from(meduhaAiModels)
        .where(and(eq(meduhaAiModels.channelId, channelId), eq(meduhaAiModels.upstreamId, entry.endpointId))).limit(1);
      // Never overwrite an administrator's price, enablement, limits or schema.
      if (existing) continue;
      await tx.insert(meduhaAiModels).values({
        id: randomUUID(), channelId, upstreamId: entry.endpointId,
        displayName: entry.displayName.slice(0, 120), kind: entry.kind,
        enabled: false, creditPrice: 0, estimatedCost: null, limits: {},
        providerSchemaUrl: entry.docsUrl,
        providerSchema: { schemaAvailable: entry.schemaAvailable, parameters: entry.parameters },
      });
      count++;
    }
    return count;
  });
  console.log(JSON.stringify({
    imported, documentedModels: catalog.entries.length, snapshotDate: catalog.refreshedAt,
    catalogStatus: catalog.status, warnings: catalog.warnings,
    generationSubmitted: false, pricesInvented: false, administratorAssigned: false,
  }));
}

void main().catch(() => {
  console.error('Higgsfield bootstrap failed; no generation was submitted. Check the public catalog snapshot and database configuration.');
  process.exitCode = 1;
}).finally(() => pool.end());
