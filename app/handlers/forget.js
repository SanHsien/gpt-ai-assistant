import { COMMAND_BOT_FORGET } from '../commands/index.js';
import { removeHistory } from '../history/index.js';
import { removePrompt } from '../prompt/index.js';

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_FORGET);

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    removePrompt(context.userId);
    removeHistory(context.id);
    context.pushText(COMMAND_BOT_FORGET.reply);
    return context;
  }
)();

export default exec;
