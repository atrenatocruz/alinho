# #537 — nota para o Ruben (rever e instalar o bot)

**Instalar antes de 4 out. Nunca entre 8 e 12 out (Smash Cup).**

## O que mudou no bot

1. **Mensagens privadas** (`wa.js`, `index.js`, `verify.js` novo): até hoje o bot só lia grupos.
   Agora lê também mensagens privadas, mas **só reage a um código de 6 números** — tudo o resto
   é ignorado, sem resposta. Com um código, chama `confirm_phone_from_whatsapp(hash do número
   de quem escreveu, código)` e responde se confirmou. Cada conversa privada tem a sua fila
   (`enqueue('dm:…')`, a fila por chave do Renato), por isso não atrasa os grupos.
2. **Preferir a conta registada** (`phone.js`): `resolveProfileByPhoneJid` deixa de usar
   `.maybeSingle()`. Com duas contas com o mesmo telemóvel no clube, escolhe a registada com
   número confirmado, depois qualquer registada, só no fim o convidado. Ignora contas
   `is_test` (os convidados já juntados ficam assim).
3. **Não criar convidado a quem já tem conta** (`phone.js` + `commands.js`): se ninguém do
   clube tem aquele número mas existe uma conta registada com o **número confirmado**, usa-se
   essa conta e, ao inscrever-se, passa a membro do clube (`ensureMembership`) — em vez de se
   criar um convidado.
4. **Boas-vindas** (`locales.js`): `guest_joined` e `guest_waitlisted` passam a dizer
   «Regista-te em … e confirma o teu número no perfil: o que jogaste como convidado passa para
   a tua conta.» — agora é verdade. Novas respostas `verify_*`.

## Antes de instalar

- A migração `supabase/migration_537_confirmar_numero.sql` tem de estar corrida em produção
  (Renato / System Integrator). Sem ela, o `confirm_phone_from_whatsapp` e a coluna
  `phone_verified_at` não existem e o bot responde «Algo correu mal» a um código.
- Sem variáveis novas no bot. A app precisa de saber o **número do bot** para o botão
  «Enviar pelo WhatsApp» (`VITE_WHATSAPP_BOT_NUMBER` na Vercel, só dígitos, ex.
  `351912345678`). Se houver vários números (um por clube), diz-nos: a app mostra o código e
  pede para o enviar «ao bot do teu clube» enquanto não houver número.

## Como instalar

Igual ao costume: `git pull` do ramo `bugs-537-bot`, `npm ci`, reiniciar o processo.

## Como testar num grupo de teste

1. Com um telemóvel **sem conta**: mandar «In» no grupo de teste → fica inscrito como
   convidado. A mensagem de boas-vindas já fala em confirmar o número.
2. Com esse mesmo telemóvel, registar uma conta na app (email ou Google) e pôr o mesmo número
   no perfil.
3. Na app: Perfil → Informação pessoal → «Confirmar pelo WhatsApp» → aparece um código.
4. Mandar esse código ao bot **numa mensagem privada**, do mesmo telemóvel → o bot responde
   «Número confirmado… O que jogaste como convidado passou para a tua conta.»
5. Na app, «Já enviei» → «Número confirmado». O jogo do passo 1 aparece na conta.
6. Mandar outro «In» no grupo → o bot usa a conta registada (não cria convidado novo).
7. Casos que têm de falhar: código de outro telemóvel → «Este código não é válido»; código
   com mais de 15 minutos → o mesmo; texto qualquer em privado → sem resposta.

Desfazer uma junção (se for preciso): `SELECT arquivo_537.desfazer('auto-<id do convidado>');`
