import {
  afterEach, beforeEach, expect, jest, test,
} from '@jest/globals';

let enqueueWebhookEventOnce;

const load = async () => {
  jest.resetModules();
  enqueueWebhookEventOnce = jest.fn().mockResolvedValue({ id: 'j1' });
  jest.doMock('../../repositories/webhook-events.js', () => ({ enqueueWebhookEventOnce }));
  return import('../../app/webhook.js');
};

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.dontMock('../../repositories/webhook-events.js');
  jest.resetModules();
});

test('enqueueEvents queues each event and leaves nothing to handle inline', async () => {
  const { enqueueEvents } = await load();
  const event = { webhookEventId: 'w1', type: 'message' };
  expect(await enqueueEvents([event])).toEqual([]);
  expect(enqueueWebhookEventOnce).toHaveBeenCalledWith(expect.objectContaining({
    webhookEventId: 'w1',
    kind: 'line-event',
    payload: { event },
    maxAttempts: 3,
  }));
});

test('enqueueEvents lets the database deduplicate redelivered events', async () => {
  const { enqueueEvents } = await load();
  const event = {
    webhookEventId: 'w-redelivery',
    deliveryContext: { isRedelivery: true },
  };
  expect(await enqueueEvents([event])).toEqual([]);
  expect(enqueueWebhookEventOnce).toHaveBeenCalledWith(expect.objectContaining({
    webhookEventId: 'w-redelivery',
  }));
});

test('enqueueEvents drops a duplicate event instead of handling it again', async () => {
  const { enqueueEvents } = await load();
  enqueueWebhookEventOnce.mockResolvedValue(null);
  expect(await enqueueEvents([{ webhookEventId: 'w1' }])).toEqual([]);
});

test('enqueueEvents fails closed when an event has no durable id', async () => {
  const { enqueueEvents } = await load();
  const event = { type: 'message' };
  await expect(enqueueEvents([event])).rejects.toThrow('webhookEventId');
  expect(enqueueWebhookEventOnce).not.toHaveBeenCalled();
});

test('enqueueEvents propagates database failure so LINE can redeliver', async () => {
  const { enqueueEvents } = await load();
  const event = { webhookEventId: 'w1' };
  enqueueWebhookEventOnce.mockRejectedValue(new Error('connection refused'));
  await expect(enqueueEvents([event])).rejects.toThrow('connection refused');
});
