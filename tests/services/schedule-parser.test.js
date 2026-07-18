import { expect, jest, test } from '@jest/globals';
import {
  extractJson,
  resolveWeekdayDate,
  resolveRelativeDate,
  resolveRelativeInstant,
  resolveExplicitClock,
  hasAmbiguousTimePeriod,
  buildScheduleMessages,
  parseEventDraft,
} from '../../services/schedule-parser.js';

test('extractJson parses plain, fenced and surrounded JSON', () => {
  expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(extractJson('here you go: {"a":1} thanks')).toEqual({ a: 1 });
  expect(extractJson('no json here')).toBeNull();
  expect(extractJson('{bad json}')).toBeNull();
});

test('buildScheduleMessages includes the user text and context', () => {
  const messages = buildScheduleMessages({
    text: '明天開會', timezone: 'Asia/Taipei', now: new Date('2026-07-20T00:00:00Z'),
  });
  expect(messages[0].role).toBe('system');
  expect(messages[0].content).toMatch(/Asia\/Taipei/);
  expect(messages[1]).toEqual({ role: 'user', content: '明天開會' });
});

test.each([
  ['星期五開會', '2026-07-17'],
  ['週二開會', '2026-07-21'],
  ['這週二開會', '2026-07-14'],
  ['本週日聚餐', '2026-07-19'],
  ['下週二開會', '2026-07-21'],
  ['下星期日聚餐', '2026-07-26'],
  ['下個星期五看診', '2026-07-24'],
  ['這個星期二繳費', '2026-07-14'],
])('resolves weekday wording deterministically: %s -> %s', (text, expected) => {
  const result = resolveWeekdayDate({
    text,
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-15T04:00:00Z'),
  });
  expect(result.date).toBe(expected);
  const messages = buildScheduleMessages({
    text,
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-15T04:00:00Z'),
  });
  expect(messages[0].content).toContain(expected);
});

test.each([
  ['5分鐘後提醒', '2026-07-16T18:20:00.000Z'],
  ['2小時後開會', '2026-07-16T20:15:00.000Z'],
  ['1天後回診', '2026-07-17T18:15:00.000Z'],
])('resolves relative durations deterministically: %s -> %s', (text, expected) => {
  const now = new Date('2026-07-16T18:15:00Z');
  expect(resolveRelativeInstant({ text, now }).instant).toBe(expected);
  expect(buildScheduleMessages({ text, now }).at(0).content).toContain(expected);
});

test.each([
  ['每天 22:40 例行檢查', { hour: 22, minute: 40 }],
  ['每天晚上十點四十分 例行檢查', { hour: 22, minute: 40 }],
  ['明天上午十二點半 開會', { hour: 0, minute: 30 }],
  ['tomorrow at 3 pm', { hour: 15, minute: 0 }],
])('extracts an explicit local wall clock: %s', (text, expected) => {
  expect(resolveExplicitClock(text)).toMatchObject(expected);
});

test('keeps a recurring explicit clock in the user timezone when the model double-applies UTC offset', async () => {
  const complete = jest.fn().mockResolvedValue(JSON.stringify({
    title: 'RC 週期提醒驗收',
    start: '2026-07-18T14:40:00+08:00',
    end: '2026-07-18T15:40:00+08:00',
    allDay: false,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: { freq: 'DAILY', interval: 1, count: null, until: null },
    knownDate: null,
    knownTime: null,
    knownEndDate: null,
    knownEndTime: null,
    missingFields: [],
  }));
  const result = await parseEventDraft('每天 22:40 RC 週期提醒驗收', {
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-18T14:30:00Z'),
    complete,
  });
  expect(result.valid).toBe(true);
  expect(result.value).toMatchObject({
    start: '2026-07-18T14:40:00.000Z',
    end: '2026-07-18T15:40:00.000Z',
    recurrence: { freq: 'DAILY', interval: 1 },
  });
});

test('moves the first daily occurrence to tomorrow when today local wall clock has passed', async () => {
  const complete = jest.fn().mockResolvedValue(JSON.stringify({
    title: '例行檢查',
    start: '2026-07-18T14:40:00Z',
    end: null,
    allDay: false,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: { freq: 'DAILY', interval: 1, count: null, until: null },
    knownDate: null,
    knownTime: null,
    knownEndDate: null,
    knownEndTime: null,
    missingFields: [],
  }));
  const result = await parseEventDraft('每天晚上十點四十分例行檢查', {
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-18T14:45:00Z'),
    complete,
  });
  expect(result.valid).toBe(true);
  expect(result.value.start).toBe('2026-07-19T14:40:00.000Z');
});

test('overrides a model-selected start with the deterministic relative instant', async () => {
  const complete = jest.fn().mockResolvedValue(JSON.stringify({
    title: '測試通知',
    start: '2026-07-16T18:30:00Z',
    end: '2026-07-16T19:30:00Z',
    allDay: false,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: null,
    knownDate: null,
    knownTime: null,
    knownEndDate: null,
    knownEndTime: null,
    missingFields: [],
  }));
  const result = await parseEventDraft('5分鐘後的測試通知', {
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-16T18:15:00Z'),
    complete,
  });
  expect(result.valid).toBe(true);
  expect(result.value.start).toBe('2026-07-16T18:20:00.000Z');
  expect(result.value.end).toBe('2026-07-16T19:20:00.000Z');
});

test.each([
  ['今天開會', '2026-07-17'],
  ['明天看診', '2026-07-18'],
  ['後天繳費', '2026-07-19'],
])('resolves relative dates at the user timezone day boundary: %s -> %s', (text, expected) => {
  const result = resolveRelativeDate({
    text,
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-16T16:29:00Z'),
  });
  expect(result.date).toBe(expected);
});

test.each([
  ['明天下午看診', true],
  ['明天晚上開會', true],
  ['明天下午三點看診', false],
  ['明天 15:00 看診', false],
  ['明天下午茶', false],
])('detects time periods without an explicit clock: %s', (text, expected) => {
  expect(hasAmbiguousTimePeriod(text)).toBe(expected);
});

test('parseEventDraft validates the model JSON output', async () => {
  const complete = jest.fn().mockResolvedValue('{"title":"開會","start":"2026-07-20T07:00:00Z"}');
  const result = await parseEventDraft('明天下午三點開會', { timezone: 'Asia/Taipei', complete });
  expect(complete).toHaveBeenCalled();
  expect(result.valid).toBe(true);
  expect(result.value.title).toBe('開會');
});

test('parseEventDraft returns a structured clarification without accepting an incomplete draft', async () => {
  const complete = jest.fn().mockResolvedValue(JSON.stringify({
    title: '看診',
    start: null,
    end: null,
    allDay: false,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: null,
    knownDate: '2026-07-16',
    knownTime: null,
    knownEndDate: null,
    knownEndTime: null,
    missingFields: ['time'],
  }));
  const result = await parseEventDraft('明天下午看診', {
    timezone: 'Asia/Taipei', now: new Date('2026-07-15T04:00:00Z'), complete,
  });
  expect(result).toEqual({
    valid: false,
    needsClarification: true,
    errors: [],
    missingFields: ['time'],
    value: {
      title: '看診',
      start: null,
      end: null,
      allDay: false,
      timezone: 'Asia/Taipei',
      location: null,
      notes: null,
      recurrence: null,
      knownDate: '2026-07-16',
      knownTime: null,
      knownEndDate: null,
      knownEndTime: null,
    },
  });
});

test('overrides a model-invented time and wrong UTC-boundary date with clarification', async () => {
  const complete = jest.fn().mockResolvedValue(JSON.stringify({
    title: '看診',
    start: '2026-07-17T15:00:00+08:00',
    end: '2026-07-17T16:00:00+08:00',
    allDay: false,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: null,
    knownDate: null,
    knownTime: null,
    knownEndDate: null,
    knownEndTime: null,
    missingFields: [],
  }));
  const result = await parseEventDraft('明天下午看診', {
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-16T16:29:00Z'),
    complete,
  });
  expect(result.needsClarification).toBe(true);
  expect(result.missingFields).toEqual(['time']);
  expect(result.value).toMatchObject({
    title: '看診', knownDate: '2026-07-18', knownTime: null, start: null, end: null,
  });
});

test('realigns a model-selected tomorrow date while preserving explicit local time and duration', async () => {
  const complete = jest.fn().mockResolvedValue(JSON.stringify({
    title: '看診',
    start: '2026-07-17T15:00:00+08:00',
    end: '2026-07-17T16:00:00+08:00',
    allDay: false,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: null,
    knownDate: null,
    knownTime: null,
    knownEndDate: null,
    knownEndTime: null,
    missingFields: [],
  }));
  const result = await parseEventDraft('明天下午三點看診', {
    timezone: 'Asia/Taipei',
    now: new Date('2026-07-16T16:29:00Z'),
    complete,
  });
  expect(result.valid).toBe(true);
  expect(result.value.start).toBe('2026-07-18T07:00:00.000Z');
  expect(result.value.end).toBe('2026-07-18T08:00:00.000Z');
});

test('keeps the durable date when the clarification answer only supplies a clock time', async () => {
  const complete = jest.fn().mockResolvedValue(JSON.stringify({
    title: '看診',
    start: '2026-07-17T15:00:00+08:00',
    end: '2026-07-17T16:00:00+08:00',
    allDay: false,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: null,
    knownDate: null,
    knownTime: null,
    knownEndDate: null,
    knownEndTime: null,
    missingFields: [],
  }));
  const result = await parseEventDraft('下午三點', {
    timezone: 'Asia/Taipei',
    baseDraft: { title: '看診', knownDate: '2026-07-18', knownTime: null },
    complete,
  });
  expect(result.valid).toBe(true);
  expect(result.value.start).toBe('2026-07-18T07:00:00.000Z');
  expect(result.value.end).toBe('2026-07-18T08:00:00.000Z');
});

test('buildScheduleMessages includes a structured base draft for an edit follow-up', () => {
  const baseDraft = {
    title: '看診', start: '2026-07-20T07:00:00+08:00', allDay: false,
  };
  const messages = buildScheduleMessages({
    text: '改到下午四點',
    timezone: 'Asia/Taipei',
    mode: 'update',
    baseDraft,
  });
  expect(messages[0].content).toMatch(/修改既有行程/);
  expect(messages[0].content).toContain(JSON.stringify(baseDraft));
});

test('a create follow-up also includes its structured partial draft', () => {
  const baseDraft = { title: '看診', knownDate: '2026-07-16', knownTime: null };
  const messages = buildScheduleMessages({
    text: '下午三點', timezone: 'Asia/Taipei', baseDraft,
  });
  expect(messages[0].content).toContain(JSON.stringify(baseDraft));
  expect(messages[0].content).toMatch(/不可丟失/);
});

test('parseEventDraft reports invalid model output', async () => {
  const complete = jest.fn().mockResolvedValue('抱歉我不知道');
  const result = await parseEventDraft('???', { complete });
  expect(result.valid).toBe(false);
  expect(result.errors).toContain('model did not return valid JSON');
});

test('parseEventDraft rejects model-invented fields via the schema', async () => {
  const complete = jest.fn().mockResolvedValue('{"title":"x","start":"2026-07-20T07:00:00Z","color":"red"}');
  const result = await parseEventDraft('x', { complete });
  expect(result.valid).toBe(false);
  expect(result.errors).toContain('unknown field: color');
});

test('parseEventDraft also rejects unknown fields in an incomplete draft', async () => {
  const complete = jest.fn().mockResolvedValue(JSON.stringify({
    title: '看診',
    start: null,
    end: null,
    allDay: false,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: null,
    knownDate: '2026-07-16',
    knownTime: null,
    knownEndDate: null,
    knownEndTime: null,
    missingFields: ['time'],
    sql: 'drop table events',
  }));
  const result = await parseEventDraft('明天下午看診', { complete });
  expect(result.valid).toBe(false);
  expect(result.errors).toContain('unknown field: sql');
});

test('parseEventDraft throws without a complete function', async () => {
  await expect(parseEventDraft('x', {})).rejects.toThrow('complete');
});
