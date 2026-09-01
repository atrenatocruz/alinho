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

Para saíres de um mix:
• *Out* / *Fora* / *Estou fora* / *Saio*

Se houver mais do que um mix aberto ao mesmo tempo, o bot diz-te o código (🆔) de cada um — escreve o comando seguido do código, por exemplo:
• *In 1234*
• *Out 1234*

Se o mix estiver cheio, o bot pergunta se queres entrar como suplente — responde *Sim* ou *Não*. Quando alguém sair, o primeiro suplente entra automaticamente.

Para veres esta lista:
• */help*`,

  // roster.js — promoted-from-waitlist callout (personalized per promoted player)
  promoted_to_confirmed: '🎉 {{name}} subiu da lista de suplentes!',

  // sync.js — cancelled-mix group broadcast
  mix_cancelled: '📢 @all\n\n🤖 O mix "{{title}}" foi cancelado ❌',

  // reminders.js
  reminder_roster_line: 'Inscritos: {{names}}\n\n',
  reminder_group: '🤖 ⏰ *Lembrete!* O mix *{{title}}* começa daqui a {{hours}}h.\n📅 {{when}}{{location}}\n\n{{roster}}Não faltes! 🎾',
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
  guest_waitlisted: '🤖 Fixe, {{name}}! Ficas na lista de suplentes como convidado 🎾 Entras automaticamente quando alguém sair. Regista-te em {{appUrl}} para veres o teu histórico e desbloquear recompensas.',
  waitlist_declined: '🤖 Sem problema, não entraste na lista de suplentes. Inscreve-te para o próximo mix! 🎾',
  did_not_understand_yes_no: '🤖 Não percebi 🤔 Responde só com *Sim* ou *Não*.',
  no_open_mixes: '🤖 Não há nenhum mix com inscrições abertas neste momento.',
  mix_already_started_out: '🤖 Este mix já começou/terminou — já não é possível sair por aqui.',
  already_joined: '🤖 Já estás inscrito neste mix! 🎾',
  mix_full_offer_waitlist: '🤖 Mix cheio! Queres entrar como suplente? Responde com *Sim* ou *Não*.',
  guest_joined: '🤖 Fixe, {{name}}! Inscrevi-te como convidado 🎾 Regista-te em {{appUrl}} para veres o teu histórico, o dos teus amigos, e desbloquear recompensas.',
  partner_joined_use_app: '🤖 Inscreveste-te em dupla pela app — para sair, usa a app 📱',
  waitlisted_use_app: '🤖 Estás na lista de suplentes — para sair, usa a app 📱',
  not_joined: '🤖 Não estás inscrito neste mix.',
  mix_code_not_found: '🤖 Não encontrei nenhum mix aberto com o código {{code}}.',
  disambiguate_in: '🤖 Há vários mixes abertos! Qual deles?\n\n{{list}}\n\nEscreve *In {{code}}* (com o código do mix que queres).',
  not_in_any_open_mix: '🤖 Não estás inscrito em nenhum mix aberto.',
  disambiguate_out: '🤖 Estás inscrito em vários mixes! De qual queres sair?\n\n{{list}}\n\nEscreve *Out {{code}}* (com o código do mix).',
}

const en = {
  help_footer: '\n\n💬 Type */help* to see every command.',
  help_text: `🤖 *Bot commands*

To join a mix:
• *Alinho* / *In* / *Dentro* / *Estou dentro*

To leave a mix:
• *Out* / *Fora* / *Estou fora* / *Saio*

If more than one mix is open at the same time, the bot tells you each one's code (🆔) — type the command followed by the code, e.g.:
• *In 1234*
• *Out 1234*

If the mix is full, the bot asks if you want to join as a substitute — reply *Sim* or *Não*. When someone leaves, the first substitute joins automatically.

To see this list:
• */help*`,

  // roster.js — promoted-from-waitlist callout (personalized per promoted player)
  promoted_to_confirmed: '🎉 {{name}} moved up from the waitlist!',

  // sync.js — cancelled-mix group broadcast
  mix_cancelled: '📢 @all\n\n🤖 The mix "{{title}}" was cancelled ❌',

  // reminders.js
  reminder_roster_line: 'Signed up: {{names}}\n\n',
  reminder_group: "🤖 ⏰ *Reminder!* *{{title}}* starts in {{hours}}h.\n📅 {{when}}{{location}}\n\n{{roster}}Don't miss it! 🎾",
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
  guest_waitlisted: "🤖 Nice one, {{name}}! You're on the waitlist as a guest 🎾 You'll join automatically when a spot opens up. Sign up at {{appUrl}} to see your history and unlock rewards.",
  waitlist_declined: "🤖 No problem, you weren't added to the waitlist. Sign up for the next mix! 🎾",
  did_not_understand_yes_no: "🤖 Sorry, I didn't catch that 🤔 Reply with just *Sim* or *Não*.",
  no_open_mixes: "🤖 There's no mix open for sign-ups right now.",
  mix_already_started_out: "🤖 This mix has already started or finished — you can't leave here anymore.",
  already_joined: "🤖 You're already signed up for this mix! 🎾",
  mix_full_offer_waitlist: '🤖 Mix is full! Want to join the waitlist? Reply *Sim* or *Não*.',
  guest_joined: "🤖 Nice one, {{name}}! You're in as a guest 🎾 Sign up at {{appUrl}} to see your history, your friends', and unlock rewards.",
  partner_joined_use_app: '🤖 You joined as a pair through the app — to leave, use the app 📱',
  waitlisted_use_app: "🤖 You're on the waitlist — to leave, use the app 📱",
  not_joined: "🤖 You're not signed up for this mix.",
  mix_code_not_found: "🤖 I couldn't find any open mix with code {{code}}.",
  disambiguate_in: '🤖 There are several mixes open! Which one?\n\n{{list}}\n\nType *In {{code}}* (with the code of the mix you want).',
  not_in_any_open_mix: "🤖 You're not signed up for any open mix.",
  disambiguate_out: "🤖 You're signed up for several mixes! Which one do you want to leave?\n\n{{list}}\n\nType *Out {{code}}* (with the mix code).",
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
