// 確認 state machine：草稿 -> 確認/取消。這是單次轉移的純函式；
// 多 instance 的 exactly-once 寫入必須使用 repositories/confirmations.js 的 DB row lock + transaction。

export const CONFIRMATION_STATES = Object.freeze({
  DRAFT: 'draft',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
});

export const CONFIRMATION_ACTIONS = Object.freeze({
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
});

const TERMINAL = new Set([CONFIRMATION_STATES.CONFIRMED, CONFIRMATION_STATES.CANCELLED]);

/**
 * @param {string} state
 * @returns {boolean} 是否為終態（confirmed / cancelled）。
 */
export const isTerminal = (state) => TERMINAL.has(state);

/**
 * 純轉移。回傳 { state, commit, changed }：
 * - `commit` 只在 `draft -> confirmed` 首次為 true（代表此刻執行一次性寫入）。
 * - 終態或未知 action 一律不轉移、不 commit（冪等）。
 * @param {string} currentState
 * @param {string} action
 * @returns {{ state: string, commit: boolean, changed: boolean }}
 */
export const transition = (currentState, action) => {
  if (currentState === CONFIRMATION_STATES.DRAFT && action === CONFIRMATION_ACTIONS.CONFIRM) {
    return { state: CONFIRMATION_STATES.CONFIRMED, commit: true, changed: true };
  }
  if (currentState === CONFIRMATION_STATES.DRAFT && action === CONFIRMATION_ACTIONS.CANCEL) {
    return { state: CONFIRMATION_STATES.CANCELLED, commit: false, changed: true };
  }
  return { state: currentState, commit: false, changed: false };
};

/**
 * 套用一次 action，並在（且僅在）首次確認時執行 `commitFn` 一次。
 * @param {string} currentState
 * @param {string} action
 * @param {() => Promise<*>} [commitFn]
 * @returns {Promise<{ state: string, commit: boolean, changed: boolean }>}
 */
export const settle = async (currentState, action, commitFn) => {
  const result = transition(currentState, action);
  if (result.commit && typeof commitFn === 'function') await commitFn();
  return result;
};

export default {
  CONFIRMATION_STATES, CONFIRMATION_ACTIONS, isTerminal, transition, settle,
};
