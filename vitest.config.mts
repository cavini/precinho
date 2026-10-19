import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/domain/**', 'src/application/**', 'src/infrastructure/**'],
      // The domain and application layers hold the rules, so they carry the
      // strictest bar. Adapters are covered by contract/integration tests.
      thresholds: {
        'src/domain/**': { lines: 100, functions: 100, branches: 95, statements: 100 },
        'src/application/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
      },
    },
  },
})
