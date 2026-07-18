import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { ROLE_AI, ROLE_HUMAN } from '../../services/openai.js';
import { fetchUrl, generateCompletion } from '../../utils/index.js';
import { COMMAND_BOT_CONTINUE, COMMAND_BOT_FORGET, COMMAND_BOT_TALK } from '../commands/index.js';
import { updateHistory } from '../history/index.js';
import { getPrompt, setPrompt } from '../prompt/index.js';

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => {
  if (context.hasCommand(COMMAND_BOT_TALK) || context.hasBotName) return true;
  // 群組可設定「需被點名（指令或 bot 名稱）才回」，即使已啟用自動回覆也不回一般訊息，減少群組噪音。
  if (context.event.isGroup && config.GROUP_REPLY_REQUIRES_MENTION) return false;
  return context.source.bot.isActivated;
};

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    const prompt = getPrompt(context.userId);
    try {
      if (context.event.isText) {
        let humanText = `${t('__COMPLETION_DEFAULT_AI_TONE')(config.BOT_TONE)}${context.trimmedText}`;
        if (config.ENABLE_URL_SUMMARY) {
          const match = context.event.text.match(/https?:\/\/[^\s]+/i);
          const url = match ? match[0].replace(/[).,!?，。！？」』]+$/, '') : null;
          if (url) {
            try {
              const pageText = await fetchUrl(url);
              if (pageText) humanText = t('__COMPLETION_URL')(pageText, context.trimmedText);
            } catch {
              // 抓取失敗（不安全 URL、逾時、非文字內容等）→ 退回一般對話。
            }
          }
        }
        prompt.write(ROLE_HUMAN, humanText).write(ROLE_AI);
      }
      if (context.event.isImage) {
        const { trimmedText } = context;
        prompt.writeImage(ROLE_HUMAN, trimmedText).write(ROLE_AI);
      }
      const { text, isFinishReasonStop } = await generateCompletion({ prompt });
      prompt.patch(text);
      setPrompt(context.userId, prompt);
      updateHistory(context.id, (history) => history.write(config.BOT_NAME, text));
      const actions = isFinishReasonStop ? [COMMAND_BOT_FORGET] : [COMMAND_BOT_CONTINUE];
      context.pushText(text, actions);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export default exec;
