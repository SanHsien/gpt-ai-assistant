import { query } from '../services/database.js';

/**
 * 建立或更新一筆天氣訂閱（同 owner 同座標唯一）。
 * @param {{ ownerId, label, latitude, longitude, timezone, hour, nextRunAt }} params
 * @returns {Promise<Object>}
 */
export const upsertWeatherSubscription = async ({
  ownerId, label, latitude, longitude, timezone = null, hour, nextRunAt,
}) => {
  const result = await query(
    `INSERT INTO subscriptions
       (owner_id, kind, location_label, latitude, longitude, timezone, hour, enabled, next_run_at)
     VALUES ($1, 'weather', $2, $3, $4, $5, $6, true, $7)
     ON CONFLICT (owner_id, kind, latitude, longitude) DO UPDATE SET
       location_label = EXCLUDED.location_label,
       timezone = EXCLUDED.timezone,
       hour = EXCLUDED.hour,
       enabled = true,
       next_run_at = EXCLUDED.next_run_at,
       updated_at = now()
     RETURNING *`,
    [ownerId, label, latitude, longitude, timezone, hour, nextRunAt],
  );
  return result.rows[0];
};

/**
 * @param {string} ownerId
 * @returns {Promise<Array<Object>>} 已啟用的天氣訂閱
 */
export const listWeatherSubscriptions = async (ownerId) => {
  const result = await query(
    `SELECT * FROM subscriptions
     WHERE owner_id = $1 AND kind = 'weather' AND enabled
     ORDER BY hour, location_label`,
    [ownerId],
  );
  return result.rows;
};

/**
 * 停用該 owner 全部天氣訂閱。
 * @param {string} ownerId
 * @returns {Promise<number>} 停用筆數
 */
export const disableWeatherSubscriptions = async (ownerId) => {
  const result = await query(
    `UPDATE subscriptions SET enabled = false, updated_at = now()
     WHERE owner_id = $1 AND kind = 'weather' AND enabled`,
    [ownerId],
  );
  return result.rowCount;
};

/**
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getSubscription = async (id) => {
  const result = await query('SELECT * FROM subscriptions WHERE id = $1', [id]);
  return result.rows[0] || null;
};

/**
 * 原子挑出「已啟用且到期」的訂閱並把 next_run_at 推進一天，回傳被挑中的列。
 * cron 呼叫；FOR UPDATE SKIP LOCKED 讓多 instance 不重複挑。executor 可傳交易 client。
 * @param {string|Date} now
 * @param {number} limit
 * @param {Function} [executor]
 * @returns {Promise<Array<Object>>}
 */
export const claimDueWeatherSubscriptions = async (now, limit, executor = query) => {
  const result = await executor(
    `UPDATE subscriptions
     SET next_run_at = (
       (next_run_at AT TIME ZONE COALESCE(timezone, 'Asia/Taipei') + interval '1 day')
       AT TIME ZONE COALESCE(timezone, 'Asia/Taipei')
     ), updated_at = now()
     WHERE id IN (
       SELECT id FROM subscriptions
       WHERE kind = 'weather' AND enabled AND next_run_at <= $1
       ORDER BY next_run_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     RETURNING *`,
    [now, limit],
  );
  return result.rows;
};

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export const markSubscriptionDelivered = async (id) => {
  await query(
    'UPDATE subscriptions SET last_delivered_at = now(), updated_at = now() WHERE id = $1',
    [id],
  );
};

export default {
  upsertWeatherSubscription,
  listWeatherSubscriptions,
  disableWeatherSubscriptions,
  getSubscription,
  claimDueWeatherSubscriptions,
  markSubscriptionDelivered,
};
