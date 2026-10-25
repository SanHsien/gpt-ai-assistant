import config from '../config/index.js';
import { MOCK_TEXT_OK } from '../constants/mock.js';
import { createChatCompletion, FINISH_REASON_STOP } from '../services/openai.js';
import { recordCompletionRun } from '../services/run-trace.js';

class Completion {
  text;

  finishReason;

  constructor({
    text,
    finishReason,
  }) {
    this.text = text;
    this.finishReason = finishReason;
  }

  get isFinishReasonStop() {
    return this.finishReason === FINISH_REASON_STOP;
  }
}

/**
 * @param {Object} param
 * @param {Prompt} param.prompt
 * @param {string} [param.capability] run trace 用的能力標籤
 * @returns {Promise<Completion>}
 */
const generateCompletion = async ({
  prompt,
  capability = 'chat',
}) => {
  if (config.APP_ENV !== 'production') return new Completion({ text: MOCK_TEXT_OK });
  const startedAt = Date.now();
  try {
    const { data } = await createChatCompletion({ messages: prompt.messages });
    await recordCompletionRun({
      capability,
      model: data.model,
      usage: data.usage,
      durationMs: Date.now() - startedAt,
      status: 'done',
    });
    const [choice] = data.choices ?? [];
    if (!choice) throw new Error('OpenAI returned no choices');
    // 模型拒答時 content 是 null、拒答文字在 refusal；直接 trim() 會讓使用者看到 TypeError。
    return new Completion({
      text: String(choice.message?.content ?? choice.message?.refusal ?? '').trim(),
      finishReason: choice.finish_reason,
    });
  } catch (err) {
    await recordCompletionRun({
      capability,
      model: config.OPENAI_COMPLETION_MODEL,
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: err.message,
    });
    throw err;
  }
};

export default generateCompletion;
