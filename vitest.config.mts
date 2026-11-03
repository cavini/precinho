import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      // `next` publishes no exports map, so an ESM resolver cannot find
      // the extensionless `next/navigation` the way the bundler does.
      // Our own code never trips on this; next-intl's compiled navigation
      // imports it for real, and any test that renders a Link reaches it.
      'next/navigation': resolve(import.meta.dirname, 'node_modules/next/navigation.js'),
    },
  },
  test: {
    // Node by default, because almost everything here is logic. A component
    // test opts into a DOM with "// @vitest-environment happy-dom" at the top of
    // the file, so the fast majority is not slowed down for the few.
    environment: 'node',
    server: {
      deps: {
        // Processed by Vite rather than left to Node's resolver, so the
        // alias above reaches it. next-intl's navigation imports
        // `next/navigation`, which only resolves once Vite handles it.
        inline: ['next-intl'],
      },
    },
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    setupFiles: ['src/testing/componentSetup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/domain/**',
        'src/application/**',
        'src/infrastructure/**',
        // Reported but not yet gated: the screens are where every fault has
        // been found by a person rather than a test, so the number should be
        // visible while it is being raised.
        'src/presentation/**',
      ],
      // Ports are interfaces: no runtime to cover. Their implementations are
      // covered where they live, in infrastructure.
      exclude: ['src/application/ports/**', 'src/application/testing/**'],
      // The domain and application layers hold the rules, so they carry the
      // strictest bar. Adapters are covered by contract/integration tests.
      thresholds: {
        'src/domain/**': { lines: 100, functions: 100, branches: 95, statements: 100 },
        'src/application/**': { lines: 95, functions: 95, branches: 90, statements: 95 },
      },
    },
  },
})
