import {
  afterEach, expect, jest, test,
} from '@jest/globals';

let scheduleHandler;
let searchHandler;

const load = async () => {
  jest.resetModules();
  const ignore = jest.fn().mockReturnValue(false);
  scheduleHandler = jest.fn((context) => {
    context.messages.push({ type: 'text', text: 'done' });
    return context;
  });
  searchHandler = jest.fn((context) => {
    if (context.event.text !== '搜尋 天氣') return false;
    context.messages.push({ type: 'text', text: 'searched' });
    return context;
  });
  jest.doMock('../../app/handlers/index.js', () => ({
    activateHandler: ignore,
    commandHandler: ignore,
    continueHandler: ignore,
    deactivateHandler: ignore,
    deployHandler: ignore,
    docHandler: ignore,
    drawHandler: ignore,
    forgetHandler: ignore,
    enquireHandler: ignore,
    reportHandler: ignore,
    retryHandler: ignore,
    remindersHandler: ignore,
    scheduleHandler,
    taskHandler: ignore,
    searchHandler,
    talkHandler: ignore,
    versionHandler: ignore,
    weatherHandler: ignore,
  }));
  jest.doMock('../../app/context.js', () => ({
    __esModule: true,
    default: class MockContext {
      constructor(event) {
        this.event = event;
        this.messages = [];
      }

      async initialize() {
        return this;
      }
    },
  }));
  jest.doMock('../../utils/index.js', () => ({ replyMessage: jest.fn() }));
  return import('../../app/app.js');
};

afterEach(() => {
  jest.dontMock('../../app/handlers/index.js');
  jest.dontMock('../../app/context.js');
  jest.dontMock('../../utils/index.js');
  jest.resetModules();
});

test('prepareEvents routes LINE postbacks through command handlers', async () => {
  const { prepareEvents } = await load();
  const contexts = await prepareEvents([{
    type: 'postback',
    replyToken: 'reply-1',
    source: { type: 'user', userId: 'U1' },
    postback: { data: '完成行程 event-1' },
  }]);

  expect(scheduleHandler).toHaveBeenCalledTimes(1);
  expect(scheduleHandler.mock.calls[0][0].event.text).toBe('完成行程 event-1');
  expect(contexts).toHaveLength(1);
});

test('an explicit search command is not consumed by a pending schedule workflow', async () => {
  const { prepareEvents } = await load();
  const contexts = await prepareEvents([{
    type: 'message',
    replyToken: 'reply-2',
    source: { type: 'user', userId: 'U1' },
    message: { type: 'text', id: 'message-1', text: '搜尋 天氣' },
  }]);

  expect(searchHandler).toHaveBeenCalledTimes(1);
  expect(scheduleHandler).not.toHaveBeenCalled();
  expect(contexts[0].messages).toEqual([{ type: 'text', text: 'searched' }]);
});

test('supported LINE audio file attachments enter the same handler pipeline', async () => {
  const { prepareEvents } = await load();
  const contexts = await prepareEvents([{
    type: 'message',
    replyToken: 'reply-audio-file',
    source: { type: 'user', userId: 'U1' },
    message: {
      type: 'file', id: 'audio-file-1', fileName: 'schedule.m4a', fileSize: 1024,
    },
  }]);

  expect(scheduleHandler).toHaveBeenCalledTimes(1);
  expect(contexts).toHaveLength(1);
});
