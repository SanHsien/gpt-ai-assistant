import { expect, test } from '@jest/globals';
import Event from '../../../app/models/event.js';

test('postback data is treated as internal command text', () => {
  const event = new Event({
    type: 'postback',
    replyToken: 'reply-1',
    source: { type: 'user', userId: 'U1' },
    postback: { data: '完成行程 event-1' },
  });

  expect(event.isPostback).toBe(true);
  expect(event.isText).toBe(true);
  expect(event.text).toBe('完成行程 event-1');
});
