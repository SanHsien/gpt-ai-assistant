import { createHmac } from 'crypto';
import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const ORIGINAL_LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const sign = (body, secret) => createHmac('SHA256', secret).update(body).digest('base64');

const createRequest = (body, signature) => ({
  rawBody: body,
  header: jest.fn((name) => (name === 'x-line-signature' ? signature : undefined)),
});

const createResponse = () => ({
  sendStatus: jest.fn(),
});

const loadMiddleware = async (secret) => {
  jest.resetModules();
  if (secret === undefined) {
    delete process.env.LINE_CHANNEL_SECRET;
  } else {
    process.env.LINE_CHANNEL_SECRET = secret;
  }
  const { default: validateLineSignature } = await import('../middleware/validate-line-signature.js');
  return validateLineSignature;
};

afterEach(() => {
  if (ORIGINAL_LINE_CHANNEL_SECRET === undefined) {
    delete process.env.LINE_CHANNEL_SECRET;
  } else {
    process.env.LINE_CHANNEL_SECRET = ORIGINAL_LINE_CHANNEL_SECRET;
  }
  jest.restoreAllMocks();
});

test('validateLineSignature fails closed when LINE_CHANNEL_SECRET is missing', async () => {
  const body = '{"events":[]}';
  const signature = sign(body, '');
  const validateLineSignature = await loadMiddleware(undefined);
  const req = createRequest(body, signature);
  const res = createResponse();
  const next = jest.fn();
  jest.spyOn(console, 'error').mockImplementation(() => {});

  validateLineSignature(req, res, next);

  expect(res.sendStatus).toHaveBeenCalledWith(500);
  expect(next).not.toHaveBeenCalled();
});

test('validateLineSignature rejects invalid signatures', async () => {
  const body = '{"events":[]}';
  const validateLineSignature = await loadMiddleware('secret');
  const req = createRequest(body, sign(body, 'wrong-secret'));
  const res = createResponse();
  const next = jest.fn();

  validateLineSignature(req, res, next);

  expect(res.sendStatus).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

test('validateLineSignature accepts valid signatures', async () => {
  const body = '{"events":[]}';
  const secret = 'secret';
  const validateLineSignature = await loadMiddleware(secret);
  const req = createRequest(body, sign(body, secret));
  const res = createResponse();
  const next = jest.fn();

  validateLineSignature(req, res, next);

  expect(res.sendStatus).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
});
