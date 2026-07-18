import { COMMAND_SYS_REPORT, GENERAL_COMMANDS } from '../commands/index.js';
import { updateHistory } from '../history/index.js';

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_SYS_REPORT);

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    updateHistory(context.id, (history) => history.erase());
    context.pushText('https://github.com/SanHsien/gpt-ai-assistant/issues', GENERAL_COMMANDS);
    return context;
  }
)();

export default exec;
