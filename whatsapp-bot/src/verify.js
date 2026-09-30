// Confirmar o número pelo WhatsApp (Trello #537).
//
// Na app, quem se registou pede um código de 6 números (Perfil → Informação
// pessoal → «Confirma o teu número») e manda-o a este bot numa mensagem
// PRIVADA, a partir do próprio telemóvel. O bot vê de que número veio a
// mensagem, e a base de dados (confirm_phone_from_whatsapp) só confirma se
// esse número for o que a pessoa tem no perfil e o código bater. Com o
// número confirmado, o match do «In» passa a apontar para esta conta e as
// inscrições-convidado dela em mixes ainda abertos são adotadas
// (migration_mix_guest_sem_conta.sql — o antigo merge de contas acabou).
//
// O bot NÃO responde em privado — só escreve nos grupos (Renato, 28 set). O
// resultado vê-se na app («Já enviei»). Mensagens privadas que não são um
// código são ignoradas.
import { supabase } from './supabase.js'
import { hashPhone } from './phone.js'

const CODE = /(?:^|\D)(\d{6})(?:\D|$)/

export async function handleDirectMessage({ senderPn, text }) {
  const match = (text || '').trim().match(CODE)
  if (!match) return

  // Sem o número verdadeiro (o WhatsApp às vezes só mostra um @lid), não há
  // como confirmar — e nunca se confirma às cegas.
  if (!senderPn) return

  const hash = hashPhone(senderPn.split('@')[0])
  const { data, error } = await supabase.rpc('confirm_phone_from_whatsapp', { p_phone_hash: hash, p_code: match[1] })
  if (error) {
    console.error('Failed to confirm phone:', error)
    return
  }
  if (data?.ok && data.failed?.length) {
    console.error('Phone confirmed but merging a guest failed (ver à mão):', JSON.stringify(data.failed))
  }
}
