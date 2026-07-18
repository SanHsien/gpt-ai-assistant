import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'coverage/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.node,
      },
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'array-bracket-spacing': ['error', 'never'],
      'comma-dangle': ['error', 'always-multiline'],
      'comma-spacing': ['error', { before: false, after: true }],
      'comma-style': ['error', 'last'],
      'dot-notation': 'error',
      'eol-last': ['error', 'always'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'class-methods-use-this': 'error',
      'keyword-spacing': ['error', { before: true, after: true }],
      'no-await-in-loop': 'error',
      'no-bitwise': 'error',
      'no-console': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-multi-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 0 }],
      'no-new': 'error',
      'no-new-func': 'error',
      'no-param-reassign': 'off',
      'no-proto': 'error',
      'no-return-assign': ['error', 'always'],
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-vars': 'off',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-with': 'error',
      'object-curly-spacing': ['error', 'always'],
      'prefer-promise-reject-errors': 'error',
      quotes: ['error', 'single', { avoidEscape: true }],
      radix: 'error',
      semi: ['error', 'always'],
      'space-before-blocks': 'error',
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',
      yoda: 'error',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.commonjs,
        ...globals.node,
      },
      sourceType: 'commonjs',
    },
  },
];
