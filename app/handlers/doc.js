import { COMMAND_SYS_DOC, GENERAL_COMMANDS } from '../commands/index.js';
import { updateHistory } from '../history/index.js';

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_SYS_DOC);

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    updateHistory(context.id, (history) => history.erase());
    context.pushText('https://sanhsien.github.io/gpt-ai-assistant-docs/', GENERAL_COMMANDS);
    return context;
  }
)();

export default exec;
