import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import { config } from './config.js'

const logger = pino({ level: 'info' })

/**
 * Starts (or resumes) the WhatsApp connection.
 *
 * onGroupMessage(payload) fires for every plain-text message sent inside
 * ANY group the bot is a participant of — filtering to the configured
 * target group happens in the caller, since that's a Supabase-backed
 * setting the caller already loads.
 *   payload: { groupJid, senderJid, senderPn, text, key, message }
 * `message` is the raw WAMessage — pass it as `quoted` when replying so
 * the reply shows as an in-thread quote of the sender's own message,
 * unambiguous even if several people send "In" close together.
 */
export async function connectWhatsApp({ onGroupMessage }) {
  // `sock` is reassigned by `start()` on every (re)connect. `sendText`
  // below closes over this outer binding — not over a specific socket
  // instance — so it always talks to whichever connection is currently
  // live, even after WhatsApp cycles the connection (which happens
  // routinely, not just on real outages).
  let sock
  let connecting = false
  let reconnectAttempts = 0

  async function start() {
    if (connecting) {
      logger.warn('start() called while a connection attempt is already in progress, skipping.')
      return
    }
    connecting = true
    let state, saveCreds, version
    try {
      ;({ state, saveCreds } = await useMultiFileAuthState(config.authDir))
      ;({ version } = await fetchLatestBaileysVersion())
    } catch (err) {
      connecting = false
      throw err
    }

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update

      if (qr && !config.pairingPhone) {
        logger.info('Scan this QR code with the bot phone (WhatsApp > Linked devices):')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'open') {
        connecting = false
        reconnectAttempts = 0
        logger.info('WhatsApp connection established.')
        try {
          const groups = await sock.groupFetchAllParticipating()
          logger.info('Groups this account participates in (copy the target JID into settings.whatsapp_group_jid):')
          for (const g of Object.values(groups)) {
            logger.info(`  ${g.subject}  ->  ${g.id}`)
          }
        } catch (err) {
          logger.warn({ err }, 'Could not list groups')
        }
      }

      if (connection === 'close') {
        connecting = false
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const loggedOut = statusCode === DisconnectReason.loggedOut
        if (loggedOut) {
          logger.error(
            `WhatsApp session logged out (delete ${config.authDir} and re-pair with a QR/code to fix).`
          )
          return
        }
        // Back off instead of hammering an immediate retry: rapid repeated
        // connection attempts on the same account (e.g. during a flaky
        // network spell) look like abusive/bot-like linking behaviour to
        // WhatsApp and are a known trigger for temporary "can't link new
        // devices" blocks on the account.
        reconnectAttempts += 1
        const delayMs = Math.min(30_000, reconnectAttempts * 5_000)
        logger.warn({ statusCode, delayMs }, 'Connection closed, reconnecting…')
        setTimeout(() => {
          start().catch((err) => logger.error({ err }, 'Reconnect failed'))
        }, delayMs)
      }
    })

    // One-time pairing-code request (alternative to scanning a QR), only
    // relevant on a fresh (unregistered) session.
    if (config.pairingPhone && !sock.authState.creds.registered) {
      try {
        const code = await sock.requestPairingCode(config.pairingPhone)
        logger.info(`Pairing code for ${config.pairingPhone}: ${code}`)
      } catch (err) {
        logger.error({ err }, 'Failed to request pairing code')
      }
    }

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue
        const groupJid = msg.key.remoteJid
        if (!groupJid || !groupJid.endsWith('@g.us')) continue

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          null
        if (!text) continue

        // participantPn (if present) carries the real phone-number JID even
        // when the group presents senders via a privacy-preserving @lid.
        const senderJid = msg.key.participant || msg.key.remoteJid
        const senderPn = msg.key.participantPn || (senderJid?.endsWith('@s.whatsapp.net') ? senderJid : null)

        onGroupMessage({ groupJid, senderJid, senderPn, text, key: msg.key, message: msg })
      }
    })
  }

  await start()

  return {
    sendText: async (groupJid, text, options = {}) => {
      if (!sock) throw new Error('WhatsApp socket not connected yet')
      const content = { text, ...(options.mentions ? { mentions: options.mentions } : {}) }
      await sock.sendMessage(groupJid, content, options.quoted ? { quoted: options.quoted } : undefined)
    },
    // Participant JIDs for the group, used to build a silent "@all" tag
    // (mentioning everyone pings them even though the visible text just
    // says "@all" rather than spelling out each name).
    getGroupMentions: async (groupJid) => {
      if (!sock) throw new Error('WhatsApp socket not connected yet')
      const metadata = await sock.groupMetadata(groupJid)
      return metadata.participants.map((p) => p.id)
    },
  }
}
