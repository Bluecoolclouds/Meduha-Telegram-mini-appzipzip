import { db, pool, meduhaAiChannels, meduhaAiModels } from '@workspace/db';

async function main() {
try {
  await db.transaction(async tx => {
    await tx.insert(meduhaAiChannels).values({
      id: 'd893d592-8746-4258-a153-83e9204651cc', name: 'Higgsfield', baseUrl: 'https://api.higgsfield.ai',
      adapter: 'higgsfield', secretRef: 'secret://higgs', enabled: false,
      priority: 100, concurrencyLimit: 1, dailyCreditLimit: 0,
    }).onConflictDoNothing();
    await tx.insert(meduhaAiModels).values({
      id: '97d4112c-2170-4569-9af0-de58c2302322', channelId: 'd893d592-8746-4258-a153-83e9204651cc',
      upstreamId: 'bytedance/seedance-2.5/text-to-video', displayName: 'Seedance 2.5 · Text to Video',
      kind: 'video', enabled: false, creditPrice: 0,
      limits: { minDuration: 4, maxDuration: 30, defaultDuration: 5 },
    }).onConflictDoNothing();
  });
  console.log('Higgsfield channel and Seedance 2.5 configured. Existing settings preserved; no generation submitted.');
} finally {
  await pool.end();
}
}
void main().catch(() => { console.error('Higgsfield catalog setup failed.'); process.exitCode = 1; });
