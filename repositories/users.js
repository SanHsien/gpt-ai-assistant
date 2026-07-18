import { query } from '../services/database.js';
import { deriveChannelUserKey, encryptJson } from '../services/data-protection.js';

/**
 * 依原始 channel user id upsert 使用者；寫入前會轉成 HMAC 代碼。
 * 只覆寫有帶入的欄位（其餘保留現值）。
 * @param {{ channelUserKey: string, channelTarget?: string|null, timezone?: string|null, locale?: string|null, quietHours?: Object|null, consent?: Object|null }} params
 * @returns {Promise<Object>}
 */
export const upsertUser = async ({
  channelUserKey, channelTarget = null, timezone = null, locale = null,
  quietHours = null, consent = null, remindersPaused = null,
}) => {
  const protectedChannelUserKey = deriveChannelUserKey(channelUserKey);
  const protectedChannelTarget = channelTarget ? encryptJson({ id: channelTarget }) : null;
  const result = await query(
    `INSERT INTO users (channel_user_key, channel_target, timezone, locale, quiet_hours, consent, reminders_paused)
     VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6::jsonb, COALESCE($7, false))
     ON CONFLICT (channel_user_key) DO UPDATE SET
       channel_target = COALESCE(EXCLUDED.channel_target, users.channel_target),
       timezone = COALESCE(EXCLUDED.timezone, users.timezone),
       locale = COALESCE(EXCLUDED.locale, users.locale),
       quiet_hours = COALESCE(EXCLUDED.quiet_hours, users.quiet_hours),
       consent = COALESCE(EXCLUDED.consent, users.consent),
       reminders_paused = COALESCE($7, users.reminders_paused),
       updated_at = now()
     RETURNING *`,
    [
      protectedChannelUserKey,
      protectedChannelTarget == null ? null : JSON.stringify(protectedChannelTarget),
      timezone,
      locale,
      quietHours == null ? null : JSON.stringify(quietHours),
      consent == null ? null : JSON.stringify(consent),
      remindersPaused,
    ],
  );
  return result.rows[0];
};

/**
 * 清除安靜時段（設回 null）；upsertUser 的 COALESCE 無法把值改回 null，故獨立一支。
 * @param {string} channelUserKey
 * @returns {Promise<Object|null>}
 */
export const clearQuietHours = async (channelUserKey) => {
  const result = await query(
    `UPDATE users SET quiet_hours = null, updated_at = now()
     WHERE channel_user_key = $1
     RETURNING *`,
    [deriveChannelUserKey(channelUserKey)],
  );
  return result.rows[0] || null;
};

/**
 * 依原始 channel user id 取得使用者，找不到回傳 null。
 * @param {string} channelUserKey
 * @returns {Promise<Object|null>}
 */
export const getUserByKey = async (channelUserKey) => {
  const result = await query(
    'SELECT * FROM users WHERE channel_user_key = $1',
    [deriveChannelUserKey(channelUserKey)],
  );
  return result.rows[0] || null;
};

/**
 * 依 users.id 取得使用者（reminder job 的 payload 存 ownerId=users.id）。
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getUserById = async (id) => {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
};

export default {
  upsertUser, clearQuietHours, getUserByKey, getUserById,
};
