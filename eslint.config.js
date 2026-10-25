import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out',
      'dist',
      'release',
      'coverage',
      'test-results',
      'playwright-report',
      'website/dist',
      'website/test-results',
      'website/playwright-report',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'tests/**/*.ts',
      'tests/**/*.mjs',
      'scripts/**/*.mjs',
      '*.ts',
      '*.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // The landing page (website/, P7-D): browser code, and node for its build/test tooling.
    files: ['website/src/**/*.ts', 'website/public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['website/scripts/**/*.mjs', 'website/tests/**/*.ts', 'website/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'child_process',
              importNames: ['exec', 'execSync'],
              message: 'Use execFile with argument arrays (SPEC §5).',
            },
          ],
        },
      ],
    },
  },
  prettier,
)
