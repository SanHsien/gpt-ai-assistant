import {
  afterEach, expect, jest, test,
} from '@jest/globals';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
let createImage;
let uploadImage;

const load = async () => {
  jest.resetModules();
  process.env.NODE_ENV = 'production';
  createImage = jest.fn();
  uploadImage = jest.fn();
  jest.doMock('../services/openai.js', () => ({ createImage }));
  jest.doMock('../utils/upload-image.js', () => ({ __esModule: true, default: uploadImage }));
  const { default: generateImage } = await import('../utils/generate-image.js');
  return generateImage;
};

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  jest.dontMock('../services/openai.js');
  jest.dontMock('../utils/upload-image.js');
  jest.resetModules();
});

test('uses the URL directly for DALL·E-style responses (no upload)', async () => {
  const generateImage = await load();
  createImage.mockResolvedValue({ data: { data: [{ url: 'https://img.example/x.png' }] } });
  const image = await generateImage({ prompt: 'cat' });
  expect(image.url).toBe('https://img.example/x.png');
  expect(uploadImage).not.toHaveBeenCalled();
});

test('uploads base64 (GPT Image) to blob and uses the returned URL', async () => {
  const generateImage = await load();
  createImage.mockResolvedValue({ data: { data: [{ b64_json: 'QUJD' }] } });
  uploadImage.mockResolvedValue('https://blob.example/y.png');
  const image = await generateImage({ prompt: 'cat' });
  expect(uploadImage).toHaveBeenCalledWith('QUJD');
  expect(image.url).toBe('https://blob.example/y.png');
});
