import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@binancebuddy/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@binancebuddy/blockchain': path.resolve(__dirname, 'packages/blockchain/src/index.ts'),
      '@binancebuddy/ai': path.resolve(__dirname, 'packages/ai/src/index.ts'),
      '@binancebuddy/buddy': path.resolve(__dirname, 'packages/buddy/src/index.ts'),
      '@binancebuddy/strategies': path.resolve(__dirname, 'packages/strategies/src/index.ts'),
      '@binancebuddy/extension': path.resolve(__dirname, 'packages/extension/src/index.ts'),
      '@binancebuddy/telegram': path.resolve(__dirname, 'packages/telegram/src/index.ts'),
      '@binancebuddy/server': path.resolve(__dirname, 'packages/server/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
  },
});
