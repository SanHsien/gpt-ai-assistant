import { t } from '../../locales/index.js';
import { fetchVersion, getVersion } from '../../utils/index.js';
import { COMMAND_SYS_VERSION, GENERAL_COMMANDS } from '../commands/index.js';
import { updateHistory } from '../history/index.js';

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_SYS_VERSION);

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    updateHistory(context.id, (history) => history.erase());
    const current = getVersion();
    let latest = current;
    try {
      latest = await fetchVersion();
    } catch (err) {
      console.error(err.message);
    }
    const isLatest = current === latest;
    const text = t('__COMMAND_SYS_VERSION_REPLY')(current, isLatest);
    context.pushText(text, GENERAL_COMMANDS);
    if (!isLatest) context.pushText(t('__MESSAGE_NEW_VERSION_AVAILABLE')(latest));
    return context;
  }
)();

export default exec;
