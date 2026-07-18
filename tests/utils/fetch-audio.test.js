import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let fetchContent;

const load = async ({ data, contentType }) => {
  jest.resetModules();
  fetchContent = jest.fn().mockResolvedValue({
    data,
    headers: contentType ? { 'content-type': contentType } : {},
  });
  jest.doMock('../../services/line.js', () => ({ fetchContent }));
  return import('../../utils/fetch-audio.js');
};

afterEach(() => {
  jest.dontMock('../../services/line.js');
  jest.resetModules();
});

test('uses the LINE content type for an MP3 uploaded as an audio message', async () => {
  const { default: fetchAudio } = await load({
    data: Buffer.from('ID3audio'),
    contentType: 'audio/mpeg; charset=binary',
  });

  await expect(fetchAudio('message-1')).resolves.toEqual({
    buffer: Buffer.from('ID3audio'),
    extension: '.mp3',
  });
  expect(fetchContent).toHaveBeenCalledWith({ messageId: 'message-1' });
});

test('detects WAV bytes when LINE returns a generic content type', async () => {
  const { default: fetchAudio } = await load({
    data: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEaudio')]),
    contentType: 'application/octet-stream',
  });

  await expect(fetchAudio('message-2')).resolves.toMatchObject({ extension: '.wav' });
});
