import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import baseConfig from './eslint.base.config.js';

export default defineConfig([
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
]);
