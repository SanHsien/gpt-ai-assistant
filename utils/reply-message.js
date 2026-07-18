import config from '../config/index.js';
import { push, reply } from '../services/line.js';

/**
 * 先用 reply token 回覆；若 reply 失敗（reply token 失效/過期或 API 出錯）且有可推播目標
 * （`id` = user/group id），改用 Push API 送出，避免訊息靜默遺失。
 */
const replyMessage = async ({
  id,
  replyToken,
  messages,
}, { allowPushFallback = true } = {}) => {
  if (config.APP_ENV !== 'production') return { replyToken, messages };
  try {
    return await reply({ replyToken, messages });
  } catch (err) {
    if (!allowPushFallback || !id) throw err;
    return push({ to: id, messages });
  }
};

export default replyMessage;
