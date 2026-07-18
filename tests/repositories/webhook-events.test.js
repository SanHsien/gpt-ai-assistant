import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let client;
let withTransaction;
let decryptJson;
let encryptJson;

const load = async () => {
  jest.resetModules();
  client = { query: jest.fn() };
  withTransaction = jest.fn((fn) => fn(client));
  encryptJson = jest.fn((value) => ({ encrypted: value }));
  decryptJson = jest.fn((value) => value.encrypted);
  jest.doMock('../../services/database.js', () => ({ withTransaction }));
  jest.doMock('../../services/data-protection.js', () => ({ decryptJson, encryptJson }));
  return import('../../repositories/webhook-events.js');
};

afterEach(() => {
  jest.dontMock('../../services/database.js');
  jest.dontMock('../../services/data-protection.js');
  jest.resetModules();
});

test('event registration and enqueue share one transaction', async () => {
  const { enqueueWebhookEventOnce } = await load();
  client.query
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ webhook_event_id: 'evt1' }] })
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'job1', payload: { encrypted: { type: 'text' } } }],
    });
  await expect(enqueueWebhookEventOnce({
    webhookEventId: 'evt1', kind: 'line-event', payload: { type: 'text' },
  })).resolves.toEqual({ id: 'job1', payload: { type: 'text' } });
  expect(withTransaction).toHaveBeenCalledTimes(1);
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(client.query.mock.calls[1][1][1])
    .toBe(JSON.stringify({ encrypted: { type: 'text' } }));
  expect(client.query.mock.calls[1][1][2]).toBe('line-event:evt1');
});

test('duplicate event does not enqueue another job', async () => {
  const { enqueueWebhookEventOnce } = await load();
  client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
  await expect(enqueueWebhookEventOnce({ webhookEventId: 'evt1', kind: 'line-event' }))
    .resolves.toBeNull();
  expect(client.query).toHaveBeenCalledTimes(1);
});
