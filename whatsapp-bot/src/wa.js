import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import { config } from './config.js'
import { createParticipatingGroups } from './participatingGroups.js'

const logger = pino({ level: 'info' })

/**
 * Starts (or resumes) the WhatsApp connection.
 *
 * onGroupMessage(payload) fires for every plain-text message sent inside
 * ANY group the bot is a participant of — filtering to the configured
 * target group happens in the caller, since that's a Supabase-backed
 * setting the caller already loads.
 *   payload: { groupJid, senderJid, senderPn, text, key, message, quotedStanzaId }
 * `message` is the raw WAMessage — pass it as `quoted` when replying so
 * the reply shows as an in-thread quote of the sender's own message,
 * unambiguous even if several people send "In" close together.
 * `quotedStanzaId` is the WhatsApp message id the sender replied TO (not
 * the sender's own message id), or null if this message isn't a reply —
 * this is how commands.js resolves "In"/"Out" sent as a native reply to
 * one specific mix's roster message (2026-09-14 disambiguation redesign).
 *
 * onDirectMessage(payload) (opcional) fires for plain-text PRIVATE messages
 * sent to the bot — só se usam para confirmar o número (verify.js, #537).
 *   payload: { chatJid, senderPn, text, message }
 */
export async function connectWhatsApp({ onGroupMessage, onDirectMessage }) {
  // `sock` is reassigned by `start()` on every (re)connect. `sendText`
  // below closes over this outer binding — not over a specific socket
  // instance — so it always talks to whichever connection is currently
  // live, even after WhatsApp cycles the connection (which happens
  // routinely, not just on real outages).
  let sock
  // Em que grupos esta conta está — um pedido de cada vez, só com a ligação
  // aberta (participatingGroups.js).
  const participating = createParticipatingGroups()
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
        participating.setOpen(true)
        try {
          // O mesmo pedido serve o log e a lista dos grupos servidos (antes
          // eram dois ao mesmo tempo → «rate-overlimit»).
          const groups = (await participating.refresh(() => sock.groupFetchAllParticipating())) || {}
          logger.info('Groups this account participates in (register each served group in the whatsapp_groups table — see supabase/migration_whatsapp_groups.sql):')
          for (const g of Object.values(groups)) {
            logger.info(`  ${g.subject}  ->  ${g.id}`)
          }
        } catch (err) {
          logger.warn({ err }, 'Could not list groups')
        }
      }

      if (connection === 'close') {
        participating.setOpen(false)
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
        if (!groupJid) continue

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          null
        if (!text) continue

        // Mensagem privada (não é grupo nem estado): só serve para confirmar
        // o número (#537). O número verdadeiro vem no próprio JID ou, quando
        // o WhatsApp mostra um @lid, no senderPn.
        if (!groupJid.endsWith('@g.us')) {
          if (groupJid === 'status@broadcast' || !onDirectMessage) continue
          const dmPn = msg.key.senderPn || (groupJid.endsWith('@s.whatsapp.net') ? groupJid : null)
          onDirectMessage({ chatJid: groupJid, senderPn: dmPn, text, message: msg })
          continue
        }

        // participantPn (if present) carries the real phone-number JID even
        // when the group presents senders via a privacy-preserving @lid.
        const senderJid = msg.key.participant || msg.key.remoteJid
        const senderPn = msg.key.participantPn || (senderJid?.endsWith('@s.whatsapp.net') ? senderJid : null)

        // contextInfo.stanzaId is WhatsApp's own "this message replies to
        // that one" pointer — core protocol metadata Baileys exposes even
        // though it isn't the official Business API.
        const quotedStanzaId = msg.message.extendedTextMessage?.contextInfo?.stanzaId ?? null

        // Quem foi mencionado (@) — é assim que se diz ao bot quem é o
        // parceiro («In @João»). Só se procura o número quando há menções,
        // para a conversa normal do grupo não custar nada.
        const mentionedJids = msg.message.extendedTextMessage?.contextInfo?.mentionedJid ?? []
        const deliver = (mentionedPns) =>
          onGroupMessage({ groupJid, senderJid, senderPn, text, key: msg.key, message: msg, quotedStanzaId, mentionedJids, mentionedPns })
        if (mentionedJids.length === 0) {
          deliver([])
        } else {
          Promise.all(mentionedJids.map((jid) => resolveMentionPn(groupJid, jid)))
            .then(deliver)
            .catch((err) => {
              logger.error({ err }, 'Failed to resolve mentions')
              deliver(mentionedJids.map(() => null))
            })
        }
      }
    })
  }

  /**
   * O número (JID @s.whatsapp.net) de quem foi mencionado, ou null se o
   * WhatsApp não o deixar saber. Num grupo com números escondidos a menção
   * chega como @lid: tenta-se o mapa LID→número do Baileys (versões novas) e
   * depois a lista de participantes do grupo. Sem número não há como
   * encontrar a pessoa (o perfil guarda o telemóvel, não o LID) — quem chama
   * pede então o nome.
   */
  async function resolveMentionPn(groupJid, jid) {
    if (!jid) return null
    if (jid.endsWith('@s.whatsapp.net')) return jid
    if (!jid.endsWith('@lid')) return null
    try {
      const mapped = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid)
      if (typeof mapped === 'string' && mapped.endsWith('@s.whatsapp.net')) return mapped
    } catch { /* versão do Baileys sem o mapa — segue para os participantes */ }
    try {
      const metadata = await sock.groupMetadata(groupJid)
      const p = metadata.participants.find((x) => x.id === jid || x.lid === jid)
      const pn = [p?.jid, p?.phoneNumber, p?.id].find((x) => typeof x === 'string' && x.endsWith('@s.whatsapp.net'))
      return pn ?? null
    } catch {
      return null
    }
  }

  await start()

  // Cache dos grupos em que ESTA conta está — define que subconjunto da
  // tabela whatsapp_groups este processo serve (groups.js): com vários
  // bots (números) a partilhar a mesma base de dados, cada processo só
  // posta/lembra/auto-arranca nos grupos da sua própria conta. TTL curto
  // para apanhar entradas/saídas de grupos sem reiniciar.
  return {
    // Returns the sent message's WhatsApp id (or null if unavailable) —
    // sync.js records it against the mix it just posted so a later reply
    // to that exact message can be resolved back to that mix.
    sendText: async (groupJid, text, options = {}) => {
      if (!sock) throw new Error('WhatsApp socket not connected yet')
      const content = { text, ...(options.mentions ? { mentions: options.mentions } : {}) }
      const sent = await sock.sendMessage(groupJid, content, options.quoted ? { quoted: options.quoted } : undefined)
      return sent?.key?.id ?? null
    },
    // Participant JIDs for the group, used to build a silent "@all" tag
    // (mentioning everyone pings them even though the visible text just
    // says "@all" rather than spelling out each name).
    getGroupMentions: async (groupJid) => {
      if (!sock) throw new Error('WhatsApp socket not connected yet')
      const metadata = await sock.groupMetadata(groupJid)
      return metadata.participants.map((p) => p.id)
    },
    // Set dos JIDs de grupo em que esta conta participa, ou null se ainda
    // não for possível saber (socket em reconexão) — null significa
    // "não filtrar", fail-open, para uma reconexão nunca silenciar o bot.
    getParticipatingGroupJids: async () =>
      participating.get(() => sock.groupFetchAllParticipating()),
  }
}
