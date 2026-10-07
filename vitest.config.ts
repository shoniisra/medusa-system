import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Config dedicada para los tests: sin los plugins de Vite (React, PWA, dev
// middlewares), que no aportan nada al unit-testing y encarecen el bootstrap.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'worker/**/*.test.ts'],
    environment: 'node',
  },
});
