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
  ignorePatterns: oxlintIgnorePatterns,
  rules: {},
});
