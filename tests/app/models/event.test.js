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

test('supported LINE file attachments are treated as audio input', () => {
  const event = new Event({
    type: 'message',
    replyToken: 'reply-2',
    source: { type: 'user', userId: 'U1' },
    message: {
      type: 'file', id: 'audio-1', fileName: '桌面語音.WAV', fileSize: 1234,
    },
  });

  expect(event.isAudio).toBe(true);
  expect(event.isAudioFile).toBe(true);
  expect(event.audioFileName).toBe('桌面語音.WAV');
  expect(event.fileSize).toBe(1234);
});

test('non-audio LINE file attachments remain unsupported', () => {
  const event = new Event({
    type: 'message',
    source: { type: 'user', userId: 'U1' },
    message: { type: 'file', id: 'file-1', fileName: 'report.pdf', fileSize: 1234 },
  });
  expect(event.isAudio).toBe(false);
  expect(event.isAudioFile).toBe(false);
});
