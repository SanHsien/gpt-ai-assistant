import { replyMessage } from '../utils/index.js';
import {
  activateHandler,
  commandHandler,
  continueHandler,
  deactivateHandler,
  deployHandler,
  docHandler,
  drawHandler,
  forgetHandler,
  enquireHandler,
  reportHandler,
  retryHandler,
  remindersHandler,
  scheduleHandler,
  taskHandler,
  searchHandler,
  talkHandler,
  versionHandler,
  weatherHandler,
} from './handlers/index.js';
import Context from './context.js';
import Event from './models/event.js';

/**
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const handleContext = async (context) => (
  activateHandler(context)
  || commandHandler(context)
  || continueHandler(context)
  || deactivateHandler(context)
  || deployHandler(context)
  || docHandler(context)
  || drawHandler(context)
  || forgetHandler(context)
  || enquireHandler(context)
  || reportHandler(context)
  || retryHandler(context)
  || searchHandler(context)
  || versionHandler(context)
  || weatherHandler(context)
  || await remindersHandler(context)
  || await taskHandler(context)
  || await scheduleHandler(context)
  || talkHandler(context)
  || context
);

const handleContextsInUserOrder = (contexts) => {
  const userChains = new Map();
  return contexts.map((context) => {
    const previous = userChains.get(context.userId) || Promise.resolve();
    const current = previous.then(async () => {
      await context.initialize();
      return context.error ? context : handleContext(context);
    });
    userChains.set(context.userId, current.catch(() => undefined));
    return current;
  });
};

/**
 * 只跑處理流程（含付費的 AI／生圖），**不送出任何訊息**。
 * 佇列 worker 用它把「AI 已完成」checkpoint 起來，之後的重試就只需要重送、不再花錢。
 * @param {Array<Object>} events
 * @returns {Promise<Array<Context>>} 有話要回的 context
 */
export const prepareEvents = async (events = [], dependencies = {}) => (
  (await Promise.all(
    handleContextsInUserOrder(
      events
        .map((event) => new Event(event))
        .filter((event) => event.isMessage || event.isPostback)
        .filter((event) => event.isText || event.isAudio || event.isImage)
        .map((event) => new Context(event, dependencies)),
    ),
  ))
    .filter((context) => context.messages.length > 0)
);

const handleEvents = async (
  events = [],
  { allowPushFallback = true, botSourceRepository } = {},
) => {
  const contexts = await prepareEvents(events, { botSourceRepository });
  return Promise.all(contexts.map((context) => replyMessage(context, { allowPushFallback })));
};

export default handleEvents;
