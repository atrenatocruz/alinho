// Bot-specific locale dictionary. Deliberately separate from the web app's
// src/locales/*.json — the bot's Docker build context (whatsapp-bot/) can't
// reach the web app's src/ directory, and the message sets don't overlap
// 1:1 anyway (WhatsApp *bold* formatting vs JSX).
//
// Scope note: several bot flows broadcast ONE message to the whole WhatsApp
// group (the combined roster in roster.js, the cancelled-mix notice and
// game-day group reminder, the daily open-mixes digest, the auto-start
// pairings announcement) — there's no single "the player" whose
// profiles.language applies, since the group has many members who may each
// have a different language set. Those broadcasts stay in 'pt' (this app's
// default, per CLAUDE.md "Portuguese-first"). Messages addressed to ONE
// specific person — the in/out/waitlist confirmation replies in
// commands.js, the individual DM reminder in reminders.js, and the
// "you were promoted from the waitlist" callout line in roster.js/sync.js —
// use that person's own profiles.language.
const pt = {
  help_footer: '\n\n💬 Escreve */help* para ver todos os comandos.',
  help_text: `🤖 *Comandos do bot*

Para entrares num mix:
• *Alinho* / *In* / *Dentro* / *Estou dentro*

Para entrares já em dupla (nos mixes com «👥 Inscrição individual ou em dupla»):
• *In com João Silva* — o nome como está na app
• ou *In @João* — menciona o teu parceiro
Se ele ainda não estiver na app: com a menção @ o bot inscreve-o como convidado; pelo nome, o bot pergunta se queres inscrever a dupla na mesma e dá-te um link para lhe enviares. A dupla aparece na lista com o mesmo número à frente dos dois nomes, ex.: *(1)*.

Para saíres de um mix:
• *Out* / *Fora* / *Estou fora* / *Saio*
Em dupla:
• *Out dupla* — saem os dois
• *Out @parceiro* — sai só o parceiro, tu ficas
• *Out* — o bot pergunta: 1. Dupla · 2. Só tu · 3. Parceiro

Para veres os mixes abertos, com as vagas de cada um:
• */mix*

Se houver mais do que um mix aberto ao mesmo tempo, cada um tem a sua própria mensagem e um número (🔢 01, 02...). Para dizer a qual te referes:
• Responde à mensagem desse mix com *In* ou *Out*
• Ou escreve *In 01*, *In segunda*, *In m4* — dá para combinar, ex.: *In segunda m4* ou *In 01 com João*

Se o mix estiver cheio, o bot pergunta se queres entrar como suplente — responde *Sim* ou *Não*. Quando alguém sair, o primeiro suplente entra automaticamente. (Em dupla não há suplentes: a dupla precisa de duas vagas livres.)

Para veres esta lista:
• */help*`,

  // roster.js — promoted-from-waitlist callout (personalized per promoted player)
  promoted_to_confirmed: '🎉 {{name}} subiu da lista de suplentes!',

  // sync.js — cancelled-mix group broadcast
  mix_cancelled: '📢 @all\n\n🤖 O mix "{{title}}" foi cancelado ❌',

  // reminders.js
  reminder_roster_line: 'Inscritos: {{names}}\n\n',
  reminder_group: '🤖 ⏰ *Lembrete!* O mix *{{title}}* começa daqui a {{hours}}h.\n📅 {{when}}{{location}}\n\n{{roster}}Não faltes! 🎾',
  // mixNotices.js — o admin mexeu num mix já começado (Trello #292).
  mix_notice_joined: '🤖 🎾 *Entraste no {{title}}!*\n📅 {{when}}\n{{partner}}',
  mix_notice_removed: '🤖 Saíste do *{{title}}*.\n📅 {{when}}',
  mix_notice_partner_changed: '🤖 🔄 *A tua dupla mudou* no *{{title}}*.\n📅 {{when}}\n{{partner}}',
  mix_notice_partner: '🤝 Jogas com *{{name}}*.',
  mix_notice_no_partner: 'Ainda estás sem par — o admin vai completar a dupla.',
  duplas_updated: '🤖 🔄 *Duplas atualizadas — {{title}}*\n\n{{lines}}',
  reminder_dm: '🤖 ⏰ *Lembrete!* O teu mix *{{title}}* começa daqui a {{hours}}h.\n📅 {{when}}{{location}}\n\nNão faltes! 🎾',
  digest_mix_line: '🎾 *{{title}}* — {{when}}{{location}}\n👥 {{filled}}/{{capacity}} (faltam {{vagas}})',
  digest_text: '🤖 📢 @all *Mixes ainda em aberto!*\n\n{{lines}}\n\nAinda há vagas — inscrevam-se antes que feche! 🎾',

  // autostart.js
  duplas_formed: '🤖 🎾 *Duplas formadas para o mix {{title}}!*\n\n{{lines}}\n\nBoa sorte! 🏆',

  // commands.js
  not_found: '🤖 Não te encontrei na app 😅 Regista-te primeiro em {{appUrl}} e confirma o teu número de telemóvel no perfil.',
  mix_no_longer_available: '🤖 Este mix já não está disponível para inscrições.',
  already_waitlisted: '🤖 Já estás na lista de suplentes deste mix! 🎾',
  waitlisted: '🤖 Estás na lista de suplentes! Quando alguém sair, entras automaticamente. 🎾',
  guest_waitlisted: '🤖 Fixe, {{name}}! Ficas na lista de suplentes como convidado 🎾 Entras automaticamente quando alguém sair. Regista-te em {{appUrl}} e confirma o teu número no perfil: o que jogaste como convidado passa para a tua conta.',
  waitlist_declined: '🤖 Sem problema, não entraste na lista de suplentes. Inscreve-te para o próximo mix! 🎾',
  did_not_understand_yes_no: '🤖 Não percebi 🤔 Responde só com *Sim* ou *Não*.',
  no_open_mixes: '🤖 Não há nenhum mix com inscrições abertas neste momento.',
  mix_already_started_out: '🤖 Este mix já começou/terminou — já não é possível sair por aqui.',
  already_joined: '🤖 Já estás inscrito neste mix! 🎾',
  mix_full_offer_waitlist: '🤖 Mix cheio! Queres entrar como suplente? Responde com *Sim* ou *Não*.',
  guest_joined: '🤖 Fixe, {{name}}! Inscrevi-te como convidado 🎾 Regista-te em {{appUrl}} e confirma o teu número no perfil: o que jogaste como convidado passa para a tua conta.',
  // verify.js (#537) — resposta a uma mensagem PRIVADA com o código
  verify_ok: '🤖 Número confirmado, {{name}}! ✅ Já podes voltar à app.',
  verify_ok_merged: '🤖 Número confirmado, {{name}}! ✅ O que jogaste como convidado passou para a tua conta. Já podes voltar à app.',
  verify_bad_code: '🤖 Este código não é válido ou já passou o prazo 😕 Pede um novo na app (Perfil → Informação pessoal) e envia-o a partir do número que tens no perfil.',
  verify_phone_changed: '🤖 O número do teu perfil mudou depois de pedires o código. Pede um novo na app.',
  verify_no_number: '🤖 Não consegui ver o teu número 😕 Envia o código a partir do WhatsApp do número que tens no perfil.',
  verify_error: '🤖 Algo correu mal a confirmar o número. Tenta outra vez daqui a pouco.',
  partner_joined_use_app: '🤖 Estás inscrito em dupla por outra pessoa — quem inscreveu a dupla pode tirá-la com *Out*, ou sai tu pela app 📱',
  out_pair_menu: '🤖 Estás inscrito em dupla com *{{partner}}*. Queres sair como?\n\n1. Dupla (saem os dois)\n2. Só tu ({{partner}} fica)\n3. Parceiro (sai {{partner}}, tu ficas)\n\nEscreve *1*, *2* ou *3*.',
  out_pair_reprompt: '🤖 Não percebi 🤔 Responde com *1* (dupla), *2* (só tu) ou *3* (parceiro).',
  out_pair_done_me: '🤖 Saíste do *{{title}}*. *{{partner}}* continua inscrito, agora sozinho.',
  out_pair_done_partner: '🤖 *{{partner}}* saiu do *{{title}}*. Continuas inscrito, agora sozinho.',
  out_pair_whole_unclaimed: '🤖 O *{{partner}}* ainda não entrou na app, por isso saiu a dupla toda.',
  out_not_your_partner: '🤖 *{{name}}* não está na tua dupla neste mix. Para tirar o teu parceiro: *Out @parceiro*. Para saírem os dois: *Out dupla*.',
  out_not_in_pair: '🤖 Não estás inscrito em dupla neste mix — para saíres, escreve só *Out*.',
  out_mention_unreadable: '🤖 Não consegui saber quem mencionaste 😅 Escreve só *Out* e o bot pergunta como queres sair.',
  waitlisted_use_app: '🤖 Estás na lista de suplentes — para sair, usa a app 📱',
  not_joined: '🤖 Não estás inscrito neste mix.',
  mix_identifier_not_found: '🤖 Não encontrei nenhum mix aberto com isso. Escreve *mix* para veres a lista dos mixes abertos.',
  mix_list: '🤖 Mixes abertos ({{count}}):\n\n{{list}}\n\nEscreve *In* seguido do número, dia, hora ou nível para entrares (ex.: *In 01*, *In segunda*). Em dupla: *In 01 com* e o nome, ou *In 01 @parceiro*.',
  disambiguate_in: '🤖 Há vários mixes abertos! Qual deles?\n\n{{list}}\n\nResponde à mensagem do mix que queres com *In*, ou escreve *In* seguido do número, dia, hora ou nível (ex.: *In 01*, *In segunda m4*).',
  not_in_any_open_mix: '🤖 Não estás inscrito em nenhum mix aberto.',
  disambiguate_out: '🤖 Estás inscrito em vários mixes! De qual queres sair?\n\n{{list}}\n\nResponde à mensagem do mix que queres com *Out*, ou escreve *Out* seguido do número, dia, hora ou nível (ex.: *Out 01*).',
  // commands.js — «/mix» e entrar em dupla (A2N, 24 set)
  mix_list_spots: '👥 {{filled}}/{{capacity}}',
  mix_list_fixed_pairs: ' · aceita duplas 🤝',
  pair_signup_off: '🤖 Este mix é só de inscrição individual — entra sozinho com *In* 🎾 As duplas são formadas no início.',
  disambiguate_in_pair: '🤖 Há vários mixes abertos! Em qual querem entrar?\n\n{{list}}\n\nEscreve o número e o parceiro outra vez (ex.: *In 01 com João* ou *In 01 @João*).',
  partner_not_fixed_pairs: '🤖 Neste mix os parceiros trocam a cada ronda — não há duplas fixas. Entra sozinho com *In* 🎾',
  mix_full_pair: '🤖 O mix está cheio — não há vagas para uma dupla. Podes entrar sozinho como suplente com *In*.',
  mix_one_spot_pair: '🤖 Só há 1 vaga neste mix — não cabe uma dupla. Podes entrar sozinho com *In*.',
  partner_one_mention: '🤖 Menciona só uma pessoa — o teu parceiro 🤝',
  partner_mention_unreadable: '🤖 Não consegui saber quem mencionaste 😅 Escreve *In com* e o nome do teu parceiro como está na app (ex.: *In com João Silva*).',
  partner_not_found: '🤖 Não encontrei ninguém no clube com o nome «{{name}}». Escreve o nome como está na app, ou menciona a pessoa com @.',
  partner_not_found_app: '🤖 Não consegui inscrever o teu parceiro. Inscreve a dupla pela app: {{appUrl}}',
  partner_ambiguous: '🤖 Há mais do que uma pessoa com «{{name}}»:\n{{list}}\n\nEscreve o nome completo (ex.: *In com {{example}}*) ou menciona a pessoa com @.',
  partner_is_you: '🤖 Não podes ser o teu próprio parceiro 😄 Escolhe outra pessoa.',
  partner_already_in: '🤖 {{name}} já está inscrito neste mix.',
  partner_guest_default_name: 'Parceiro de {{name}}',
  partner_offer_unregistered: '🤖 Não encontrei o *{{name}}* no clube. Queres inscrever a dupla com ele na mesma? Responde *Sim* ou *Não*.\n\n(Se ele já está na app com outro nome, responde *Não* e escreve o nome como aparece lá.)',
  partner_offer_declined: '🤖 Ok, não inscrevi a dupla. Podes tentar *In com* e o nome como está na app, ou *In @parceiro* se ele estiver no grupo.',
  pair_partner_invite_created: '🤖 🤝 Dupla inscrita com *{{partner}}*! Envia-lhe este link para ele ficar com o lugar e ter o histórico e o ranking:\n{{link}}',
  pair_partner_guest_created: '🤖 🤝 Dupla inscrita! Criei um perfil de convidado para *{{partner}}* — para ter o histórico e o ranking, pode registar-se em {{appUrl}} com este número.',
}

const en = {
  help_footer: '\n\n💬 Type */help* to see every command.',
  help_text: `🤖 *Bot commands*

To join a mix:
• *Alinho* / *In* / *Dentro* / *Estou dentro*

To join straight away as a pair (mixes marked «👥 Inscrição individual ou em dupla»):
• *In com João Silva* — the name as it appears in the app
• or *In @João* — mention your partner
If they're not on the app yet: with the @ mention the bot signs them up as a guest; by name, the bot asks whether to sign up the pair anyway and gives you a link to send them. The pair shows up on the list with the same number next to both names, e.g. *(1)*.

To leave a mix:
• *Out* / *Fora* / *Estou fora* / *Saio*
As a pair:
• *Out dupla* — both leave
• *Out @partner* — only your partner leaves, you stay
• *Out* — the bot asks: 1. Pair · 2. Just you · 3. Partner

To see the open mixes and their free spots:
• */mix*

If more than one mix is open at the same time, each one gets its own message and a number (🔢 01, 02...). To say which one you mean:
• Reply to that mix's message with *In* or *Out*
• Or type *In 01*, *In segunda* (weekday), *In m4* (level) — you can combine them, e.g. *In segunda m4* or *In 01 com João*

If the mix is full, the bot asks if you want to join as a substitute — reply *Sim* or *Não*. When someone leaves, the first substitute joins automatically. (Pairs have no substitute list: a pair needs two free spots.)

To see this list:
• */help*`,

  // roster.js — promoted-from-waitlist callout (personalized per promoted player)
  promoted_to_confirmed: '🎉 {{name}} moved up from the waitlist!',

  // sync.js — cancelled-mix group broadcast
  mix_cancelled: '📢 @all\n\n🤖 The mix "{{title}}" was cancelled ❌',

  // reminders.js
  reminder_roster_line: 'Signed up: {{names}}\n\n',
  reminder_group: "🤖 ⏰ *Reminder!* *{{title}}* starts in {{hours}}h.\n📅 {{when}}{{location}}\n\n{{roster}}Don't miss it! 🎾",
  // mixNotices.js — the admin changed a mix that already started (Trello #292).
  mix_notice_joined: "🤖 🎾 *You're in {{title}}!*\n📅 {{when}}\n{{partner}}",
  mix_notice_removed: "🤖 You're out of *{{title}}*.\n📅 {{when}}",
  mix_notice_partner_changed: '🤖 🔄 *Your pair changed* in *{{title}}*.\n📅 {{when}}\n{{partner}}',
  mix_notice_partner: '🤝 You play with *{{name}}*.',
  mix_notice_no_partner: "You don't have a partner yet — the admin will complete the pair.",
  duplas_updated: '🤖 🔄 *Pairs updated — {{title}}*\n\n{{lines}}',
  reminder_dm: "🤖 ⏰ *Reminder!* Your mix *{{title}}* starts in {{hours}}h.\n📅 {{when}}{{location}}\n\nDon't miss it! 🎾",
  digest_mix_line: '🎾 *{{title}}* — {{when}}{{location}}\n👥 {{filled}}/{{capacity}} ({{vagas}} spot(s) left)',
  digest_text: '🤖 📢 @all *Mixes still open!*\n\n{{lines}}\n\nStill spots open — sign up before it closes! 🎾',

  // autostart.js
  duplas_formed: '🤖 🎾 *Pairs are set for the {{title}} mix!*\n\n{{lines}}\n\nGood luck! 🏆',

  // commands.js
  not_found: "🤖 I couldn't find you in the app 😅 Sign up first at {{appUrl}} and confirm your phone number in your profile.",
  mix_no_longer_available: '🤖 This mix is no longer open for sign-ups.',
  already_waitlisted: "🤖 You're already on the waitlist for this mix! 🎾",
  waitlisted: "🤖 You're on the waitlist! When a spot opens up, you'll join automatically. 🎾",
  guest_waitlisted: "🤖 Nice one, {{name}}! You're on the waitlist as a guest 🎾 You'll join automatically when a spot opens up. Sign up at {{appUrl}} and confirm your number in your profile: what you played as a guest moves to your account.",
  waitlist_declined: "🤖 No problem, you weren't added to the waitlist. Sign up for the next mix! 🎾",
  did_not_understand_yes_no: "🤖 Sorry, I didn't catch that 🤔 Reply with just *Sim* or *Não*.",
  no_open_mixes: "🤖 There's no mix open for sign-ups right now.",
  mix_already_started_out: "🤖 This mix has already started or finished — you can't leave here anymore.",
  already_joined: "🤖 You're already signed up for this mix! 🎾",
  mix_full_offer_waitlist: '🤖 Mix is full! Want to join the waitlist? Reply *Sim* or *Não*.',
  guest_joined: "🤖 Nice one, {{name}}! You're in as a guest 🎾 Sign up at {{appUrl}} and confirm your number in your profile: what you played as a guest moves to your account.",
  verify_ok: '🤖 Number confirmed, {{name}}! ✅ You can go back to the app.',
  verify_ok_merged: '🤖 Number confirmed, {{name}}! ✅ What you played as a guest moved to your account. You can go back to the app.',
  verify_bad_code: "🤖 This code isn't valid or has expired 😕 Ask for a new one in the app (Profile → Personal info) and send it from the number in your profile.",
  verify_phone_changed: '🤖 Your profile number changed after you asked for the code. Ask for a new one in the app.',
  verify_no_number: "🤖 I couldn't see your number 😕 Send the code from the WhatsApp of the number in your profile.",
  verify_error: '🤖 Something went wrong confirming your number. Try again in a bit.',
  partner_joined_use_app: '🤖 Someone else signed you up as a pair — whoever signed up the pair can take it off with *Out*, or leave through the app 📱',
  out_pair_menu: '🤖 You are signed up as a pair with *{{partner}}*. How do you want to leave?\n\n1. Pair (both leave)\n2. Just you ({{partner}} stays)\n3. Partner ({{partner}} leaves, you stay)\n\nType *1*, *2* or *3*.',
  out_pair_reprompt: "🤖 I didn't get that 🤔 Reply with *1* (pair), *2* (just you) or *3* (partner).",
  out_pair_done_me: '🤖 You left *{{title}}*. *{{partner}}* is still signed up, now on their own.',
  out_pair_done_partner: '🤖 *{{partner}}* left *{{title}}*. You are still signed up, now on your own.',
  out_pair_whole_unclaimed: "🤖 *{{partner}}* hasn't joined the app yet, so the whole pair left.",
  out_not_your_partner: "🤖 *{{name}}* isn't in your pair for this mix. To remove your partner: *Out @partner*. For both to leave: *Out dupla*.",
  out_not_in_pair: "🤖 You're not signed up as a pair in this mix — to leave, just type *Out*.",
  out_mention_unreadable: "🤖 I couldn't tell who you mentioned 😅 Just type *Out* and the bot will ask how you want to leave.",
  waitlisted_use_app: "🤖 You're on the waitlist — to leave, use the app 📱",
  not_joined: "🤖 You're not signed up for this mix.",
  mix_identifier_not_found: "🤖 I couldn't find any open mix matching that. Type *mix* to see the list of open mixes.",
  mix_list: '🤖 Open mixes ({{count}}):\n\n{{list}}\n\nType *In* followed by the number, weekday, time or level to join (e.g. *In 01*, *In segunda*). As a pair: *In 01 com* and the name, or *In 01 @partner*.',
  disambiguate_in: '🤖 There are several mixes open! Which one?\n\n{{list}}\n\nReply to the mix you want with *In*, or type *In* followed by the number, weekday, time or level (e.g. *In 01*, *In segunda m4*).',
  not_in_any_open_mix: "🤖 You're not signed up for any open mix.",
  disambiguate_out: "🤖 You're signed up for several mixes! Which one do you want to leave?\n\n{{list}}\n\nReply to the mix you want with *Out*, or type *Out* followed by the number, weekday, time or level (e.g. *Out 01*).",
  mix_list_spots: '👥 {{filled}}/{{capacity}}',
  mix_list_fixed_pairs: ' · pairs welcome 🤝',
  pair_signup_off: '🤖 This mix is individual sign-up only — join on your own with *In* 🎾 Pairs are formed when it starts.',
  disambiguate_in_pair: '🤖 There are several mixes open! Which one do you both want to join?\n\n{{list}}\n\nType the number and your partner again (e.g. *In 01 com João* or *In 01 @João*).',
  partner_not_fixed_pairs: '🤖 In this mix partners rotate every round — there are no fixed pairs. Join on your own with *In* 🎾',
  mix_full_pair: "🤖 The mix is full — there's no room for a pair. You can join on your own as a substitute with *In*.",
  mix_one_spot_pair: "🤖 There's only 1 spot left — not enough for a pair. You can join on your own with *In*.",
  partner_one_mention: '🤖 Mention just one person — your partner 🤝',
  partner_mention_unreadable: "🤖 I couldn't tell who you mentioned 😅 Type *In com* and your partner's name as it appears in the app (e.g. *In com João Silva*).",
  partner_not_found: "🤖 I couldn't find anyone in the club called «{{name}}». Type the name as it appears in the app, or mention them with @.",
  partner_not_found_app: "🤖 I couldn't sign up your partner. Sign up the pair through the app: {{appUrl}}",
  partner_ambiguous: '🤖 More than one person matches «{{name}}»:\n{{list}}\n\nType the full name (e.g. *In com {{example}}*) or mention them with @.',
  partner_is_you: "🤖 You can't be your own partner 😄 Pick someone else.",
  partner_already_in: '🤖 {{name}} is already signed up for this mix.',
  partner_guest_default_name: "{{name}}'s partner",
  partner_offer_unregistered: "🤖 I couldn't find *{{name}}* in the club. Do you want to sign up the pair anyway? Reply *Sim* or *Não*.\n\n(If they're already on the app under another name, reply *Não* and type the name as it appears there.)",
  partner_offer_declined: "🤖 Ok, I didn't sign up the pair. Try *In com* and the name as it appears in the app, or *In @partner* if they're in the group.",
  pair_partner_invite_created: '🤖 🤝 Pair signed up with *{{partner}}*! Send them this link so they claim the spot and keep their history and ranking:\n{{link}}',
  pair_partner_guest_created: '🤖 🤝 Pair signed up! I created a guest profile for *{{partner}}* — to keep their history and ranking, they can sign up at {{appUrl}} with this number.',
}

const DICTS = { pt, en }

// {{var}} interpolation, no library — this bot's message surface is small
// enough that hand-rolling matches the web app's i18next approach in spirit
// without a new dependency in a process that already has few of them.
export function t(key, lang, vars = {}) {
  const dict = DICTS[lang] || DICTS.pt
  let str = dict[key] ?? DICTS.pt[key] ?? key
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{{${k}}}`, v)
  }
  return str
}
