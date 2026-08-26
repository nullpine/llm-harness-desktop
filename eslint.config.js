import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'out/**', 'dist/**', 'build/**', 'coverage/**', 'test-results/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // Main, preload and the tooling configs run in Node.
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.mjs', 'e2e/**/*.ts', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Renderer runs in the browser and is the only place JSX is allowed.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...react.configs.flat['jsx-runtime'],
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },

  // `_`-prefixed arguments are the escape hatch for unused parameters, which
  // `noUnusedParameters` otherwise makes impossible in interface implementations.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // CLAUDE.md rule 6: no `any`, no `@ts-ignore`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
    },
  },

  // Must stay last: turns off everything Prettier owns.
  prettier,
)
