import config from '../config/index.js';
import { withTransaction, query } from '../services/database.js';
import { deriveChannelUserKey } from '../services/data-protection.js';

const testSources = new Map();

const sourceLimitError = (sourceType) => {
  const err = new Error(`maximum ${sourceType} sources reached`);
  err.code = 'SOURCE_LIMIT_REACHED';
  err.sourceType = sourceType;
  return err;
};

const ensureTestSource = ({
  sourceKey, sourceType, defaultActivated, maxSources,
}) => {
  const key = `${sourceType}:${sourceKey}`;
  if (testSources.has(key)) return testSources.get(key);
  const count = [...testSources.values()].filter((source) => source.source_type === sourceType).length;
  if (count >= maxSources) throw sourceLimitError(sourceType);
  const source = {
    source_type: sourceType, is_activated: defaultActivated,
  };
  testSources.set(key, source);
  return source;
};

/**
 * Atomically register a bot source under its per-type limit.
 * Only the deployment-scoped HMAC key is persisted; names and raw LINE ids stay in memory.
 * @param {{ sourceKey: string, sourceType: 'user'|'group', defaultActivated: boolean, maxSources: number }} params
 * @returns {Promise<Object>}
 */
export const ensureBotSource = async ({
  sourceKey, sourceType, defaultActivated, maxSources,
}) => {
  if (config.APP_ENV === 'test') {
    return ensureTestSource({
      sourceKey, sourceType, defaultActivated, maxSources,
    });
  }
  const protectedKey = deriveChannelUserKey(sourceKey);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bot_sources:${sourceType}`]);
    const existing = await client.query(
      'SELECT source_type, is_activated FROM bot_sources WHERE source_key = $1',
      [protectedKey],
    );
    if (existing.rows[0]) return existing.rows[0];

    const count = await client.query(
      'SELECT count(*)::text AS count FROM bot_sources WHERE source_type = $1',
      [sourceType],
    );
    if (Number(count.rows[0]?.count || 0) >= maxSources) throw sourceLimitError(sourceType);

    const inserted = await client.query(
      `INSERT INTO bot_sources (source_key, source_type, is_activated)
       VALUES ($1, $2, $3)
       RETURNING source_type, is_activated`,
      [protectedKey, sourceType, defaultActivated],
    );
    return inserted.rows[0];
  });
};

/**
 * @param {string} sourceKey
 * @param {boolean} isActivated
 * @returns {Promise<Object|null>}
 */
export const setBotSourceActivation = async (sourceKey, isActivated) => {
  if (config.APP_ENV === 'test') {
    const entry = [...testSources.entries()].find(([key]) => key.endsWith(`:${sourceKey}`));
    if (!entry) return null;
    const updated = { ...entry[1], is_activated: isActivated };
    testSources.set(entry[0], updated);
    return updated;
  }
  const result = await query(
    `UPDATE bot_sources
     SET is_activated = $1, updated_at = now()
     WHERE source_key = $2
     RETURNING source_type, is_activated`,
    [isActivated, deriveChannelUserKey(sourceKey)],
  );
  return result.rows[0] || null;
};

export const clearTestBotSources = () => testSources.clear();

export default { ensureBotSource, setBotSourceActivation };
