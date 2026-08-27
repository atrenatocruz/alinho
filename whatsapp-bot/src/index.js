import http from 'node:http'
import { config } from './config.js'
import { connectWhatsApp } from './wa.js'
import { handleGroupMessage } from './commands.js'
import { startSync } from './sync.js'
import { startReminders } from './reminders.js'
import { startAutoStart } from './autostart.js'

async function main() {
  const { sendText, getGroupMentions } = await connectWhatsApp({
    onGroupMessage: (payload) => {
      handleGroupMessage(payload, { sendText }).catch((err) => {
        console.error('Failed to handle group message:', err)
      })
    },
  })

  startSync({ sendText, getGroupMentions })
  startReminders({ sendText, getGroupMentions })
  startAutoStart({ sendText })

  // Minimal health endpoint so Fly.io's http_service check keeps the
  // machine (and the WhatsApp socket it holds) running.
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    })
    .listen(config.port, () => {
      console.log(`Health server listening on :${config.port}`)
    })
}

main().catch((err) => {
  console.error('Fatal error starting WhatsApp bot:', err)
  process.exit(1)
})
