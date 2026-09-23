/* Levar alguém sem conta ao /login e trazê-la de volta ao sítio certo.

   Duas peças pequenas que andavam espalhadas: construir o endereço de ida
   (Trello #454) e limpar o endereço de volta (Trello #378). Vivem juntas
   porque são os dois lados da mesma viagem, e aqui testam-se sem browser. */

/* O endereço de volta, saído do ?redirect= — que vem do URL e pode ter sido
   escrito por qualquer pessoa. Só se aceita um caminho DENTRO da app: sem
   isto bastava um link para levar alguém da página de entrada para fora,
   já com sessão iniciada. `//` e `/\` são endereços de outro site escritos
   como caminho; o navegador segue-os. */
export function safeInternalPath(pedido, fallback = '/') {
  if (typeof pedido !== 'string' || pedido === '') return fallback
  if (!pedido.startsWith('/')) return fallback
  if (pedido.startsWith('//')) return fallback
  if (pedido.startsWith('/' + String.fromCharCode(92))) return fallback
  return pedido
}

/* «Criar conta para me inscrever» e afins (Trello #454).

   Quem chega do WhatsApp a uma página aberta — o torneio, um convite de
   parceiro — e não tem conta tem de aterrar no separador de CRIAR CONTA
   (?mode=signup) e voltar ao sítio de onde veio (?redirect=). Sem os dois,
   via o formulário de quem já tem conta e, feita a conta, aterrava na Home,
   com aquilo que ia fazer desaparecido. */
export function signUpBackLink({ pathname, search = '', categoryCode = null } = {}) {
  const qs = new URLSearchParams(search)
  // A categoria que se está a ver pode não estar no endereço (é a primeira
  // por omissão); fixa-se aqui para o regresso cair na mesma.
  if (categoryCode) qs.set('cat', categoryCode)
  const back = `${pathname}${qs.toString() ? `?${qs}` : ''}`
  return `/login?mode=signup&redirect=${encodeURIComponent(back)}`
}
