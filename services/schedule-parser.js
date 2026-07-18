import { validateEventDraft } from '../schemas/event-draft.js';

// 自然語言 -> event draft。LLM 呼叫由外部以 `complete` 注入（方便測試與解耦），
// 模型輸出一律再經 schemas/event-draft.js 確定性驗證，不信任模型直接寫入。

/**
 * 從模型輸出擷取第一個 JSON 物件（容忍 ```json 圍欄與前後說明文字）。
 * @param {string} text
 * @returns {Object|null}
 */
export const extractJson = (text) => {
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : String(text);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
};

const OUTPUT_FIELDS = new Set([
  'title', 'start', 'end', 'allDay', 'timezone', 'location', 'notes', 'recurrence',
  'knownDate', 'knownTime', 'knownEndDate', 'knownEndTime', 'missingFields',
]);

const validHint = (value, pattern) => value === null || pattern.test(value);

const WEEKDAY_INDEX = {
  一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6,
};

const RELATIVE_DATE_OFFSETS = [
  { pattern: /(?:大後天|大後日)/u, offset: 3 },
  { pattern: /後天/u, offset: 2 },
  { pattern: /(?:明天|明日)/u, offset: 1 },
  { pattern: /(?:今天|今日)/u, offset: 0 },
  { pattern: /昨天/u, offset: -1 },
];

const RELATIVE_TIME_UNITS = {
  分: 60000,
  分鐘: 60000,
  小時: 3600000,
  鐘頭: 3600000,
  天: 86400000,
};

const AMBIGUOUS_TIME_PERIOD = /(?:凌晨|清晨|早上|上午|中午|下午(?!茶)|傍晚|晚上|晚間|夜間|半夜)/u;
const EXPLICIT_TIME = /(?:[01]?\d|2[0-3]):[0-5]\d|(?:[01]?\d|2[0-3])\s*(?:am|pm)|[零〇一二兩三四五六七八九十\d]{1,3}\s*(?:點|時|时)(?:\s*(?:半|[零〇一二兩三四五六七八九十\d]{1,3}\s*分))?/iu;
const DATE_REFERENCE = /(?:大後天|後天|明天|今天|昨天|(?:本|這|下)(?:個)?(?:星期|週|周)|(?:本|這|下)?(?:個)?(?:星期|週|周)[一二三四五六日天]|(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*(?:\/|-)\s*\d{1,2})/u;

const CHINESE_DIGITS = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const parseClockNumber = (value) => {
  if (/^\d+$/u.test(value)) return Number(value);
  if (value === '十') return 10;
  const [tens, ones = ''] = value.split('十');
  if (value.includes('十')) {
    const tensValue = tens === '' ? 1 : CHINESE_DIGITS[tens];
    const onesValue = ones === '' ? 0 : CHINESE_DIGITS[ones];
    return tensValue == null || onesValue == null ? null : tensValue * 10 + onesValue;
  }
  return CHINESE_DIGITS[value] ?? null;
};

/** 擷取使用者明確寫出的當地鐘點，避免模型把 UTC offset 套用兩次。 */
export const resolveExplicitClock = (text) => {
  const colon = text.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/u);
  if (colon) return { hour: Number(colon[1]), minute: Number(colon[2]), phrase: colon[0].trim() };

  const meridiem = text.match(/\b(1[0-2]|0?\d)\s*(am|pm)\b/iu);
  if (meridiem) {
    const base = Number(meridiem[1]) % 12;
    return {
      hour: base + (meridiem[2].toLowerCase() === 'pm' ? 12 : 0),
      minute: 0,
      phrase: meridiem[0],
    };
  }

  const chinese = text.match(/(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|晚間|夜間|半夜)?\s*([零〇一二兩三四五六七八九十\d]{1,3})\s*(?:點|時|时)(?:\s*(半|[零〇一二兩三四五六七八九十\d]{1,3})\s*分?)?/u);
  if (!chinese) return null;
  let hour = parseClockNumber(chinese[2]);
  const minute = chinese[3] === '半' ? 30 : parseClockNumber(chinese[3] || '零');
  if (hour == null || minute == null || hour > 23 || minute > 59) return null;
  const period = chinese[1];
  if (['下午', '傍晚', '晚上', '晚間', '夜間'].includes(period) && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;
  if (['凌晨', '清晨', '早上', '上午', '半夜'].includes(period) && hour === 12) hour = 0;
  return { hour, minute, phrase: chinese[0].trim() };
};

const localDateParts = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day') };
};

const localDateTimeParts = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
};

const isoDateOffset = ({ year, month, day }, offset) => {
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return date.toISOString().slice(0, 10);
};

/**
 * 將「星期／週」解析成確定日期，避免模型自行選擇本週或下週。
 * 裸星期採下一個尚未跨過的同名日；「本／這週」與「下週」依字面固定。
 */
export const resolveWeekdayDate = ({ text, now = new Date(), timezone = null }) => {
  const match = text.match(/(?:(本|這|下)(?:個)?)?(?:星期|週|周)([一二三四五六日天])/u);
  if (!match) return null;
  const [, mode, weekday] = match;
  const local = localDateParts(now, timezone);
  const currentDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const currentIndex = (currentDate.getUTCDay() + 6) % 7;
  const targetIndex = WEEKDAY_INDEX[weekday];
  let offset;
  if (mode === '本' || mode === '這') offset = targetIndex - currentIndex;
  else if (mode === '下') offset = 7 - currentIndex + targetIndex;
  else offset = (targetIndex - currentIndex + 7) % 7;
  return { phrase: match[0], date: isoDateOffset(local, offset) };
};

/** 將今天／明天／後天依使用者時區轉成確切日期，不以 UTC 日界交給模型猜。 */
export const resolveRelativeDate = ({ text, now = new Date(), timezone = null }) => {
  const rule = RELATIVE_DATE_OFFSETS.find(({ pattern }) => pattern.test(text));
  if (!rule) return null;
  const match = text.match(rule.pattern);
  return {
    phrase: match[0],
    date: isoDateOffset(localDateParts(now, timezone), rule.offset),
  };
};

/** 將「N 分鐘／小時／天後」轉成確切時間點，不讓模型自行做時間加法。 */
export const resolveRelativeInstant = ({ text, now = new Date() }) => {
  const match = text.match(/(\d{1,4})\s*(分鐘|分|小時|鐘頭|天)後/u);
  if (!match) return null;
  const amount = Number(match[1]);
  const instant = new Date(now.getTime() + amount * RELATIVE_TIME_UNITS[match[2]]);
  return { phrase: match[0], instant: instant.toISOString() };
};

/** 任務只有「本週／下週」而沒有星期幾時，以該週週日作為確定期限日。 */
export const resolveWeekEndDate = ({ text, now = new Date(), timezone = null }) => {
  const match = text.match(/((本|這|下)(?:個)?(?:星期|週|周))(?![一二三四五六日天])/u);
  if (!match) return null;
  const local = localDateParts(now, timezone);
  const currentDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const currentIndex = (currentDate.getUTCDay() + 6) % 7;
  const offset = (match[2] === '下' ? 13 : 6) - currentIndex;
  return { phrase: match[1], date: isoDateOffset(local, offset) };
};

export const hasAmbiguousTimePeriod = (text) => (
  AMBIGUOUS_TIME_PERIOD.test(text) && !EXPLICIT_TIME.test(text)
);

const dateOrdinal = ({ year, month, day }) => Math.floor(Date.UTC(year, month - 1, day) / 86400000);

const wallClockToInstant = (parts, timezone) => {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = new Date(target);
  for (let i = 0; i < 2; i += 1) {
    const actual = localDateTimeParts(instant, timezone);
    const actualWallClock = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    instant = new Date(instant.getTime() + target - actualWallClock);
  }
  return instant;
};

/** 把使用者時區的日期與時間轉成 UTC ISO 字串。 */
export const localDateTimeToIso = (date, time, timezone) => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return wallClockToInstant({
    year, month, day, hour, minute, second: 0,
  }, timezone).toISOString();
};

/** 將一個時間點移到指定的使用者當地日期，同時保留當地鐘點。 */
export const alignDateTimeToDate = (value, targetDate, timezone) => {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || !/^\d{4}-\d{2}-\d{2}$/u.test(targetDate)) return value;
  const parts = localDateTimeParts(instant, timezone);
  const [year, month, day] = targetDate.split('-').map(Number);
  return wallClockToInstant({
    ...parts, year, month, day,
  }, timezone).toISOString();
};

const alignDraftToDate = (draft, targetDate, timezone) => {
  if (draft.start == null) return draft;
  const start = new Date(draft.start);
  if (Number.isNaN(start.getTime())) return draft;
  const startParts = localDateTimeParts(start, timezone);
  const [year, month, day] = targetDate.split('-').map(Number);
  const targetOrdinal = dateOrdinal({ year, month, day });
  const sourceOrdinal = dateOrdinal(startParts);
  const align = (value) => {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return value;
    const parts = localDateTimeParts(instant, timezone);
    const dayOffset = dateOrdinal(parts) - sourceOrdinal;
    const desiredDate = new Date((targetOrdinal + dayOffset) * 86400000);
    return wallClockToInstant({
      ...parts,
      year: desiredDate.getUTCFullYear(),
      month: desiredDate.getUTCMonth() + 1,
      day: desiredDate.getUTCDate(),
    }, timezone).toISOString();
  };
  return {
    ...draft,
    start: align(draft.start),
    ...(draft.end != null ? { end: align(draft.end) } : {}),
  };
};

const alignDraftToInstant = (draft, targetInstant) => {
  const target = new Date(targetInstant);
  if (Number.isNaN(target.getTime())) return draft;
  const originalStart = new Date(draft.start);
  const originalEnd = new Date(draft.end);
  const hasDuration = !Number.isNaN(originalStart.getTime())
    && !Number.isNaN(originalEnd.getTime())
    && originalEnd > originalStart;
  const duration = originalEnd.getTime() - originalStart.getTime();
  return {
    ...draft,
    start: target.toISOString(),
    ...(hasDuration
      ? { end: new Date(target.getTime() + duration).toISOString() }
      : { end: null }),
    allDay: false,
  };
};

const alignDraftToExplicitClock = (draft, clock, timezone, now, hasDateReference) => {
  const originalStart = new Date(draft.start);
  if (Number.isNaN(originalStart.getTime())) return draft;
  const originalEnd = new Date(draft.end);
  const hasDuration = !Number.isNaN(originalEnd.getTime()) && originalEnd > originalStart;
  const duration = originalEnd.getTime() - originalStart.getTime();
  let date = localDateParts(originalStart, timezone);

  // 「每天 22:40」沒有指定日期時，第一筆固定選下一個尚未經過的當地鐘點。
  if (draft.recurrence?.freq === 'DAILY' && !hasDateReference) {
    date = localDateParts(now, timezone);
    const today = wallClockToInstant({ ...date, ...clock, second: 0 }, timezone);
    if (today <= now) date = localDateParts(new Date(today.getTime() + 86400000), timezone);
  }

  const start = wallClockToInstant({ ...date, ...clock, second: 0 }, timezone);
  return {
    ...draft,
    start: start.toISOString(),
    ...(hasDuration ? { end: new Date(start.getTime() + duration).toISOString() } : {}),
    allDay: false,
  };
};

const dateFromDraft = (draft, timezone) => {
  if (draft?.knownDate && /^\d{4}-\d{2}-\d{2}$/u.test(draft.knownDate)) {
    return draft.knownDate;
  }
  if (draft?.start == null) return null;
  const start = new Date(draft.start);
  if (Number.isNaN(start.getTime())) return null;
  return isoDateOffset(localDateParts(start, timezone), 0);
};

/**
 * 組出要求模型輸出 event-draft JSON 的訊息。
 * @param {{ text: string, now?: Date, timezone?: string|null }} params
 * @returns {Array<{ role: string, content: string }>}
 */
export const buildScheduleMessages = ({
  text, now = new Date(), timezone = null, mode = 'create', baseDraft = null,
}) => {
  const weekday = resolveWeekdayDate({ text, now, timezone });
  const relativeDate = resolveRelativeDate({ text, now, timezone });
  const relativeInstant = resolveRelativeInstant({ text, now });
  const explicitClock = resolveExplicitClock(text);
  const dateHint = weekday || relativeDate;
  const system = [
    '你是一個把中文自然語言轉成單一行程 JSON 的解析器。',
    '只輸出 JSON，不要多餘文字。允許欄位：title、start、end、allDay、timezone、location、notes、recurrence、knownDate、knownTime、knownEndDate、knownEndTime、missingFields。',
    'start／end 用 ISO 8601；相對日期以使用者時區與「現在」為基準解析；不確定的欄位不要臆造。',
    'missingFields 只能是 title、date、time、endDate、endTime；沒有缺少資訊時輸出空陣列。',
    '只有日期但沒有時間的陳述視為整天行程，不要追問時間；「下午」、「晚上」這種沒有幾點的模糊時段要列入 time。',
    '只有時間沒有日期時列入 date；跨日結束但無法確定日期時列入 endDate。',
    '已確定但還不足以組成 start／end 的部分，分別放入 knownDate（YYYY-MM-DD）、knownTime（HH:mm）、knownEndDate、knownEndTime；完整時這四欄為 null。',
    '未寫「本週／這週／下週」的星期幾，代表下一個該星期；本週或這週依本週字面，下週依下一週字面。',
    ...(baseDraft ? [
      `上一步已解析的結構化草稿：${JSON.stringify(baseDraft)}`,
      '合併這次回答與上一步草稿，不可丟失已確定的日期、時間或事由。',
    ] : []),
    ...(mode === 'update' ? [
      '這是修改既有行程；以現有結構化草稿為基礎，只套用使用者這次明確說的變更。',
    ] : []),
    ...(dateHint ? [`日期解消提示：原文「${dateHint.phrase}」在使用者時區對應 ${dateHint.date}，必須使用這個日期。`] : []),
    ...(relativeInstant ? [`相對時間解消提示：原文「${relativeInstant.phrase}」對應 ${relativeInstant.instant}，start 必須使用這個確切時間。`] : []),
    ...(explicitClock ? [`明確鐘點提示：原文「${explicitClock.phrase}」是使用者時區的 ${String(explicitClock.hour).padStart(2, '0')}:${String(explicitClock.minute).padStart(2, '0')}，不可再套用 UTC offset。`] : []),
    `現在時間：${now.toISOString()}。使用者時區：${timezone || '未提供'}。`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];
};

/**
 * 解析自然語言為已驗證的 event draft。
 * @param {string} text
 * @param {{ now?: Date, timezone?: string|null, complete: (messages: Array) => Promise<string> }} options
 * @returns {Promise<{ valid: boolean, errors: string[], value: Object|null }>}
 */
export const parseEventDraft = async (text, {
  now = new Date(), timezone = null, complete, mode = 'create', baseDraft = null,
}) => {
  if (typeof complete !== 'function') throw new Error('complete function is required');
  const messages = buildScheduleMessages({
    text, now, timezone, mode, baseDraft,
  });
  const output = await complete(messages);
  const json = extractJson(output ?? '');
  if (!json) return { valid: false, errors: ['model did not return valid JSON'], value: null };
  const unknownField = Object.keys(json).find((field) => !OUTPUT_FIELDS.has(field));
  if (unknownField) {
    return { valid: false, errors: [`unknown field: ${unknownField}`], value: null };
  }
  const {
    missingFields = [],
    knownDate = null,
    knownTime = null,
    knownEndDate = null,
    knownEndTime = null,
    ...draft
  } = json;
  const allowedMissingFields = new Set(['title', 'date', 'time', 'endDate', 'endTime']);
  if (!Array.isArray(missingFields)
    || missingFields.some((field) => !allowedMissingFields.has(field))) {
    return { valid: false, errors: ['invalid missingFields'], value: null };
  }
  const validDateHints = [knownDate, knownEndDate]
    .every((value) => validHint(value, /^\d{4}-\d{2}-\d{2}$/u));
  const validTimeHints = [knownTime, knownEndTime]
    .every((value) => validHint(value, /^(?:[01]\d|2[0-3]):[0-5]\d$/u));
  if (!validDateHints || !validTimeHints) {
    return { valid: false, errors: ['invalid structured date/time hint'], value: null };
  }
  const dateHint = resolveWeekdayDate({ text, now, timezone })
    || resolveRelativeDate({ text, now, timezone });
  const relativeInstant = resolveRelativeInstant({ text, now });
  const explicitClock = resolveExplicitClock(text);
  const inheritedDate = DATE_REFERENCE.test(text) ? null : dateFromDraft(baseDraft, timezone);
  const targetDate = dateHint?.date ?? inheritedDate;
  let normalizedDraft = targetDate ? alignDraftToDate(draft, targetDate, timezone) : draft;
  let normalizedKnownDate = knownDate;
  let normalizedKnownTime = knownTime;
  let normalizedMissingFields = [...missingFields];
  if (relativeInstant) {
    normalizedDraft = alignDraftToInstant(normalizedDraft, relativeInstant.instant);
    normalizedKnownDate = null;
    normalizedKnownTime = null;
    normalizedMissingFields = normalizedMissingFields
      .filter((field) => field !== 'date' && field !== 'time');
  } else if (explicitClock && normalizedDraft.start != null) {
    normalizedDraft = alignDraftToExplicitClock(
      normalizedDraft,
      explicitClock,
      timezone,
      now,
      DATE_REFERENCE.test(text),
    );
    normalizedKnownTime = null;
    normalizedMissingFields = normalizedMissingFields.filter((field) => field !== 'time');
  }
  if (hasAmbiguousTimePeriod(text)) {
    const dateSource = normalizedDraft.start ?? baseDraft?.start;
    normalizedKnownDate = targetDate
      ?? normalizedKnownDate
      ?? (dateSource ? isoDateOffset(localDateParts(new Date(dateSource), timezone), 0) : null);
    normalizedKnownTime = null;
    normalizedDraft = {
      ...normalizedDraft,
      start: null,
      end: null,
      allDay: false,
    };
    normalizedMissingFields.push('time');
  }
  if (normalizedMissingFields.length > 0) {
    return {
      valid: false,
      needsClarification: true,
      errors: [],
      missingFields: [...new Set(normalizedMissingFields)],
      value: {
        ...normalizedDraft,
        knownDate: normalizedKnownDate,
        knownTime: normalizedKnownTime,
        knownEndDate,
        knownEndTime,
      },
    };
  }
  return validateEventDraft(normalizedDraft);
};

export default {
  extractJson,
  resolveWeekdayDate,
  resolveRelativeDate,
  resolveRelativeInstant,
  alignDateTimeToDate,
  hasAmbiguousTimePeriod,
  buildScheduleMessages,
  parseEventDraft,
};
