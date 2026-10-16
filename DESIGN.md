---
name: alinho
description: Daylight padel club app — warm light-grey ground, white cards, one strong colour per game type, a single lime ball for the main action, bold Outfit numbers, glass bars over photo covers.
updated: 2026-10-16
source_of_truth: "Alinho/design-handoff/2026-10-13-redesign (R0–R16) + the prototype https://claude.ai/artifact/2SDpaFaEjFniYkNGVLL7sD + src/index.css, src/lib/kindColors.js"
colors:
  ground: "#F1F2EE"        # page background of the whole app (R12)
  card: "#FFFFFF"          # cards, sheets, fields, top bars
  box: "#F4F5F1"           # boxes INSIDE a white card (data tiles, rows, organizer box) — token surface / ink-50
  ink-900: "#040404"       # text, black buttons, level pill
  ink-700: "#1F2937"
  ink-500: "#4B5563"       # secondary text (min. on ground)
  ink-200: "#9CA3AF"       # icons, dashed empty circles; never body text on ground
  line: "#E5E7EB"
  outline: "#CFD2D7"       # 1.5px border of the outline (secondary) button
  lime: "#C5DD01"          # the ball: ONE main action per screen + "yours"
  lime-dark: "#99B200"     # lime hover/active (darker, on purpose)
  lime-tint: "#F4F8DC"     # «✓ Estás dentro» box, search match highlight
  tab-track: "#E7E9ED"     # tab (separador) pill track
  ok: "#0E8F63"
  danger: "#EF4444"
  mix: "#1D4ED8"
  mix-dark: "#14369A"
  mix-light: "#EEF3FF"
  open: "#C2410C"
  open-dark: "#8F2F08"
  open-light: "#FFF1EA"
  free-slots: "#F2BFA8"
  tournament: "#5B21B6"
  tournament-dark: "#3F1784"
  tournament-light: "#F3EEFF"
  league: "#BE185D"
  league-dark: "#8A1145"
  league-light: "#FCE7F3"
  lesson: "#15803D"
  lesson-dark: "#0F5A2B"
  lesson-light: "#E7F6EE"
  friends: "#374151"
  friends-dark: "#1F2937"
  friends-light: "#EEF0F3"
typography:
  display:
    fontFamily: "Outfit, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontWeight: "700–900"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist Sans, -apple-system, Segoe UI, Roboto, Arial, sans-serif"
    fontSize: "14–16px"
    fontWeight: 400
    lineHeight: 1.5
  mono-label:
    fontFamily: "Geist Mono, ui-monospace, Menlo, monospace"
    fontSize: "10.5–11px"
    fontWeight: 500
    textTransform: uppercase
    letterSpacing: "0.08em"
rounded:
  ctrl: "12px"       # buttons, inputs
  card: "16px"       # cards (16–22px allowed; event cards 20px, event sheet 22px)
  full: "9999px"     # pills, tabs, chips, search box, circles, bottom nav
shadows:
  card: "0 1px 2px rgba(17,17,17,.06)"
components:
  button-primary:   { background: "{colors.lime}", text: "{colors.ink-900}", rounded: "{rounded.ctrl}", height: "48px", weight: 800 }
  button-black:     { background: "{colors.ink-900}", text: "#FFFFFF", rounded: "{rounded.ctrl}", height: "48px", weight: 800 }
  button-outline:   { background: "#FFFFFF", border: "1.5px {colors.outline}", text: "{colors.ink-900}", rounded: "{rounded.ctrl}", height: "48px", weight: 800 }
  button-danger:    { background: "{colors.danger}", text: "#FFFFFF", rounded: "{rounded.ctrl}", height: "48px", weight: 800 }
  card:             { background: "{colors.card}", rounded: "{rounded.card}", padding: "20px", shadow: "{shadows.card}", border: none }
  box-in-card:      { background: "{colors.box}", rounded: "14px", border: none }
  input-field:      { background: "#FFFFFF", border: "1px {colors.line}", rounded: "{rounded.ctrl}", height: "48px", fontSize: "16px" }
---

# Design System: alinho (redesign of 13 Oct 2026)

> This file replaces the 24 Sep version («The Night Court»: white canvas, grey recessed cards, black liquid-glass
> header). **That look is gone.** If a mockup has a pure-white page with grey cards, a black top header, or pastel /
> gradient event cards, it is the old design. See «What is no longer used» at the end.
>
> When this file and the code disagree, the code in `origin/dev` and the SPECs in `Alinho/design-handoff/` win. The
> prototype (link above) is the visual reference: the app must match it exactly.

## Overview

**North star: «Daylight court».** A club board seen in daylight. The page is a warm light grey (`#F1F2EE`) and the
things you act on are clean white cards on top of it. Each game type has one strong, saturated colour (mix blue,
open orange, tournament purple…). It paints the card's top stripe, the cover and the type dot, so you can tell the
type before you read it. The lime ball (`#C5DD01`) is rationed: one main action per screen, plus the marks that say
«this one is yours».

Numbers carry the screen. The hour of a game is huge (Outfit 800–900), places left are big digits, and labels are
small uppercase mono, like a scoreboard. The mascot **Alino** (a lime tennis ball with a headband) appears in
covers, empty states and errors, never inside event cards.

Built for one thumb, mid-game, on a phone. The same column centres on desktop.

**Key characteristics**
- Three colour layers: grey ground → white card → light box inside the card. Never a white card inside a white card.
- One strong colour per type, always the same and in the same order.
- One lime button per screen. Organizer actions are black. Destructive actions are red.
- Buttons are stacked at full width, never side by side.
- Photo or Alino covers on event, club and group pages, with a glass bar on scroll.
- Everything a person can tap has text at weight 800 and is at least 44–48px tall.

## Colours

### The three layers (R12, R12b)
| Layer | Colour | Used for |
|---|---|---|
| Ground | `#F1F2EE` (token `ground`) | the background of every app page, behind everything |
| Card | `#FFFFFF` | cards, the event sheet, bottom sheets, form fields, page top bars |
| Box | `#F4F5F1` (tokens `surface` / `ink-50`) | boxes **inside** a white card: data tiles, rows, the organizer box, list rows |

- Cards: white, **no border**, shadow `0 1px 2px rgba(17,17,17,.06)`, radius 16–22px.
- **Never white on white.** Something inside a white card is `#F4F5F1`, not white with a border.
- **Tabs and filter bars sit directly on the grey ground**, with no white strip behind them.
- The external site (landing, «Como funciona», Ajuda, login) keeps its own cream background. R12 applies to the app
  only.

### Ink
`#040404` text and black buttons · `#1F2937` strong secondary · `#4B5563` secondary text · `#9CA3AF` icons, dashed
empty circles and disabled states only. On the grey ground, grey text is at least `#4B5563`/`#6B7280`, so it passes AA.

### Lime: the ball
- `#C5DD01` is the main action (one per screen): «Entrar no mix», «Inscrever dupla», «Aceitar», «Guardar».
- It also marks «yours»: the 2px lime border on your event cards, the «✓ Estás dentro» pill, the active bottom-nav
  label, notification badges, and the level pill text.
- Hover/active goes **darker** (`#99B200`), never lighter. This is deliberate.
- `#F4F8DC` (lime tint) is the background of the «✓ Estás dentro» box and of search highlights.
- Lime is **never** a type colour and never goes on a destructive action.

### Type colours (R0) — `src/lib/kindColors.js` is the only source
| Type (in this order everywhere) | Strong (stripe, cover, dot, type pill) | Dark (text on light) | Light (backgrounds) |
|---|---|---|---|
| Mix | `#1D4ED8` | `#14369A` | `#EEF3FF` |
| Jogo em aberto | `#C2410C` | `#8F2F08` | `#FFF1EA` |
| Horários livres | `#F2BFA8` (dot and dashed border) | `#8F2F08` | `#FFF1EA` |
| Torneio | `#5B21B6` | `#3F1784` | `#F3EEFF` |
| Liga | `#BE185D` | `#8A1145` | `#FCE7F3` |
| Aula / turma | `#15803D` | `#0F5A2B` | `#E7F6EE` |
| Entre amigos | `#374151` | `#1F2937` | `#EEF0F3` |

- Text on a strong colour is always white (all pass AA).
- Type order is always: Mix, Jogos em aberto, Horários livres, Torneios, Liga, Aulas, Amigos (filters, «+ Criar»,
  legends).
- A type colour **never** goes on an action button. Actions are lime, black or outline.

### Semantic
- **Ok** `#0E8F63` (dark green): «Estás dentro · campo 1», «Inscrições abertas», confirmed.
- **Danger** `#EF4444`: errors and destructive or irreversible actions only. Solid red button in a confirmation of a
  high-risk action; red underlined text link for the entry point.
- Status lines also use the type's dark colour (e.g. «Faltam 2 para fechar o campo 2» in the open/mix dark).

## Typography

**Outfit** for anything display: titles, hours, big numbers, buttons. **Geist Sans** for reading text. **Geist Mono**,
small, uppercase and tracked, for scoreboard-like labels («MIX · M5», «6/8 INSCRITOS», «ORGANIZAS ESTE MIX», «DIAS»).

| Role | Spec |
|---|---|
| Event hour on the event page | Outfit 900, ~56px, tight; beside it «até 21:30», «recorrente» or «sáb e dom» in Geist ~20px `#4B5563` |
| Event name on the event page | Outfit 800, ~26px |
| Hour on an event card | Outfit 800, ~32px, white on the type stripe |
| Places on a card | «9/12» big digits (the total smaller) + «inscritos», «jogadores», «duplas», «alunos» |
| Card title | Outfit/Geist 700–800, ~17.5px |
| Page title (Comunidade, Rankings…) | Outfit 800–900, 28–32px |
| Bar title (glass bar) | Outfit 800, 16px, one line, ends in «…», with the type dot |
| Empty-state title | Outfit 900, 19px, `text-wrap: balance`, **no full stop** |
| Empty-state text | Geist 13.5px, `#4B5563`, balanced |
| Day header | «Hoje» big + «segunda, 12 out» grey + «5 jogos» mono on the right |
| Eyebrow / status label | Geist Mono 10.5–11px, uppercase, tracked |
| Body | Geist 14–16px. **Inputs and search are always 16px**, or the iPhone zooms in |
| Buttons, chips, tabs, nav labels | weight 800 («extrabold if tappable») |

Ordinals «1.º», «2.ª» use the system font (the «Alinho Ordinais» face).

## Layout

- Mobile-first, one column. Side gutter 16px. Cards, boxes, the big title and the glass circles all align to that
  16px line.
- **Desktop:** the same column, centred (`scrollbar-gutter: stable`, so the column doesn't jump when the scrollbar
  appears). Event, club and tournament pages use a 640px sheet; «jogo entre amigos» is narrower (`max-w-lg`). The
  cover is as wide as the sheet. The glass bar spans the whole window, while its buttons align with the page's
  cards. No multi-column app layout.
- Spacing: Tailwind 4px scale. Card padding 20px; boxes inside 12–16px; sections 24–32px.
- Bottom nav floats above the safe area. Content always leaves room for it.
- iPhone safe area: anything stuck to the top sits below `env(safe-area-inset-top)`, and the glass covers the clock
  strip.

## Page tops

### A. Pages with a cover: event (mix, aberto, torneio, liga, aula, amigos), club, group (R3, R5)
1. **Cover** ~210px at full sheet width: the organizer's photo, or the **Alino image of the type**
   (`/topo/topo-<tipo>.webp`, 900×450), or for clubs and groups `/topo/topo-clube-alino.webp` /
   `topo-grupo-alino.webp` (920×400). The image covers its area and is pulled up so heads aren't cut. Under the image
   sits the strong type colour, so a slow load never shows a white hole. Bottom-left: a dark pill «● Mix · M5 ·
   recorrente».
2. **The white sheet rises over the cover** (top corners 22px, ~20px overlap). Inside it: club line «Maré Alta Padel ·
   Clube ›» → name (26px) → **hour (56px)** + «até 00:00» → full date + «Adicionar ao calendário» (underlined).
3. **Status strip** in the type's light colour: faces plus dashed empty places, the status in the type's dark colour or
   green, and below it, in mono, «6/8 INSCRITOS · HOJE».
4. **Organizer box** (only for whoever organizes, R3b), right after the date: a `#F4F5F1` box. Inside:
   - «● ORGANIZAS ESTE MIX · INSCRIÇÕES ABERTAS» in mono;
   - when there is a next step, «Próximo passo: Começar o Mix ↓», underlined, which scrolls to the black button;
   - an outline «✎ Editar e mais opções».
5. **Buttons stacked at full width**: one lime main action, then an outline secondary («Entrar com parceiro», «Não
   posso ir»). When you're in: a lime-tint «✓ Estás dentro» box and, below it, «Sair do mix» in outline.
6. **Data tiles** in a 2-column grid (`#F4F5F1`, mono label, bold value): Formato, Campos, Preço, Prémio, Escalão,
   Nível. Then the address with «Abrir com…».

### B. The glass bar (when a page scrolls)
Approved 14 Oct («como no topo da app do Claude»), tuned 15 Oct. Component: `GlassBar` / `BackBar`.
- **The circles never move.** «‹» on the left and share (plus ♡ on club and group) on the right. They are always
  **42px glass circles**: white 55% + blur, a thin white border and a soft shadow. They sit in the same place from the
  top of the page, over the cover photo too. Their outer edge aligns with the cards' edge, at 16px inside the sheet
  or cover.
- **No solid background.** The glass is a 10px blur with a gradient of the ground colour: `#F1F2EE` at 92% at the top,
  ~75% in the middle, 0 at the bottom. It has no line, corners or shadow, fades out at the bottom, and spans the
  whole window edge to edge.
- **When the glass appears:** when the first line of text of the sheet (the club line, or the title) reaches the
  bottom of the circles. Before that there are only circles. On an iPhone, a glass strip the height of the safe area
  always covers the clock.
- **When the name appears:** when the **last line of the big title** reaches the bottom of the circles. The small
  name (with the type dot) fades in at the centre of the bar while the big title fades out (150ms crossfade). Scrolling
  up reverses it. The two titles are never visible together, and the big title is never seen cut.
- Tabs on the page («Inscritos · Rondas · Classificação», «Quadro · Horário · Duplas», «O que vem aí · Já jogados»)
  stick right under the bar, inside the same glass. On a tournament, the category selector sticks with them.
- Pages without a cover that only have «‹» (jogador, professor, horário, XP…) use the same glass bar, not a white bar.
- On the test site the orange «Ambiente de testes» strip is on top, and the bar sticks right below it.

### C. Pages with a title top: Home, Comunidade, Rankings, Perfil, Gerir (R2, R12b)
- A white top at column width, stuck at the top, **bottom corners 16px** and the card shadow. When it is made of
  several white blocks, only the last one gets the corners.
- Home: «SEGUNDA-FEIRA», «12 Outubro ⌄» big, map, bell and «Lisboa ⌄». On scroll only the filter bar sticks, and it
  gains a «12 out ⌄» pill.
- Rankings, Perfil, Gerir: on scroll the tab pill and the filter bar stick together, on the grey ground. The big title
  scrolls away.

## Tabs vs filters — one rule (24 Sep)
Ask: «If I change option, do I still see the same list, only with fewer things?» Yes → **filter**. No → **tab**.
- **Tab (separador):** a grey pill track `#E7E9ED`, fully rounded, with 4px inset. Options are glued together with
  equal widths, **text only**, 15px bold. The chosen one is white with a soft shadow, at least 44px tall. **2 or 3
  options only.** No lime. Draw it only with `<Tabs>` from `src/components/ui.jsx`.
- **Filter / form choice:** loose round chips with a thin border; the chosen one is **black with white text** (with the
  type dot when it's a type). Chips slide sideways and never wrap. Visible 36–40px, touch area ≥44px. Draw them only
  with `<Chips>`.
- The filter bar (`FilterBar`): a round 🔍 36px, a thin divider, then chips. It slides sideways (mouse wheel on desktop).
- A test (`separadores.test.js`) fails if the old square grey track comes back.

## Search (14 Oct)
- The same box everywhere: tapping 🔍 opens it **in place of the bar**. It is fully round, 36px tall, white with a
  1.5px black border while open, a grey 🔍 on the left, 16px text at weight 500, and a «✕» in a 26px grey circle that
  clears and closes.
- The placeholder always starts with «Procurar…» («Procurar jogos, clubes ou pessoas», «Procurar jogador»…).
- Matches are highlighted in lime tint. No results: Alino «a pensar», «Nada com esse nome», «Experimenta outro nome, ou
  só uma parte dele.»

## Buttons
- **Stacked, full width, never side by side.** That includes «Aceitar» / «Recusar» and confirmations.
- 48px tall, radius 12px, weight 800, `active:scale-[0.98]`.
- **Lime** = the one main action of the screen (for the player). At most one lime button per screen.
- **Black** = an organizer action («Começar o Mix», «Pôr as duplas nos campos», «Marcar resultados») and the confirm
  button of a normal confirmation.
- **Outline** = white with a 1.5px `#CFD2D7` border: the secondary action («Ainda não», «Não posso ir», «Editar e mais
  opções»). Hover darkens only with a mouse.
- **Red** = destructive or irreversible. A solid red button only in the confirmation of a high-risk action (e.g.
  «Desfazer as duplas» when Round 1 games would be lost); otherwise red underlined text («Desfazer as duplas», «Apagar
  evento»). The colour of the entry link matches the colour of its confirm button.
- Text links: black, underlined, weight 800 («Adicionar ao calendário», «Tirar», «Ver todos os membros ›»).
- WhatsApp keeps its own green `#25D366` (it must read as «opens WhatsApp»).

## Confirmations (bottom sheet)
White sheet with a grab handle, rounded top. It holds a title as a question («Desfazer as duplas?»), a short grey
text that says the effect («As duplas saem e todos voltam aos inscritos. Depois podes fazer as duplas outra vez.»),
then the buttons stacked:
1. the action, **black**, or **red** when it is destructive or high-risk;
2. **«Ainda não»** in outline.
The text says what happens, never how the system works. Use `ConfirmSheet` (`danger` makes it red).

## Event cards (R1) — `src/components/agenda/EventCard.jsx`
- **Solid stripe at the top**, in the strong type colour, with white text:
  - line 1: the type and its detail in small mono («MIX · M5», «TORNEIO · 3 CATEGORIAS») and, on the right, the
    status pill («✓ Estás dentro» lime with black text; «Convidado» black);
  - line 2: the **hour, big** (32px), with «até 00:00» / «sáb e dom» / «recorrente» small; on the right, **places**
    «9/12» with «inscritos».
- **With a photo:** the photo (~120px) with the type pill on it, and below it a thin stripe with only the hour and
  the places.
- **White body** (radius 20px, no border):
  - the club with its round logo and «›» (it opens the club);
  - the event name;
  - a grey line with format · courts · price;
  - a status line with a dot;
  - at the bottom, faces and empty places on the left, and **one button** on the right («Entrar» lime, «Ver» outline
    when you're in, «Aceitar» lime with «Não posso ir» as text below it).
- **Yours:** a 2px **lime** border around the whole card, plus the «✓ Estás dentro» pill.
- No mascots, no gradients and no pastel backgrounds on cards. «Horários livres»: a dashed light-orange card with one
  pill per hour.

## Faces and empty places (the circles rule, 14 Oct)
- Faces of the people in, then **one dashed circle per missing place**. Everywhere: cards, the event status strip, lists.
- Big events show **6 circles at most**:
  - up to 4 faces; if more people are in, the 4th becomes a grey filled «+N» (people you don't see);
  - then dashed circles up to 6;
  - if more places are missing, the last dashed circle carries «+N» (places left), 10.5px, weight 700, grey.
  Grey filled with a number = people. Dashed with a number = free places.
- Tournaments count **pairs** (5 pairs missing → 5 dashed circles).
- Circles overlap by −8px. Each one has a white fill and a 2px white ring (`box-shadow: 0 0 0 2px #fff`) and sits
  under the previous one, except the «+N» dashed circle, which goes on top. Never let `overflow` cut the ring.
- If the person can't see the club's members: a grey count instead of faces.
- A dashed border always means **empty / provisional / guest**, never a filled or confirmed thing.

## Avatars
- People: a round photo, or initials on dark `#1F2937` with white text.
- Clubs: **rounded square** logo (club) · groups: round. Without a photo they get their own Alino avatar
  (`avatar-clube.webp`, `avatar-grupo.webp`, 384², approved 14 Oct and coming soon). Never a crop of the cover image.
- Level pill: black with lime mono text («M4», «F1»), lime with black text when it's you.
- XP levels (Iniciado → World Class, 10 levels in `src/lib/xp.js`) use a coloured ring or dot today. Shields per
  level are being designed (17 Oct).

## Empty states and errors — Alino
- A page with nothing to show: **Alino «a pensar»** (~120px) at the centre, then a title (19px/900, no full stop) and
  a short grey sentence, with an optional outline button. Use `EmptyState` (`pose`), never a custom one.
- Errors: Alino «triste» (`pose="triste"`), the sentence, what to do, and a way out (button).
- An empty **section inside a page that has other content**: no Alino. One line, with the title in bold followed by
  the sentence in grey (`EmptyState pose={null}`).
- Poses in `public/alino/`: a-pensar, triste, festa, olá, pronto. Alino never appears in event cards, and never when
  there's a real photo.

## Bottom navigation
A **dark floating pill** (`#040404` at 90–95% with blur, white/10 ring, big soft shadow), up to 480px wide and
centred, floating 16px above the safe area. Five equal items: Home, Comunidade, Rankings, Perfil (your avatar, 24px),
Gerir. The active item gets a `white/15` chip with its **label in lime** (10px, 800). Inactive items are `#9CA3AF`
icons. Badges are lime with a black number. It is hidden on step-by-step pages (create/edit).

## Forms and creating
- Long forms go **in steps**, people first: Pessoas → Quando → Onde joga → Regras → «Rever» (with the card preview).
  The name is always visible, and the button sticks to the bottom.
- Fields: white, 1px `#E5E7EB` border, 16px text, 48px. Date, time and select open custom bottom sheets.
- A missing field after «Seguinte» gets a red border and ring.

## Copy (Portuguese, European)
- The product is **«o alinho»** / **«o alinho.pt»**, masculine (never «a Alinho»).
- No jargon: «Ranking» and «nível», never «Elo». «A decorrer», never «ao vivo».
- Labels are 1–3 words. Titles of empty states and sheets have no full stop. Quotes are «», never "".
- Say the effect, not the mechanism («Todos voltam aos inscritos»).
- **Mockups use fictitious data only:** Rita Figueira, Tiago Lopes, Ana Moreira; clubs **Maré Alta Padel** and
  **Serra Azul Padel**; mark images «Imagem ilustrativa». Never real club names or real people.

## Do
- Use the three layers: ground `#F1F2EE` → white card → `#F4F5F1` box.
- Give each type its strong colour, in the fixed order.
- Have one lime action per screen; black for organizers; red only for destructive actions.
- Stack buttons at full width.
- Use big Outfit numbers for hours and places, and small mono labels.
- Use dashed circles for every missing place.
- Use Alino for empty pages and errors.
- Keep the glass circles fixed and the title crossfading into the bar.

## Don't — what is no longer used
- **Pure white page background with grey (`#F3F4F6`) recessed cards.** That is the 24 Sep «Night Court» look. Cards are
  white on grey now.
- **A black liquid-glass top header** in the app. Tops are white with 16px bottom corners, or the light glass bar.
  Only the bottom nav is dark.
- **A white strip behind tabs or filters.** They sit on the grey.
- **A white opaque back bar** (14 Oct). Replaced by the glass bar.
- **Dark translucent circles on the cover** that swap for others on scroll. The glass circles are always the same.
- **Pastel, gradient or mascot event cards**, and the old type colours (brown for friends, turquoise for lessons,
  `#8C2350` for the league, court-blue / volt-green). Use the R0 table.
- **Buttons side by side**, two lime buttons on one screen, a type colour on a button, lime on a destructive action.
- **«Sê o primeiro»** or an empty line where places are free. Show dashed circles.
- **Cropping the cover image** for club or group avatars.
- Fonts other than Outfit, Geist Sans and Geist Mono (Manrope is gone).
- Fake metrics, testimonials, user counts or real people and clubs in mockups.

## Known gaps (16 Oct)
- Only Outfit 500/600/700 are self-hosted (`src/index.css`), but the redesign uses 800/900 for hours and titles.
  The browser fakes the extra weight. Loading `@fontsource/outfit/800.css` and `900.css` would make it exact.
- Club and tournament pages on desktop: the cover is 16px wider than the cards on each side, and the club page still
  has a wide white sheet. Both are being fixed after 16 Oct.
