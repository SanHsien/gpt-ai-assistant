import {
  COMMAND_SYS_COMMAND,
  GENERAL_COMMANDS,
} from '../commands/index.js';
import { buildCommandHelp } from '../commands/help.js';
import { updateHistory } from '../history/index.js';

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_SYS_COMMAND);

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    updateHistory(context.id, (history) => history.erase());
    try {
      context.pushText(buildCommandHelp(), GENERAL_COMMANDS);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export default exec;
