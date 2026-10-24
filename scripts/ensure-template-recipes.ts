import { pool } from '../lib/db/src/index';
await pool.query('ALTER TABLE meduha_templates ADD COLUMN IF NOT EXISTS recipe jsonb');
const { rows } = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='meduha_templates' AND column_name='recipe'");
if (!rows.length) throw new Error('Template recipe schema was not applied');
await pool.end();
console.log('Template recipe column is ready.');
