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
export const WHATSAPP_NUMBER = '351931386496'

export const mailtoLink = (subject) =>
  `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`

// A mensagem já escrita: a pessoa só carrega em enviar, e quem lê percebe
// logo de onde veio.
export const whatsappContactLink = (text) =>
  `https://wa.me/${WHATSAPP_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ''}`
