import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const ORIGINAL_KEY = process.env.DATA_ENCRYPTION_KEY;
const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

const load = async (key = VALID_KEY) => {
  jest.resetModules();
  if (key === null) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = key;
  return import('../../services/data-protection.js');
};

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = ORIGINAL_KEY;
  jest.resetModules();
});

test('deriveChannelUserKey is stable, scoped, and does not expose the raw id', async () => {
  const { deriveChannelUserKey } = await load();
  const first = deriveChannelUserKey('U123456');
  expect(first).toBe(deriveChannelUserKey('U123456'));
  expect(first).not.toContain('U123456');
  expect(first).not.toBe(deriveChannelUserKey('U654321'));
});

test('encryptJson round-trips data with authenticated encryption', async () => {
  const { decryptJson, encryptJson } = await load();
  const value = { text: '私密訊息', userId: 'U123' };
  const envelope = encryptJson(value);
  expect(envelope.alg).toBe('A256GCM');
  expect(JSON.stringify(envelope)).not.toContain(value.text);
  expect(decryptJson(envelope)).toEqual(value);
  expect(() => decryptJson({ ...envelope, tag: Buffer.alloc(16).toString('base64') })).toThrow();
});

test('private-data operations fail closed without a valid key', async () => {
  const missing = await load(null);
  expect(() => missing.encryptJson({ a: 1 })).toThrow('DATA_ENCRYPTION_KEY');
  const invalid = await load(Buffer.alloc(16).toString('base64'));
  expect(() => invalid.encryptJson({ a: 1 })).toThrow('32-byte');
});
