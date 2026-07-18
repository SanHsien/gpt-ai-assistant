import { expect, test } from '@jest/globals';
import en from '../locales/en.js';
import ja from '../locales/ja.js';
import zh from '../locales/zh.js';
import { resolveLocale, SUPPORTED_APP_LANGS } from '../locales/index.js';

test('declares the accepted APP_LANG values', () => {
  expect(SUPPORTED_APP_LANGS).toEqual(['en', 'ja', 'zh', 'zh_TW', 'zh_CN']);
  expect(resolveLocale('zh_TW')).toBe(zh);
  expect(resolveLocale('zh_CN')).toBe(zh);
  expect(resolveLocale('en')).toBe(en);
  expect(resolveLocale('ja')).toBe(ja);
});

test('keeps locale key sets aligned', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  expect(Object.keys(ja).sort()).toEqual(Object.keys(zh).sort());
});

test('rejects an unknown APP_LANG with an actionable error', () => {
  expect(() => resolveLocale('fr')).toThrow('Unsupported APP_LANG "fr"');
});

test('English and Japanese locale entries do not retain untranslated TODO markers', () => {
  const {
    __COMMAND_TRANSLATE_TO_EN_TEXT: translateToEnglish,
  } = en;
  const {
    __COMMAND_BOT_SEARCH_TEXT: searchText,
    __ERROR_MAX_GROUPS_REACHED: maxGroupsError,
    __ERROR_MAX_USERS_REACHED: maxUsersError,
  } = ja;
  expect(JSON.stringify(en)).not.toContain('TODO');
  expect(translateToEnglish).toBe('Translate last message to English');
  expect(searchText).toBe('検索');
  expect(maxGroupsError).toContain('グループ');
  expect(maxUsersError).toContain('ユーザー');
});
