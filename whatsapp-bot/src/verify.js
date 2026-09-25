// Confirmar o número pelo WhatsApp (Trello #537).
//
// Na app, quem se registou pede um código de 6 números (Perfil → Informação
// pessoal → «Confirma o teu número») e manda-o a este bot numa mensagem
// PRIVADA, a partir do próprio telemóvel. O bot vê de que número veio a
// mensagem, e a base de dados (confirm_phone_from_whatsapp) só confirma se
// esse número for o que a pessoa tem no perfil e o código bater. Com o
// número confirmado, o histórico do convidado do bot com esse número passa
// para a conta registada.
//
// Mensagens privadas que não são um código são ignoradas: o bot não
// conversa, e não responde a quem lhe escreve outra coisa.
import { supabase } from './supabase.js'
import { hashPhone } from './phone.js'
import { t } from './locales.js'

const CODE = /(?:^|\D)(\d{6})(?:\D|$)/

export async function handleDirectMessage({ chatJid, senderPn, text, message }, { sendText }) {
  const match = (text || '').trim().match(CODE)
  if (!match) return

  const reply = (key, vars) => sendText(chatJid, t(key, 'pt', vars), { quoted: message })

  // Sem o número verdadeiro (o WhatsApp às vezes só mostra um @lid), não há
  // como confirmar — e nunca se confirma às cegas.
  if (!senderPn) {
    await reply('verify_no_number')
    return
  }

  const hash = hashPhone(senderPn.split('@')[0])
  const { data, error } = await supabase.rpc('confirm_phone_from_whatsapp', { p_phone_hash: hash, p_code: match[1] })
  if (error) {
    console.error('Failed to confirm phone:', error)
    await reply('verify_error')
    return
  }
  if (!data?.ok) {
    await reply(data?.reason === 'phone_changed' ? 'verify_phone_changed' : 'verify_bad_code')
    return
  }
  if (data.failed?.length) {
    console.error('Phone confirmed but merging a guest failed (ver à mão):', JSON.stringify(data.failed))
  }
  await reply(data.merged > 0 ? 'verify_ok_merged' : 'verify_ok', { name: data.name || '' })
}
