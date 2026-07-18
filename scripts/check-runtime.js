import { getPool, isDatabaseConfigured } from '../services/database.js';
import { ensureRuntimeReady } from '../services/runtime-preflight.js';

try {
  const { latestMigration } = await ensureRuntimeReady();
  console.log(`runtime ready (${latestMigration})`);
} finally {
  if (isDatabaseConfigured()) await getPool().end();
}
