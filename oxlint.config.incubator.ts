import {defineConfig} from 'oxlint';

import {oxlintIgnorePatterns} from './oxlint.config.ts';

export default defineConfig({
  options: {typeAware: false, reportUnusedDisableDirectives: 'off'},
  categories: {
    correctness: 'off',
    suspicious: 'off',
    pedantic: 'off',
    perf: 'off',
    style: 'off',
    restriction: 'off',
    nursery: 'off',
  },
  plugins: ['typescript', 'react', 'unicorn'],
  jsPlugins: [
    {name: '@sentry/scraps', specifier: './static/oxlint/eslintPluginScraps/index.ts'},
  ],
  ignorePatterns: oxlintIgnorePatterns,
  rules: {'@sentry/scraps/prefer-primitives': 'error'},
  overrides: [
    {
      files: ['static/app/components/core/**'],
      rules: {'@sentry/scraps/prefer-primitives': 'off'},
    },
  ],
});
