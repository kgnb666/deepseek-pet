import js from '@eslint/js';
import globals from 'globals';

const browserModule = {
  files: ['src/**/*.js', 'src/**/*.mjs', 'src/chat/**/*.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: { ...globals.browser },
  },
  rules: {
    'no-unused-vars': ['error', { args: 'none' }],
  },
};

const nodeCommonjs = {
  files: ['main.js', 'preload.js', 'electron/**/*.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
    globals: { ...globals.node, __dirname: 'readonly', require: 'readonly' },
  },
  rules: {
    'no-unused-vars': ['error', { args: 'none' }],
  },
};

const nodeModule = {
  files: ['tests/**/*.mjs', 'tools/**/*.mjs'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: { ...globals.node, process: 'readonly' },
  },
  rules: {
    'no-unused-vars': ['error', { args: 'none' }],
  },
};

export default [js.configs.recommended, browserModule, nodeCommonjs, nodeModule];
