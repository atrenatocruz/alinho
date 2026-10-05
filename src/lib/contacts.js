// Os contactos da Alinho, num sítio só (Trello #327 — «Falar connosco» da
// página Planos). Trocar aqui e só aqui.
//
// Caixa criada pelo Ruben a 28 set: Cloudflare Email Routing reencaminha
// support@alinho.pt para a caixa Gmail da equipa. Só recebe — as respostas
// saem, por agora, do Gmail. O mesmo endereço está na política de
// privacidade e nos termos (privacy.*/terms.* em src/locales).
export const SUPPORT_EMAIL = 'support@alinho.pt'

// Enquanto a caixa não existia, o botão Email da página Planos ficava
// escondido para um clube não escrever para o vazio. Existe desde 28 set.
export const SUPPORT_EMAIL_READY = true

// O número do robô (decisão do Francisco, 25 set). O robô ignora as
// mensagens privadas que não são um código, por isso quem escreve espera por
// uma pessoa da equipa — a página diz isso por baixo dos botões.
// Configurável por ambiente (1 out): o dev tem BD e robô próprios — o
// «Enviar ao robô» da confirmação do número tem de apontar ao robô LIGADO
// À MESMA BD, senão o código morre em silêncio na BD errada. Em produção
// a variável não existe e fica o número de sempre.
// 351923538245 desde 3 out 2026 — o número anterior (351931386496) foi
// banido pelo WhatsApp; em dev o VITE_WHATSAPP_BOT_NUMBER aponta ao bot de QA.
export const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_BOT_NUMBER || '351923538245'

export const mailtoLink = (subject) =>
  `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`

// A mensagem já escrita: a pessoa só carrega em enviar, e quem lê percebe
// logo de onde veio.
export const whatsappContactLink = (text) =>
  `https://wa.me/${WHATSAPP_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ''}`
