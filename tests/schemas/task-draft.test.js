import { expect, test } from '@jest/globals';
import { validateTaskDraft } from '../../schemas/task-draft.js';

test('accepts a title-only task and trims it', () => {
  const result = validateTaskDraft({ title: '  買牛奶  ' });
  expect(result.valid).toBe(true);
  expect(result.value).toEqual({ title: '買牛奶' });
});

test('normalizes an optional dueAt to ISO and keeps notes', () => {
  const result = validateTaskDraft({
    title: '交報告', notes: '第三版', dueAt: '2026-07-20T15:00:00+08:00',
  });
  expect(result.valid).toBe(true);
  expect(result.value.notes).toBe('第三版');
  expect(result.value.dueAt).toBe('2026-07-20T07:00:00.000Z');
});

test('rejects a missing or blank title', () => {
  expect(validateTaskDraft({ title: '   ' }).valid).toBe(false);
  expect(validateTaskDraft({}).valid).toBe(false);
});

test('rejects fields the schema does not allow', () => {
  const result = validateTaskDraft({ title: 'x', ownerId: 'attacker' });
  expect(result.valid).toBe(false);
  expect(result.errors).toContain('unknown field: ownerId');
});

test('rejects an invalid dueAt and timezone', () => {
  expect(validateTaskDraft({ title: 'x', dueAt: 'not-a-date' }).valid).toBe(false);
  expect(validateTaskDraft({ title: 'x', timezone: 'Mars/Olympus' }).valid).toBe(false);
});

test('keeps a non-normal priority and normalizes tags', () => {
  const result = validateTaskDraft({
    title: 'x', priority: 'high', tags: ['#工作', '工作。', ' 家庭 '],
  });
  expect(result.valid).toBe(true);
  expect(result.value.priority).toBe('high');
  // # 去除、去重、trim。
  expect(result.value.tags).toEqual(['工作', '家庭']);
});

test('drops a normal priority (default) from the value', () => {
  const result = validateTaskDraft({ title: 'x', priority: 'normal' });
  expect(result.valid).toBe(true);
  expect(result.value.priority).toBeUndefined();
});

test('rejects an invalid priority and non-array tags', () => {
  expect(validateTaskDraft({ title: 'x', priority: 'urgent' }).valid).toBe(false);
  expect(validateTaskDraft({ title: 'x', tags: 'nope' }).valid).toBe(false);
});

test('caps tags at five', () => {
  const result = validateTaskDraft({ title: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  expect(result.value.tags).toHaveLength(5);
});
