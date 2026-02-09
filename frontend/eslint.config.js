import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', '.output'] },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      react.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'no-unused-vars': 'off', // turned off for ts
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
)
