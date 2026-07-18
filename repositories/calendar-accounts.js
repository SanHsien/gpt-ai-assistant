import crypto from 'node:crypto';
import { query, withTransaction } from '../services/database.js';
import { decryptJson, encryptJson } from '../services/data-protection.js';

const hashState = (state) => crypto.createHash('sha256').update(state).digest('hex');

const decryptAccount = (row) => (row ? {
  ...row,
  credentials: decryptJson(row.credentials),
} : null);

/**
 * @param {string} ownerId
 * @param {Function} [executor]
 * @returns {Promise<Object|null>}
 */
export const getCalendarAccount = async (ownerId, executor = query) => {
  const result = await executor(
    'SELECT * FROM calendar_accounts WHERE owner_id = $1',
    [ownerId],
  );
  return decryptAccount(result.rows[0]);
};

/**
 * Google token 全部以 AES-256-GCM envelope 儲存，不保存帳號 email。
 * @param {{ ownerId: string, credentials: Object, scopes?: string[], calendarId?: string }} params
 * @returns {Promise<Object>}
 */
export const saveCalendarAccount = async ({
  ownerId, credentials, scopes = [], calendarId = 'primary',
}) => {
  const result = await query(
    `INSERT INTO calendar_accounts (owner_id, credentials, scopes, calendar_id)
     VALUES ($1, $2::jsonb, $3::text[], $4)
     ON CONFLICT (owner_id) DO UPDATE SET
       credentials = EXCLUDED.credentials,
       scopes = EXCLUDED.scopes,
       calendar_id = EXCLUDED.calendar_id,
       updated_at = now()
     RETURNING *`,
    [ownerId, JSON.stringify(encryptJson(credentials)), scopes, calendarId],
  );
  return decryptAccount(result.rows[0]);
};

/**
 * 刪除已連結的 Google 帳號（token envelope 一併移除）。
 * @param {string} ownerId
 * @returns {Promise<boolean>} 是否有刪到
 */
export const deleteCalendarAccount = async (ownerId) => {
  const result = await query(
    'DELETE FROM calendar_accounts WHERE owner_id = $1',
    [ownerId],
  );
  return result.rowCount > 0;
};

/**
 * @param {string} ownerId
 * @returns {Promise<boolean>}
 */
export const hasCalendarAccount = async (ownerId) => {
  const result = await query(
    'SELECT EXISTS (SELECT 1 FROM calendar_accounts WHERE owner_id = $1) AS connected',
    [ownerId],
  );
  return result.rows[0]?.connected === true;
};

/**
 * @param {{ ownerId: string, state: string, codeVerifier: string, expiresAt: string|Date }} params
 * @returns {Promise<void>}
 */
export const createOAuthState = async ({
  ownerId, state, codeVerifier, expiresAt,
}) => {
  await query(
    `INSERT INTO oauth_states (state_hash, owner_id, code_verifier, expires_at)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [hashState(state), ownerId, JSON.stringify(encryptJson(codeVerifier)), expiresAt],
  );
};

/**
 * 一次性消費 state；過期、重播或未知 state 都回 null。
 * @param {string} state
 * @returns {Promise<{ owner_id: string, code_verifier: string }|null>}
 */
export const consumeOAuthState = async (state) => withTransaction(async (client) => {
  const result = await client.query(
    `DELETE FROM oauth_states
     WHERE state_hash = $1 AND expires_at > now()
     RETURNING owner_id, code_verifier`,
    [hashState(state)],
  );
  const row = result.rows[0];
  return row ? { ...row, code_verifier: decryptJson(row.code_verifier) } : null;
});

/**
 * 存 Google Calendar 增量同步 token（同步游標，非憑證，明文即可）。
 * @param {string} ownerId
 * @param {string|null} token
 * @returns {Promise<void>}
 */
export const saveSyncToken = async (ownerId, token) => {
  await query(
    'UPDATE calendar_accounts SET sync_token = $2, updated_at = now() WHERE owner_id = $1',
    [ownerId, token],
  );
};

/**
 * 原子挑出「該輪詢」的帳號並推進 last_pulled_at，回傳 owner_id 供 cron 入列 inbound job。
 * FOR UPDATE SKIP LOCKED 讓多 instance 不重複挑。executor 可傳交易 client。
 * @param {string|Date} cutoff last_pulled_at <= cutoff（或為 null）才挑
 * @param {number} limit
 * @param {Function} [executor]
 * @returns {Promise<Array<{ owner_id: string }>>}
 */
export const claimAccountsForInbound = async (cutoff, limit, executor = query) => {
  const result = await executor(
    `UPDATE calendar_accounts SET last_pulled_at = now()
     WHERE owner_id IN (
       SELECT owner_id FROM calendar_accounts
       WHERE last_pulled_at IS NULL OR last_pulled_at <= $1
       ORDER BY last_pulled_at NULLS FIRST
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     RETURNING owner_id`,
    [cutoff, limit],
  );
  return result.rows;
};

/**
 * Google Tasks inbound 專用：原子挑出「該輪詢」的帳號，把 tasks_last_pulled_at 推進到 now()，
 * 並回傳「前一次」的水位供 job 當 updatedMin。Google Tasks 無 sync token，故以 updatedMin 增量。
 * 前次水位放進 job payload，讓失敗重試沿用同一時間窗，不會因水位已推進而漏抓。
 * @param {string|Date} cutoff tasks_last_pulled_at <= cutoff（或為 null）才挑
 * @param {number} limit
 * @param {Function} [executor]
 * @returns {Promise<Array<{ owner_id: string, prev: string|null }>>}
 */
export const claimAccountsForTasksInbound = async (
  cutoff,
  limit,
  claimedAt,
  executor = query,
) => {
  const result = await executor(
    `WITH picked AS (
       SELECT owner_id, tasks_last_pulled_at AS prev
       FROM calendar_accounts
       WHERE (tasks_last_pulled_at IS NULL OR tasks_last_pulled_at <= $1)
         AND (tasks_inbound_claimed_at IS NULL OR tasks_inbound_claimed_at <= $1)
       ORDER BY tasks_last_pulled_at NULLS FIRST
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     ), claimed AS (
       UPDATE calendar_accounts c SET tasks_inbound_claimed_at = $3
       FROM picked WHERE c.owner_id = picked.owner_id
     )
     SELECT owner_id, prev, $3::timestamptz AS claimed_at FROM picked`,
    [cutoff, limit, claimedAt],
  );
  return result.rows;
};

export const completeTasksInboundClaim = async (
  ownerId,
  claimedAt,
  executor = query,
) => {
  const result = await executor(
    `UPDATE calendar_accounts
     SET tasks_last_pulled_at = $2, tasks_inbound_claimed_at = null
     WHERE owner_id = $1 AND tasks_inbound_claimed_at = $2
     RETURNING owner_id`,
    [ownerId, claimedAt],
  );
  return result.rowCount > 0;
};

export default {
  consumeOAuthState,
  createOAuthState,
  deleteCalendarAccount,
  getCalendarAccount,
  hasCalendarAccount,
  saveCalendarAccount,
  saveSyncToken,
  claimAccountsForInbound,
  claimAccountsForTasksInbound,
  completeTasksInboundClaim,
};
