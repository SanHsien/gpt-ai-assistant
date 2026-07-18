import config from '../config/index.js';
import { query } from './database.js';

export const LATEST_MIGRATION = '0019_calendar_sync_query_version.sql';

const missing = (keys) => keys.filter((key) => !config[key]);

/**
 * Validate the 6.0 durable-only runtime contract without making network calls.
 * @returns {void}
 */
export const assertRuntimeConfig = () => {
  const required = [
    'DATABASE_URL',
    'DATA_ENCRYPTION_KEY',
    'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'OPENAI_API_KEY',
  ];
  if (config.ENABLE_SEARCH) required.push('SERPAPI_API_KEY');
  if (config.ENABLE_GOOGLE_CALENDAR || config.ENABLE_GOOGLE_TASKS
      || config.ENABLE_GOOGLE_CALENDAR_INBOUND || config.ENABLE_GOOGLE_TASKS_INBOUND) {
    required.push('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI');
  }
  if (config.ENABLE_REMINDERS || config.ENABLE_WEATHER_PUSH
      || config.ENABLE_GOOGLE_CALENDAR || config.ENABLE_GOOGLE_TASKS
      || config.ENABLE_GOOGLE_CALENDAR_INBOUND || config.ENABLE_GOOGLE_TASKS_INBOUND) {
    required.push('REMINDER_CRON_SECRET');
  }
  const absent = missing([...new Set(required)]);
  if (absent.length > 0) {
    const err = new Error(`Runtime configuration missing: ${absent.join(', ')}`);
    err.code = 'RUNTIME_CONFIG_MISSING';
    throw err;
  }
};

let readyPromise = null;

const checkReady = async () => {
  assertRuntimeConfig();
  const result = await query(
    'SELECT name FROM schema_migrations WHERE name = $1',
    [LATEST_MIGRATION],
  );
  if (!result.rows[0]) {
    const err = new Error(`Database migration required: ${LATEST_MIGRATION}`);
    err.code = 'DATABASE_MIGRATION_REQUIRED';
    throw err;
  }
  return { latestMigration: LATEST_MIGRATION };
};

/**
 * Cached only after success. A failed preflight may recover after env or migration repair.
 * @returns {Promise<{latestMigration: string}>}
 */
export const ensureRuntimeReady = async () => {
  if (!readyPromise) {
    readyPromise = checkReady().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
};

export const resetRuntimePreflight = () => { readyPromise = null; };

export default { assertRuntimeConfig, ensureRuntimeReady, LATEST_MIGRATION };
