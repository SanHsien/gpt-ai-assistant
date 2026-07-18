import config from '../config/index.js';
import en from './en.js';
import ja from './ja.js';
import zh from './zh.js';

const locales = {
  en,
  ja,
  zh,
  zh_TW: zh,
  zh_CN: zh,
};

export const SUPPORTED_APP_LANGS = Object.freeze(Object.keys(locales));

export const resolveLocale = (language) => {
  const locale = locales[language];
  if (!locale) {
    throw new Error(`Unsupported APP_LANG "${language}". Use one of: ${SUPPORTED_APP_LANGS.join(', ')}`);
  }
  return locale;
};

const locale = resolveLocale(config.APP_LANG);
const t = (key) => locale[key];

export {
  t,
};

export default null;
