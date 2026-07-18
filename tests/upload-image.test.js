import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
let put;
let issueSignedToken;
let presignUrl;

const load = async (token) => {
  jest.resetModules();
  if (token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = token;
  put = jest.fn().mockResolvedValue({
    pathname: 'generated/1000-random.png',
    url: 'https://store.private.blob.vercel-storage.com/generated/1000-random.png',
  });
  issueSignedToken = jest.fn().mockResolvedValue({
    delegationToken: 'delegation',
    clientSigningToken: 'signing',
    validUntil: 604501000,
  });
  presignUrl = jest.fn().mockResolvedValue({
    presignedUrl: 'https://store.private.blob.vercel-storage.com/generated/1000-random.png?signed=1',
  });
  jest.doMock('@vercel/blob', () => ({ issueSignedToken, presignUrl, put }));
  const { default: uploadImage } = await import('../utils/upload-image.js');
  return uploadImage;
};

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  jest.dontMock('@vercel/blob');
  jest.restoreAllMocks();
  jest.resetModules();
});

test('uploads to private Blob and returns a nearly seven-day signed GET URL', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  const uploadImage = await load('token');
  const url = await uploadImage('QUJD');
  expect(url).toContain('?signed=1');
  expect(put).toHaveBeenCalledTimes(1);
  const [pathname, body, options] = put.mock.calls[0];
  expect(pathname).toMatch(/^generated\/.*\.png$/);
  expect(Buffer.isBuffer(body)).toBe(true);
  expect(options).toMatchObject({ access: 'private', token: 'token' });
  expect(issueSignedToken).toHaveBeenCalledWith({
    pathname: 'generated/1000-random.png',
    operations: ['get'],
    validUntil: 604501000,
    token: 'token',
  });
  expect(presignUrl).toHaveBeenCalledWith(
    expect.objectContaining({ delegationToken: 'delegation' }),
    {
      access: 'private',
      operation: 'get',
      pathname: 'generated/1000-random.png',
      validUntil: 604501000,
    },
  );
});

test('omits the token so the SDK can use OIDC when BLOB_READ_WRITE_TOKEN is absent', async () => {
  const uploadImage = await load(undefined);
  const url = await uploadImage('QUJD');
  expect(url).toContain('?signed=1');
  expect(put).toHaveBeenCalledTimes(1);
  const [, , options] = put.mock.calls[0];
  expect(options.token).toBeUndefined();
  expect(options).toMatchObject({ access: 'private' });
  expect(issueSignedToken.mock.calls[0][0].token).toBeUndefined();
});
