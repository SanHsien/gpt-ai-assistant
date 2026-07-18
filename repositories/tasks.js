import { query, withTransaction } from '../services/database.js';
import { decideTaskInbound } from '../contracts/google-provider.js';

// Google Tasks 的 notes 內含穩定同步標記 [gpt-ai-assistant:<id>]（outbound 寫入用於建立前查重）。
// inbound 套用備註前先移除該標記，避免把標記本身寫回本機 notes。
const stripSyncMarker = (notes, taskId) => {
  if (!notes) return null;
  const cleaned = notes.split(`[gpt-ai-assistant:${taskId}]`).join('').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || null;
};

/**
 * @param {string} ownerId
 * @param {Object} draft 已驗證的 task draft（title, notes?, dueAt?, timezone?）
 * @returns {Promise<Object>}
 */
export const createTask = async (ownerId, draft) => {
  const result = await query(
    `INSERT INTO tasks (owner_id, title, notes, due_at, timezone, priority, tags)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'normal'), $7::text[])
     RETURNING *`,
    [
      ownerId,
      draft.title,
      draft.notes ?? null,
      draft.dueAt ?? null,
      draft.timezone ?? null,
      draft.priority ?? null,
      draft.tags ?? [],
    ],
  );
  return result.rows[0];
};

/**
 * dueAfter／dueBefore 定義半開期限範圍；兩者皆 null 時列出全部（含無期限）。
 * tag 非 null 時只列含該標籤者。多取一筆（limit + 1）讓呼叫端判斷是否還有下一頁。
 * 排序：高優先在前，其次有期限的按到期時間，最後建立時間。
 * @param {string} ownerId
 * @param {{ status?, dueAfter?, dueBefore?, tag?, limit?, offset? }} [opts]
 * @returns {Promise<Array<Object>>}
 */
export const listTasks = async (ownerId, {
  status = 'open', dueAfter = null, dueBefore = null, tag = null, limit = 6, offset = 0,
} = {}) => {
  const result = await query(
    `SELECT * FROM tasks
     WHERE owner_id = $1
       AND ($2::text IS NULL OR status = $2)
       AND ($3::timestamptz IS NULL OR due_at >= $3)
       AND ($4::timestamptz IS NULL OR due_at < $4)
       AND ($5::text IS NULL OR EXISTS (
         SELECT 1 FROM unnest(tags) AS stored_tag
         WHERE btrim(stored_tag, ' 。！？.!?,，；;：:') = $5
       ))
     ORDER BY
       CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
       (due_at IS NULL), due_at, created_at
     LIMIT $6 OFFSET $7`,
    [ownerId, status, dueAfter, dueBefore, tag, limit, offset],
  );
  return result.rows;
};

/**
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getTask = async (ownerId, id, executor = query) => {
  const result = await executor(
    'SELECT * FROM tasks WHERE id = $1 AND owner_id = $2',
    [id, ownerId],
  );
  return result.rows[0] || null;
};

/**
 * 同步 worker 專用：鎖住任務列，讓同一任務的多個版本不會同時建立 Google Task。
 * @param {string} ownerId
 * @param {string} id
 * @param {Function} executor transaction client query
 * @returns {Promise<Object|null>}
 */
export const getTaskForUpdate = async (ownerId, id, executor) => {
  const result = await executor(
    'SELECT * FROM tasks WHERE id = $1 AND owner_id = $2 FOR UPDATE',
    [id, ownerId],
  );
  return result.rows[0] || null;
};

/**
 * 標記完成。只作用於 open 任務——已完成的重複點擊回 null，由呼叫端做冪等處理。
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const completeTask = async (ownerId, id) => {
  const result = await query(
    `UPDATE tasks
     SET status = 'done', completed_at = now(), sync_status = 'pending', synced_at = null,
         version = version + 1, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND status = 'open'
     RETURNING *`,
    [id, ownerId],
  );
  return result.rows[0] || null;
};

/**
 * 重新開啟已完成的任務。
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const reopenTask = async (ownerId, id) => {
  const result = await query(
    `UPDATE tasks
     SET status = 'open', completed_at = null, sync_status = 'pending', synced_at = null,
         version = version + 1, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND status = 'done'
     RETURNING *`,
    [id, ownerId],
  );
  return result.rows[0] || null;
};

/**
 * 調整未完成任務的優先度。
 * @param {string} ownerId
 * @param {string} id
 * @param {'high'|'normal'|'low'} priority
 * @returns {Promise<Object|null>}
 */
export const setTaskPriority = async (ownerId, id, priority) => {
  const result = await query(
    `UPDATE tasks
     SET priority = $3, sync_status = 'pending', synced_at = null,
         version = version + 1, updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND status = 'open'
     RETURNING *`,
    [id, ownerId, priority],
  );
  return result.rows[0] || null;
};

/**
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<boolean>} 是否有刪到（找不到或非本人回 false）
 */
export const deleteTask = async (ownerId, id) => {
  const result = await query(
    'DELETE FROM tasks WHERE id = $1 AND owner_id = $2',
    [id, ownerId],
  );
  return result.rowCount > 0;
};

/**
 * 刪除並回傳最新列；若同步 worker 正持有列鎖，DELETE 會等它完成後取得 provider id。
 * @param {string} ownerId
 * @param {string} id
 * @param {Function} [executor]
 * @returns {Promise<Object|null>}
 */
export const deleteTaskAndReturn = async (ownerId, id, executor = query) => {
  const result = await executor(
    'DELETE FROM tasks WHERE id = $1 AND owner_id = $2 RETURNING *',
    [id, ownerId],
  );
  return result.rows[0] || null;
};

/**
 * 新增任務在排入 Google 同步前標為 pending；失敗時可由重新授權回填。
 * @param {string} ownerId
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const markTaskSyncPending = async (ownerId, id) => {
  const result = await query(
    `UPDATE tasks
     SET sync_status = 'pending', synced_at = null, updated_at = now()
     WHERE id = $1 AND owner_id = $2
     RETURNING *`,
    [id, ownerId],
  );
  return result.rows[0] || null;
};

/**
 * 標記任務已同步到 Google Tasks（存 provider id）。
 * @param {string} ownerId
 * @param {string} id
 * @param {string} providerTaskId
 * @returns {Promise<Object|null>}
 */
export const markTaskSynced = async (ownerId, id, providerTaskId, executor = query) => {
  const result = await executor(
    `UPDATE tasks
     SET provider_task_id = $3, sync_status = 'synced', synced_at = now(), updated_at = now()
     WHERE id = $1 AND owner_id = $2
     RETURNING *`,
    [id, ownerId, providerTaskId ?? null],
  );
  return result.rows[0] || null;
};

/**
 * 標記任務同步失敗（保留本機任務，不刪除）。
 * @param {string} ownerId
 * @param {string} id
 * @param {string} code
 * @returns {Promise<Object|null>}
 */
export const markTaskSyncError = async (ownerId, id, code) => {
  const result = await query(
    `UPDATE tasks
     SET sync_status = 'error', updated_at = now()
     WHERE id = $1 AND owner_id = $2
     RETURNING *`,
    [id, ownerId],
  );
  return result.rows[0] || null;
};

/**
 * 授權後回補：列出尚未同步的未完成任務。
 * @param {string} ownerId
 * @param {number} [limit]
 * @returns {Promise<Array<Object>>}
 */
export const listUnsyncedTasks = async (ownerId, limit = 50) => {
  const result = await query(
    `SELECT * FROM tasks
     WHERE owner_id = $1 AND status = 'open' AND sync_status <> 'synced'
     ORDER BY created_at
     LIMIT $2`,
    [ownerId, limit],
  );
  return result.rows;
};

/**
 * Phase 2 inbound：套用 Google Tasks 端對「bot 建立」任務的外部變更。
 * 只同步完成／重開、刪除、標題與備註；**不同步 due**（Google Tasks 只有日期、
 * 對回本地會失去精確時間又有時區歧義，精確期限以本地為權威）。
 *
 * 衝突政策（全在 FOR UPDATE 鎖內判斷，對稱 Calendar inbound）：
 *  - 找不到本地列 → 不套用（不建立 Google-origin 新任務）。
 *  - 本地 sync_status ≠ 'synced'（剛用 bot 改、outbound 未推）→ 跳過讓 outbound 先贏。
 *  - 欄位與本地相同（標記剝除後）→ 不動作（擋自身 echo）。
 * 套用時設 sync_status='synced'（不觸發 outbound，防同步迴圈）。
 *
 * @param {{ ownerId: string, providerTaskId: string,
 *   incoming: { deleted?: boolean, status?: string, title?: string, notes?: string|null } }} params
 * @returns {Promise<{ applied: boolean, reason?: string, action?: string }>}
 */
export const applyInboundTaskUpdate = async ({ ownerId, providerTaskId, incoming }) => (
  withTransaction(async (client) => {
    const current = await client.query(
      'SELECT * FROM tasks WHERE owner_id = $1 AND provider_task_id = $2 FOR UPDATE',
      [ownerId, providerTaskId],
    );
    const task = current.rows[0];
    const decision = decideTaskInbound({ task });
    if (decision !== 'apply') return { applied: false, reason: decision };

    // 外部刪除 → 本地一併刪除（對稱 Calendar 刪除回收）。
    if (incoming.deleted) {
      await client.query('DELETE FROM tasks WHERE owner_id = $1 AND id = $2', [ownerId, task.id]);
      return { applied: true, action: 'deleted' };
    }

    const desiredStatus = incoming.status === 'completed' ? 'done' : 'open';
    const desiredTitle = typeof incoming.title === 'string' && incoming.title.trim()
      ? incoming.title.trim()
      : task.title; // Google 不允許空標題；保險起見缺就保留本地
    const desiredNotes = stripSyncMarker(incoming.notes, task.id);

    const unchanged = desiredStatus === task.status
      && desiredTitle === task.title
      && (desiredNotes ?? null) === (task.notes ?? null);
    if (unchanged) return { applied: false, reason: 'no_change' };

    const completedAt = desiredStatus === 'done' ? (task.completed_at ?? new Date()) : null;
    const result = await client.query(
      `UPDATE tasks SET
         title = $3, notes = $4, status = $5, completed_at = $6,
         sync_status = 'synced', synced_at = now(),
         version = version + 1, updated_at = now()
       WHERE owner_id = $1 AND id = $2
       RETURNING *`,
      [ownerId, task.id, desiredTitle, desiredNotes, desiredStatus, completedAt],
    );
    return { applied: true, action: 'updated', task: result.rows[0] };
  })
);

export default {
  applyInboundTaskUpdate,
  createTask,
  listTasks,
  getTask,
  getTaskForUpdate,
  completeTask,
  reopenTask,
  setTaskPriority,
  deleteTask,
  deleteTaskAndReturn,
  markTaskSyncPending,
  markTaskSynced,
  markTaskSyncError,
  listUnsyncedTasks,
};
