import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { getPool } from '../services/database.js';

const migrationsUrl = new URL('../db/migrations/', import.meta.url);
const pool = getPool();

try {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text primary key,
       checksum text not null,
       applied_at timestamptz not null default now()
     )`,
  );

  const files = (await readdir(migrationsUrl))
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  const appliedResult = await pool.query('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(appliedResult.rows.map((row) => [row.name, row.checksum]));

  await files.reduce(async (previous, name) => {
    await previous;
    const sql = await readFile(new URL(name, migrationsUrl), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    if (applied.has(name)) {
      if (applied.get(name) !== checksum) {
        throw new Error(`Applied migration was modified: ${name}`);
      }
      console.log(`skip ${name}`);
      return;
    }
    await pool.query(sql);
    await pool.query(
      'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
      [name, checksum],
    );
    console.log(`applied ${name}`);
  }, Promise.resolve());
} finally {
  await pool.end();
}
