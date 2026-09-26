// Os contactos da Alinho, num sítio só (Trello #327 — «Falar connosco» da
// página Planos). Trocar aqui e só aqui.
//
// SUPPORT_EMAIL é PROVISÓRIO (Francisco, 25 set: «algo como
// support@alinho.pt», ainda não está fechado). O Ruben cria o endereço;
// quando existir, troca-se esta linha.
export const SUPPORT_EMAIL = 'support@alinho.pt'

// A caixa ainda não existe: um clube que escrevesse perdia a mensagem. O
// botão Email fica escondido e fica só o WhatsApp, que o Renato lê, até o PO
// dizer que a caixa existe (26 set). Nesse dia, passa a true.
export const SUPPORT_EMAIL_READY = false

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
