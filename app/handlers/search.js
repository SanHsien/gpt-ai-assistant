import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { ROLE_AI, ROLE_HUMAN } from '../../services/openai.js';
import { fetchAnswer, generateCompletion } from '../../utils/index.js';
import { COMMAND_BOT_CONTINUE, COMMAND_BOT_SCHEDULE, COMMAND_BOT_SEARCH } from '../commands/index.js';
import { updateHistory } from '../history/index.js';
import { getPrompt, setPrompt } from '../prompt/index.js';

// 來源清單：標題（來源站・時間）＋連結。
const formatSources = (sources) => {
  if (!sources || sources.length === 0) return '';
  const lines = sources.map((source, i) => {
    const meta = [source.source, source.date].filter(Boolean).join(' · ');
    return `${i + 1}. ${source.title}${meta ? `（${meta}）` : ''}\n${source.link}`;
  });
  return `${t('__TEXT_SEARCH_SOURCES')}\n${lines.join('\n')}`;
};

// 搜尋答案是否像「有日期／時間的節目或活動」，用來決定要不要提供「建立行程」捷徑。
const SCHEDULABLE = /(\d{1,2}\s*[/月]\s*\d{1,2})|(\d{4}\s*年)|(今天|明天|後天|下週|下星期|這週|本週|星期[一二三四五六日天]|週[一二三四五六日天])|(\d{1,2}\s*[:：]\s*\d{2})|(\d{1,2}\s*點)|([上下]午|晚上|中午|傍晚|凌晨)/;

/**
 * 從搜尋答案建行程的 quick-reply postback：把答案餵進 Phase 1 行程流程（`記行程 <答案>`），
 * 走確定性日期解析→草稿→**使用者確認才建立**，不自動寫入。答案截到 LINE postback 上限（300）。
 * 需開 ENABLE_SCHEDULE 且答案含日期／時間跡象才提供。
 * @param {string} answer
 * @returns {{ label: string, data: string, displayText: string }|null}
 */
const scheduleActionFor = (answer) => {
  if (!config.ENABLE_SCHEDULE || !answer || !SCHEDULABLE.test(answer)) return null;
  const data = `${COMMAND_BOT_SCHEDULE.text} ${answer}`.slice(0, 300);
  return {
    label: t('__TEXT_SEARCH_CREATE_EVENT'),
    data,
    displayText: t('__TEXT_SEARCH_CREATE_EVENT'),
  };
};

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_SEARCH);

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    if (!config.ENABLE_SEARCH) {
      context.pushText(t('__ERROR_FEATURE_DISABLED'));
      return context;
    }
    let trimmedText = context.trimmedText.replace(COMMAND_BOT_SEARCH.text, '');
    const prompt = getPrompt(context.userId);
    if (!config.SERPAPI_API_KEY) context.pushText(t('__ERROR_MISSING_ENV')('SERPAPI_API_KEY'));
    let sources;
    try {
      const result = await fetchAnswer(trimmedText);
      sources = result.sources || [];
      trimmedText = `${t('__COMPLETION_SEARCH')(result.answer || t('__COMPLETION_SEARCH_NOT_FOUND'), trimmedText)}`;
    } catch (err) {
      return context.pushError(err);
    }
    prompt.write(ROLE_HUMAN, `${trimmedText}`).write(ROLE_AI);
    try {
      const { text, isFinishReasonStop } = await generateCompletion({ prompt, capability: 'search' });
      prompt.patch(text);
      setPrompt(context.userId, prompt);
      updateHistory(context.id, (history) => history.write(config.BOT_NAME, text));
      const actions = [];
      const scheduleAction = scheduleActionFor(text);
      if (scheduleAction) actions.push(scheduleAction);
      if (!isFinishReasonStop) actions.push(COMMAND_BOT_CONTINUE);
      // 把 AI 整理與來源清楚分開：來源只顯示（標題／連結／時間），不進 prompt。
      const sourceText = formatSources(sources);
      context.pushText(sourceText ? `${text}\n\n${sourceText}` : text, actions);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export default exec;
