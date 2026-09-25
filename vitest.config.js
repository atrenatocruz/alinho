import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    // O bot tem os testes dele (node:test, `cd whatsapp-bot && npm test`) —
    // o Vitest da app não os corre.
    exclude: [...configDefaults.exclude, 'whatsapp-bot/**'],
    env: {
      TZ: 'Europe/Lisbon',
    },
  },
})
