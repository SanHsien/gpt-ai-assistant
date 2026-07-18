import { readFile } from 'node:fs/promises';
import { getPool } from '../services/database.js';

const [name, confirmation] = process.argv.slice(2);
if (!/^\d{4}_[a-z0-9_-]+\.sql$/i.test(name || '') || confirmation !== '--confirm') {
  throw new Error('Usage: npm run db:rollback -- <migration.sql> --confirm');
}

const pool = getPool();
try {
  const latest = await pool.query(
    'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
  );
  if (!latest.rows[0] || latest.rows[0].name !== name) {
    throw new Error(`Only the latest applied migration can be rolled back: ${latest.rows[0]?.name || 'none'}`);
  }

  const sql = await readFile(new URL(`../db/rollbacks/${name}`, import.meta.url), 'utf8');
  await pool.query(sql);
  await pool.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
  console.log(`rolled back ${name}`);
} finally {
  await pool.end();
}
