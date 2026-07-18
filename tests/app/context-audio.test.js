import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let fetchAudio;
let generateTranscription;

const load = async ({
  maxBytes = 25 * 1024 * 1024,
  buffer = Buffer.from('audio'),
  extension = '.m4a',
} = {}) => {
  jest.resetModules();
  fetchAudio = jest.fn().mockResolvedValue({ buffer, extension });
  generateTranscription = jest.fn().mockResolvedValue({ text: '記行程 明天下午三點看診' });
  jest.doMock('../../config/index.js', () => ({
    __esModule: true,
    default: {
      APP_LANG: 'zh',
      BOT_NAME: '綠脈 AI 助理',
      ENABLE_TRANSCRIPTION: true,
      TRANSCRIPTION_MAX_BYTES: maxBytes,
    },
  }));
  jest.doMock('../../utils/index.js', () => ({
    addMark: (text) => text,
    convertText: (text) => text,
    fetchAudio,
    fetchImage: jest.fn(),
    fetchGroup: jest.fn(),
    fetchUser: jest.fn(),
    generateTranscription,
  }));
  const [{ default: Context }, { default: Event }] = await Promise.all([
    import('../../app/context.js'),
    import('../../app/models/event.js'),
  ]);
  return { Context, Event };
};

afterEach(() => {
  jest.dontMock('../../config/index.js');
  jest.dontMock('../../utils/index.js');
  jest.resetModules();
});

test('desktop audio file keeps its extension when sent to transcription', async () => {
  const { Context, Event } = await load();
  const event = new Event({
    type: 'message',
    source: { type: 'user', userId: 'U1' },
    message: { type: 'file', id: 'file-1', fileName: 'desktop-test.wav', fileSize: 5 },
  });
  const context = new Context(event);

  await context.transcribeAudio();

  expect(fetchAudio).toHaveBeenCalledWith('file-1');
  expect(generateTranscription).toHaveBeenCalledWith({
    file: 'desktop-test.wav',
    buffer: Buffer.from('audio'),
  });
  expect(context.transcription).toBe('記行程 明天下午三點看診');
});

test('LINE audio message uses the downloaded content type extension', async () => {
  const { Context, Event } = await load({ extension: '.mp3' });
  const event = new Event({
    type: 'message',
    source: { type: 'user', userId: 'U1' },
    message: { type: 'audio', id: 'audio-mp3' },
  });

  await new Context(event).transcribeAudio();

  expect(generateTranscription).toHaveBeenCalledWith({
    file: 'audio-mp3.mp3',
    buffer: Buffer.from('audio'),
  });
});

test('downloaded audio content is rejected when it exceeds the configured limit', async () => {
  const { Context, Event } = await load({ maxBytes: 4, buffer: Buffer.alloc(5) });
  const event = new Event({
    type: 'message',
    source: { type: 'user', userId: 'U1' },
    message: { type: 'audio', id: 'audio-1' },
  });

  await expect(new Context(event).transcribeAudio()).rejects.toThrow('音訊檔案過大');
  expect(generateTranscription).not.toHaveBeenCalled();
});
