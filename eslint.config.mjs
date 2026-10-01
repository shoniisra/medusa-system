import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint con tipos: además del estilo, atrapa los errores que el build no ve —
 * promesas sin await, handlers async donde se espera void, condiciones siempre
 * verdaderas y dependencias de hooks incompletas (la causa habitual de datos
 * viejos en pantalla).
 */
export default tseslint.config(
  // scripts/: utilidades de node sueltas, fuera de los tsconfig del proyecto.
  { ignores: ['dist', 'node_modules', '.claude', 'public', 'scripts'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.worker.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // El proyecto usa `catch (e)` con `e instanceof Error`; el unknown está manejado.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  // Los archivos de configuración de Tailwind/PostCSS son CommonJS y no forman
  // parte del proyecto TypeScript.
  {
    files: ['*.config.js', '*.config.mjs', '*.config.cjs'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
