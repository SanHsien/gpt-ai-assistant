// event-draft 確定性驗證器：把模型產生的行程草稿驗證並正規化。
// 刻意「拒絕未定義欄位」，不讓模型自由塞欄位；所有寫入前都必須通過此驗證。

const ALLOWED_KEYS = new Set([
  'title', 'start', 'end', 'allDay', 'timezone', 'location', 'notes', 'recurrence',
]);
const RECURRENCE_KEYS = new Set(['freq', 'interval', 'count', 'until']);
const RECURRENCE_FREQS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

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

const isPositiveInteger = (value) => Number.isInteger(value) && value >= 1;

const validateRecurrence = (recurrence, errors) => {
  if (recurrence == null || typeof recurrence !== 'object' || Array.isArray(recurrence)) {
    errors.push('recurrence must be an object');
    return null;
  }
  Object.keys(recurrence).forEach((key) => {
    if (!RECURRENCE_KEYS.has(key)) errors.push(`unknown recurrence field: ${key}`);
  });
  if (!RECURRENCE_FREQS.has(recurrence.freq)) {
    errors.push('recurrence.freq must be one of DAILY/WEEKLY/MONTHLY/YEARLY');
  }
  if (recurrence.interval != null && !isPositiveInteger(recurrence.interval)) {
    errors.push('recurrence.interval must be a positive integer');
  }
  if (recurrence.count != null && !isPositiveInteger(recurrence.count)) {
    errors.push('recurrence.count must be a positive integer');
  }
  let until = null;
  if (recurrence.until != null) {
    until = parseDate(recurrence.until);
    if (!until) errors.push('recurrence.until must be a valid date');
  }
  if (errors.length > 0) return null;
  return {
    freq: recurrence.freq,
    ...(recurrence.interval != null ? { interval: recurrence.interval } : {}),
    ...(recurrence.count != null ? { count: recurrence.count } : {}),
    ...(until ? { until: until.toISOString() } : {}),
  };
};

/**
 * 驗證並正規化一個 event draft。
 * @param {Object} draft
 * @returns {{ valid: boolean, errors: string[], value: Object|null }}
 */
export const validateEventDraft = (draft) => {
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

  if (draft.allDay != null && typeof draft.allDay !== 'boolean') {
    errors.push('allDay must be a boolean');
  }

  let start = null;
  if (draft.start === undefined) errors.push('start is required');
  else {
    start = parseDate(draft.start);
    if (!start) errors.push('start is not a valid date');
  }

  let end = null;
  if (draft.end != null) {
    end = parseDate(draft.end);
    if (!end) errors.push('end is not a valid date');
  }
  if (start && end && end <= start) errors.push('end must be after start');

  if (draft.timezone != null && !isValidTimezone(draft.timezone)) {
    errors.push('timezone must be a valid IANA timezone');
  }

  ['location', 'notes'].forEach((key) => {
    if (draft[key] != null && typeof draft[key] !== 'string') {
      errors.push(`${key} must be a string`);
    }
  });

  let recurrence;
  if (draft.recurrence != null) {
    recurrence = validateRecurrence(draft.recurrence, errors);
  }

  if (errors.length > 0) return { valid: false, errors, value: null };

  const value = {
    title: draft.title.trim(),
    start: start.toISOString(),
    allDay: draft.allDay === true,
    ...(end ? { end: end.toISOString() } : {}),
    ...(draft.timezone != null ? { timezone: draft.timezone } : {}),
    ...(draft.location != null ? { location: draft.location } : {}),
    ...(draft.notes != null ? { notes: draft.notes } : {}),
    ...(recurrence ? { recurrence } : {}),
  };
  return { valid: true, errors: [], value };
};

export default validateEventDraft;
