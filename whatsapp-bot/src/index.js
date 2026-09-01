import http from 'node:http'
import { config } from './config.js'
import { connectWhatsApp } from './wa.js'
import { handleGroupMessage } from './commands.js'
import { startSync } from './sync.js'
import { startReminders } from './reminders.js'
import { startAutoStart } from './autostart.js'

async function main() {
  // FIFO: as mensagens do grupo processam-se UMA de cada vez, pela ordem em
  // que o WhatsApp as entrega. Sem isto, dois "In" quase simultâneos corriam
  // os handlers em paralelo e quem definia a posição no roster era a corrida
  // das queries (o INSERT em participants carimba o created_at), não a ordem
  // das mensagens — o 2º podia ficar à frente do 1º, e na última vaga os
  // dois passavam a verificação de lotação e o mix enchia acima da
  // capacidade. O .catch dentro da cadeia mantém a fila viva após um erro.
  let messageQueue = Promise.resolve()

  const { sendText, getGroupMentions } = await connectWhatsApp({
    onGroupMessage: (payload) => {
      messageQueue = messageQueue.then(() =>
        handleGroupMessage(payload, { sendText }).catch((err) => {
          console.error('Failed to handle group message:', err)
        })
      )
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
