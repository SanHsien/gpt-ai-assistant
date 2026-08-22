/**
 * 把過長的 LINE 文字訊息切成符合平台上限的多則。
 *
 * LINE Messaging API 的文字訊息上限是 5000 字元，一次 reply/push 最多 5 則。
 * 超過上限時 LINE 回 400，整則訊息**送不出去**——使用者看到的是「機器人沒回應」，
 * 而不是「回覆被截斷」。上游 issue #375 就是這個症狀
 * （memochou1993/gpt-ai-assistant#375）。
 *
 * 切分規則按「盡量不切在句子中間」的順序退讓：先找段落界線，再找換行，
 * 最後才硬切。全部塞不下時，最後一則結尾補上截斷標記，讓使用者知道還有後續，
 * 而不是安靜地少一段。
 */

export const LINE_TEXT_LIMIT = 5000;
export const LINE_MESSAGES_PER_REQUEST = 5;
export const TRUNCATION_NOTICE = '\n\n（訊息過長，已截斷）';

const BREAKPOINTS = ['\n\n', '\n', '。', '！', '？', '. ', ' '];

/** 在 limit 內找一個盡量自然的切點；找不到就回 limit（硬切）。 */
const findBreakpoint = (text, limit) => {
  const window = text.slice(0, limit);
  for (const marker of BREAKPOINTS) {
    const index = window.lastIndexOf(marker);
    // 太靠前的切點會produce 一堆碎片，寧可硬切也不要把訊息切成豆腐塊。
    if (index > limit * 0.5) return index + marker.length;
  }
  return limit;
};

/**
 * @param {string} text 原始文字
 * @param {{limit?: number, maxMessages?: number}} options
 * @returns {string[]} 至少一則、至多 maxMessages 則的文字陣列
 */
export const splitLineText = (text, {
  limit = LINE_TEXT_LIMIT,
  maxMessages = LINE_MESSAGES_PER_REQUEST,
} = {}) => {
  const source = String(text ?? '');
  if (source.length <= limit) return [source];

  const chunks = [];
  let rest = source;
  while (rest.length > limit && chunks.length < maxMessages - 1) {
    const cut = findBreakpoint(rest, limit);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest.length <= limit) {
    chunks.push(rest);
    return chunks;
  }

  // 塞不下了：最後一則保留截斷標記的空間，並明說被截斷。
  const keep = limit - TRUNCATION_NOTICE.length;
  chunks.push(rest.slice(0, keep).trimEnd() + TRUNCATION_NOTICE);
  return chunks;
};

/**
 * 把 messages 陣列中的長文字訊息就地展開成多則，其他型別原樣保留。
 * 展開後仍受 LINE 每次最多 5 則的限制。
 */
export const expandTextMessages = (messages, options = {}) => {
  if (!Array.isArray(messages)) return messages;
  const expanded = [];
  for (const message of messages) {
    if (message?.type !== 'text' || typeof message.text !== 'string') {
      expanded.push(message);
      continue;
    }
    for (const text of splitLineText(message.text, options)) {
      expanded.push({ ...message, text });
    }
  }
  return expanded.slice(0, options.maxMessages ?? LINE_MESSAGES_PER_REQUEST);
};

export default splitLineText;
