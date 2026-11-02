import config from '../../config/index.js';
import { t } from '../../locales/index.js';
import { COMMAND_SYS_DEPLOY } from '../commands/index.js';

/**
 * @param {import('../context.js').default} context
 * @returns {boolean}
 */
const check = (context) => context.hasCommand(COMMAND_SYS_DEPLOY);

/**
 * @param {import('../context.js').default} context
 * @returns {false|Promise<import('../context.js').default>}
 */
const exec = (context) => check(context) && (
  async () => {
    if (!config.VERCEL_DEPLOY_HOOK_URL) {
      context.pushText(t('__ERROR_MISSING_ENV')('VERCEL_DEPLOY_HOOK_URL'));
      return context;
    }
    // 尚無可信的部署維護者身分契約；設定 hook 不代表授權 LINE 使用者部署。
    context.pushText(t('__ERROR_FEATURE_DISABLED'));
    return context;
  }
)();

export default exec;
