import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
let reply;
let push;

const load = async () => {
  jest.resetModules();
  process.env.NODE_ENV = 'production';
  reply = jest.fn();
  push = jest.fn().mockResolvedValue({ data: {} });
  jest.doMock('../services/line.js', () => ({ reply, push }));
  const { default: replyMessage } = await import('../utils/reply-message.js');
  return replyMessage;
};

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  jest.dontMock('../services/line.js');
  jest.resetModules();
});

test('uses reply and does not push when reply succeeds', async () => {
  const replyMessage = await load();
  reply.mockResolvedValue({ data: {} });
  const messages = [{ type: 'text', text: 'hi' }];
  await replyMessage({ id: 'U1', replyToken: 'tok', messages });
  expect(reply).toHaveBeenCalledWith({ replyToken: 'tok', messages });
  expect(push).not.toHaveBeenCalled();
});

test('falls back to push when reply fails', async () => {
  const replyMessage = await load();
  reply.mockRejectedValue(new Error('Invalid reply token'));
  const messages = [{ type: 'text', text: 'hi' }];
  await replyMessage({ id: 'U1', replyToken: 'tok', messages });
  expect(reply).toHaveBeenCalled();
  expect(push).toHaveBeenCalledWith({ to: 'U1', messages });
});

test('does not fall back to push when disabled for a queue job', async () => {
  const replyMessage = await load();
  reply.mockRejectedValue(new Error('Invalid reply token'));
  const messages = [{ type: 'text', text: 'hi' }];
  await expect(replyMessage(
    { id: 'U1', replyToken: 'tok', messages },
    { allowPushFallback: false },
  )).rejects.toThrow('Invalid reply token');
  expect(push).not.toHaveBeenCalled();
});

test('rethrows when reply fails and there is no push target', async () => {
  const replyMessage = await load();
  reply.mockRejectedValue(new Error('boom'));
  await expect(replyMessage({ replyToken: 'tok', messages: [] })).rejects.toThrow('boom');
  expect(push).not.toHaveBeenCalled();
});
