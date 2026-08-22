import { expect, test } from '@jest/globals';

import {
  LINE_TEXT_LIMIT,
  TRUNCATION_NOTICE,
  expandTextMessages,
  splitLineText,
} from '../utils/split-line-text.js';

test('short text is returned untouched', () => {
  expect(splitLineText('hello')).toEqual(['hello']);
});

test('a long answer is split instead of being rejected whole', () => {
  // LINE answers a >5000-character text message with 400, so the user sees
  // silence rather than a truncated reply. That is upstream issue #375.
  const text = 'a'.repeat(LINE_TEXT_LIMIT + 500);

  const parts = splitLineText(text);

  expect(parts.length).toBe(2);
  expect(parts.every((part) => part.length <= LINE_TEXT_LIMIT)).toBe(true);
  expect(parts.join('').length).toBe(text.length);
});

test('the split prefers a paragraph break over cutting mid-sentence', () => {
  const head = `${'a'.repeat(LINE_TEXT_LIMIT - 100)}\n\n`;
  const tail = 'b'.repeat(300);

  const [first, second] = splitLineText(head + tail);

  expect(first).toBe(head.trimEnd());
  expect(second).toBe(tail);
});

test('text beyond five messages ends with an explicit truncation notice', () => {
  const text = 'a'.repeat(LINE_TEXT_LIMIT * 6);

  const parts = splitLineText(text);

  expect(parts.length).toBe(5);
  expect(parts.at(-1).endsWith(TRUNCATION_NOTICE)).toBe(true);
  expect(parts.at(-1).length).toBeLessThanOrEqual(LINE_TEXT_LIMIT);
});

test('expandTextMessages leaves non-text messages alone', () => {
  const messages = [
    { type: 'sticker', packageId: '1', stickerId: '2' },
    { type: 'text', text: 'short' },
  ];

  expect(expandTextMessages(messages)).toEqual(messages);
});

test('expandTextMessages keeps the other message fields on every part', () => {
  const messages = [{
    type: 'text',
    text: 'a'.repeat(LINE_TEXT_LIMIT + 10),
    quickReply: { items: [] },
  }];

  const expanded = expandTextMessages(messages);

  expect(expanded.length).toBe(2);
  expect(expanded.every((message) => message.quickReply)).toBe(true);
});

test('expandTextMessages never exceeds the five-message request limit', () => {
  const messages = Array.from({ length: 4 }, () => ({
    type: 'text',
    text: 'a'.repeat(LINE_TEXT_LIMIT + 10),
  }));

  expect(expandTextMessages(messages).length).toBe(5);
});
