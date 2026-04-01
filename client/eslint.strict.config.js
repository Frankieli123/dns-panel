import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import baseConfig from './eslint.base.config.js';

export default defineConfig([
  ...baseConfig,
  js.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ...reactRefresh.configs.vite,
  },
]);
