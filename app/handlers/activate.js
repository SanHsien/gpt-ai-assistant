import { setBotSourceActivation } from '../../repositories/bot-sources.js';
import { COMMAND_BOT_ACTIVATE, GENERAL_COMMANDS } from '../commands/index.js';
import { updateHistory } from '../history/index.js';

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_BOT_ACTIVATE);

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    updateHistory(context.id, (history) => history.erase());
    try {
      await setBotSourceActivation(context.id, true);
      context.source.bot.isActivated = true;
      context.pushText(COMMAND_BOT_ACTIVATE.reply, GENERAL_COMMANDS);
    } catch (err) {
      context.pushError(err);
    }
    return context;
  }
)();

export default exec;
