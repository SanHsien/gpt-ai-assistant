import { expect, test } from '@jest/globals';
import { validateEventDraft } from '../../schemas/event-draft.js';

test('accepts and normalizes a valid timed event', () => {
  const { valid, value } = validateEventDraft({
    title: '  開會  ',
    start: '2026-07-20T15:00:00+08:00',
    end: '2026-07-20T17:00:00+08:00',
    timezone: 'Asia/Taipei',
    location: '台北',
  });
  expect(valid).toBe(true);
  expect(value.title).toBe('開會');
  expect(value.allDay).toBe(false);
  expect(value.start).toBe(new Date('2026-07-20T15:00:00+08:00').toISOString());
  expect(value.end).toBe(new Date('2026-07-20T17:00:00+08:00').toISOString());
  expect(value.timezone).toBe('Asia/Taipei');
});

test('rejects unknown fields (model must not invent fields)', () => {
  const { valid, errors } = validateEventDraft({
    title: 'x', start: '2026-07-20T10:00:00Z', color: 'red',
  });
  expect(valid).toBe(false);
  expect(errors).toContain('unknown field: color');
});

test('requires a non-empty title and a start', () => {
  expect(validateEventDraft({ title: '   ', start: '2026-07-20T10:00:00Z' }).valid).toBe(false);
  const missingStart = validateEventDraft({ title: 'x' });
  expect(missingStart.valid).toBe(false);
  expect(missingStart.errors).toContain('start is required');
});

test('rejects invalid dates and end before start', () => {
  expect(validateEventDraft({ title: 'x', start: 'not-a-date' }).errors)
    .toContain('start is not a valid date');
  const bad = validateEventDraft({
    title: 'x', start: '2026-07-20T12:00:00Z', end: '2026-07-20T11:00:00Z',
  });
  expect(bad.valid).toBe(false);
  expect(bad.errors).toContain('end must be after start');
});

test('validates timezone as IANA', () => {
  expect(validateEventDraft({ title: 'x', start: '2026-07-20T10:00:00Z', timezone: 'Mars/Phobos' }).valid)
    .toBe(false);
});

test('accepts a valid recurrence and rejects a bad one', () => {
  const ok = validateEventDraft({
    title: 'x', start: '2026-07-20T10:00:00Z', recurrence: { freq: 'WEEKLY', interval: 2 },
  });
  expect(ok.valid).toBe(true);
  expect(ok.value.recurrence).toEqual({ freq: 'WEEKLY', interval: 2 });

  const badFreq = validateEventDraft({
    title: 'x', start: '2026-07-20T10:00:00Z', recurrence: { freq: 'FORTNIGHTLY' },
  });
  expect(badFreq.valid).toBe(false);
  expect(badFreq.errors).toContain('recurrence.freq must be one of DAILY/WEEKLY/MONTHLY/YEARLY');

  const badField = validateEventDraft({
    title: 'x', start: '2026-07-20T10:00:00Z', recurrence: { freq: 'DAILY', forever: true },
  });
  expect(badField.errors).toContain('unknown recurrence field: forever');
});

test('handles all-day flag and rejects non-boolean allDay', () => {
  expect(validateEventDraft({ title: 'x', start: '2026-07-20', allDay: true }).value.allDay).toBe(true);
  expect(validateEventDraft({ title: 'x', start: '2026-07-20', allDay: 'yes' }).valid).toBe(false);
});

test('rejects a non-object draft', () => {
  expect(validateEventDraft(null).valid).toBe(false);
  expect(validateEventDraft('nope').valid).toBe(false);
});

test('normalizes null optional fields as omitted model output', () => {
  const result = validateEventDraft({
    title: '看診',
    start: '2026-07-15T07:00:00.000Z',
    end: null,
    allDay: null,
    timezone: 'Asia/Taipei',
    location: null,
    notes: null,
    recurrence: null,
  });
  expect(result).toEqual({
    valid: true,
    errors: [],
    value: {
      title: '看診',
      start: '2026-07-15T07:00:00.000Z',
      allDay: false,
      timezone: 'Asia/Taipei',
    },
  });
});

test('normalizes null optional recurrence members as omitted', () => {
  const result = validateEventDraft({
    title: '每日站會',
    start: '2026-07-15T01:00:00.000Z',
    recurrence: {
      freq: 'DAILY', interval: null, count: null, until: null,
    },
  });
  expect(result.valid).toBe(true);
  expect(result.value.recurrence).toEqual({ freq: 'DAILY' });
});
