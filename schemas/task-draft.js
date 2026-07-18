// task-draft 確定性驗證器：驗證並正規化一個任務草稿。
// 與 event-draft 同樣「拒絕未定義欄位」，所有寫入前都必須通過此驗證。

const ALLOWED_KEYS = new Set(['title', 'notes', 'dueAt', 'timezone', 'priority', 'tags']);
const PRIORITIES = new Set(['high', 'normal', 'low']);
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 20;

const normalizeTags = (tags, errors) => {
  if (!Array.isArray(tags)) {
    errors.push('tags must be an array');
    return null;
  }
  const cleaned = [];
  const seen = new Set();
  tags.forEach((tag) => {
    if (typeof tag !== 'string') {
      errors.push('each tag must be a string');
      return;
    }
    const value = tag
      .normalize('NFKC')
      .replace(/^#/, '')
      .replace(/[。！？.!?,，；;：:]+$/u, '')
      .trim()
      .slice(0, MAX_TAG_LENGTH);
    if (value && !seen.has(value)) {
      seen.add(value);
      cleaned.push(value);
    }
  });
  return cleaned.slice(0, MAX_TAGS);
};

const isValidTimezone = (tz) => {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * 驗證並正規化一個 task draft。
 * @param {Object} draft
 * @returns {{ valid: boolean, errors: string[], value: Object|null }}
 */
export const validateTaskDraft = (draft) => {
  const errors = [];
  if (draft == null || typeof draft !== 'object' || Array.isArray(draft)) {
    return { valid: false, errors: ['draft must be an object'], value: null };
  }

  Object.keys(draft).forEach((key) => {
    if (!ALLOWED_KEYS.has(key)) errors.push(`unknown field: ${key}`);
  });

  if (typeof draft.title !== 'string' || draft.title.trim() === '') {
    errors.push('title is required');
  }

  if (draft.notes != null && typeof draft.notes !== 'string') {
    errors.push('notes must be a string');
  }

  let dueAt = null;
  if (draft.dueAt != null) {
    dueAt = parseDate(draft.dueAt);
    if (!dueAt) errors.push('dueAt is not a valid date');
  }

  if (draft.timezone != null && !isValidTimezone(draft.timezone)) {
    errors.push('timezone must be a valid IANA timezone');
  }

  if (draft.priority != null && !PRIORITIES.has(draft.priority)) {
    errors.push('priority must be one of high/normal/low');
  }

  let tags = null;
  if (draft.tags != null) {
    tags = normalizeTags(draft.tags, errors);
  }

  if (errors.length > 0) return { valid: false, errors, value: null };

  const value = {
    title: draft.title.trim(),
    ...(draft.notes != null ? { notes: draft.notes } : {}),
    ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
    ...(draft.timezone != null ? { timezone: draft.timezone } : {}),
    ...(draft.priority != null && draft.priority !== 'normal' ? { priority: draft.priority } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
  return { valid: true, errors: [], value };
};

export default validateTaskDraft;
