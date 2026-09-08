# Game Formats — "Pares Partidos" and Modular Models — Decision Spec

Covers Trello **#102** ("Testar grupos com formato de jogo diferente — inclui
decidir 'pares partidos'", P0) and **#37** ("Adicionar mais modelos de jogo
para os mixs", P2) together, because they are the same problem at two
scopes: #102 is one concrete new format, #37 is the general ability to have
many.

**This is a decision document, not an implementation spec.** #102 explicitly
says the call — does this format enter development now? — has not been made,
and it is Francisco and Renato's to make, not engineering's. So this
documents what exists, what it would cost, and what has to be decided. An
implementation spec and plan follow *after* the decision, per the normal
repo workflow. A Portuguese summary of the decision itself is at §7, since
the person deciding does not read code.

## Goal

Answer three questions with real findings instead of guesses:

1. What does the engine actually assume today?
2. What does "pares partidos" (partner rotates every round, Americano-style)
   cost to add, and what breaks?
3. What does #37's "modelar, o próprio utilizador define" mean concretely —
   and how much does the answer change the cost?

## Key Findings

**The fixed dupla is not a UI convention, it is the data model.** A mix's
pairs become permanent rows in `teams (game_id, player1_id, player2_id,
seed_ranking)` the moment the mix starts, and `matches.team_a_id` /
`matches.team_b_id` are foreign keys to those rows. Scores, standings, the
Elo calculation, the mix winner and the WhatsApp roster all read through
`teams`. "One pair, one row, for the whole mix" is baked in at the bottom.

**But most of the downstream stack is already per-player, not per-pair.**
This is the single most important finding in this document, and it is good
news:

- `mix_player_stats` is already keyed `(game_id, user_id)` — per player,
  with `matches_played`, `matches_won`, `points_earned`, `mix_won`.
- `apply_mix_elo` (`migration_elo_rating.sql:91`) iterates **match by
  match**, joining `teams` only to resolve the four player ids for that
  match. It never assumes a pair persists across rounds.

So rotating partners does not require rewriting the rating or the stats. It
requires changing where the four player ids per match come from.

**The one genuine breakage is the mix winner.** `finalize_mix(p_game_id,
p_winner_team_id)` takes a *team* id, `games.winner_team_id` stores a team,
and the merit bonus in `apply_mix_elo` pays the two players of that team. In
a pares-partidos format the winner is **an individual**, not a pair. There is
no team row that means "the person who won the night". This is the part with
no existing shape to reuse.

**The mix-start logic is duplicated in the bot.**
`whatsapp-bot/src/autostart.js` re-implements `formDuplas` and the
team-insert half of `handleStartMix` from `GameDetails.jsx`, so it can
auto-start a due mix with nobody present. Any format change is therefore a
change in **two** codebases, and the bot has no CI — it needs a manual
redeploy to EC2. This is easy to forget and would produce a bug where a mix
started by an admin behaves differently from the same mix started
automatically.

**`games.format` is a `CHECK` constraint, not a lookup table.**
`CHECK (format IN ('sobe_desce', 'todos_contra_todos'))`. Every new format is
a migration. Fine for 3-4 formats, wrong shape for "the user defines it".

## 1 — What exists today

Two formats, both fixed-pair, both implemented as pure functions in
`src/lib/mixLogic.js`:

| Format | Engine functions | Round structure |
|---|---|---|
| `sobe_desce` | `seedCourts`, `nextSobeDesce` | Winner moves up a court, loser moves down. Mix winner = court-1 winner in the last round. |
| `todos_contra_todos` | `roundRobinRound`, `standings`, `eliminationPhases`, `firstElimMatches`, `nextElimMatches` | Full round-robin; leftover rounds become a knockout. |

`mixLogic.js` is already well isolated — pure, no I/O, documented decisions
at the top. It is the *right* place for a third format and is not the
expensive part. The cost is everywhere else.

## 2 — Why "pares partidos" breaks the model

Americano / pares partidos: every round, partners are redrawn. Over a night
each player plays with many different partners and accumulates an individual
score.

Against the current model that means:

- A `teams` row can no longer represent "a dupla in this mix" — pairs exist
  for one round only.
- `games.winner_team_id` has no meaningful value.
- `formDuplas` runs once, at start, and never again — the wrong lifecycle.
- The mix winner must be computed from per-player points, which
  `standings()` does not do (it aggregates by team).
- The bot's roster message announces the duplas for the mix; here they
  change every round.

## 3 — The two ways to build it

### Option A — a `teams` row per round *(recommended)*

Keep `teams` as the join between a match and four players, but stop treating
a row as "a pair for the whole mix". Generate fresh pairings each round and
insert new `teams` rows for them.

What changes:

- `matches` — **nothing.** It already points at team rows per match.
- `apply_mix_elo` — **nothing.** It already resolves players per match.
- `mix_player_stats` — **nothing.** Already per player.
- `mixLogic.js` — one new pairing function (rotate partners each round) plus
  a per-player standings function alongside the existing per-team one.
- `finalize_mix` / `games.winner_team_id` — needs a per-player winner path.
  Cheapest honest version: add a nullable `games.winner_user_id` and let
  `finalize_mix` accept either, rather than overloading the team column with
  something that is not a team.
- `GameDetails.jsx` — the scoring UI stays; the classification table gains a
  per-player mode; the "Duplas" card becomes per-round.
- `whatsapp-bot/src/autostart.js` — must learn the same pairing rule.
- One migration: relax the `format` CHECK, add `winner_user_id`.

Risk: moderate and contained. Nothing already in production changes
behaviour — the existing two formats keep the same code path.

### Option B — a per-player scoring model

New tables that score individuals directly; `teams` used only for the two
legacy formats.

Conceptually cleaner for Americano, and a better foundation if many
individual-scored formats are coming. But it forks the engine in two, and
Elo, stats, the finalize path, the results UI and the bot all have to learn
which world they are in. Substantially more work, and more places for a live
mix to break.

**Recommendation: Option A.** It reuses everything that is already
per-player, and the only genuinely new concept it introduces is "the winner
can be a person, not a pair" — which is unavoidable in either option.

## 4 — #37 scope: DECIDED (Francisco, 2026-09-08)

The question in §4 of the first draft — longer menu, or format builder? — has
been answered: **a structured catalogue of built-in formats, extensible with
new ones on user demand.** Not a rules builder the admin operates. Francisco's
words: *"dar várias possibilidades mas de forma organizada e estruturada […]
também se pode incluir um novo formato mais para a frente se precisarmos e se
tivermos esse pedido pelos utilizadores."*

Two further requirements came with it:

- **Be as complete as reasonable up front**, using PadelMix's catalogue as the
  reference bar for what a padel audience expects.
- **An admin must be able to switch a mix to another format.** See §4.4.

### 4.1 The three axes

The named formats out there are not eight unrelated things. They are
combinations along three independent axes. Building the axes — rather than
eight bespoke code paths — is what makes "organizada e estruturada" real, and
is what makes format #9 cheap instead of another rewrite.

**Axis A — how pairs are formed**

| Value | Meaning |
|---|---|
| `fixed` | Pair set when the mix starts, unchanged all night. *This is the only value that exists today.* |
| `rotating` | New partner every round, on a fixed rotation so everyone partners everyone. |
| `by_standings` | Partner chosen each round from the current classification (1st+4th vs 2nd+3rd). |

**Axis B — how opponents and courts are decided**

| Value | Meaning |
|---|---|
| `ladder` | Winner goes up a court, loser goes down. *Exists (`nextSobeDesce`).* |
| `round_robin` | Everyone meets everyone. *Exists (`roundRobinRound`).* |
| `by_standings` | Opponents matched on current classification. |
| `groups_then_knockout` | Split the field into groups, then a knockout between the qualifiers. |

**Axis C — how the mix winner is decided**

| Value | Meaning |
|---|---|
| `winning_pair` | The pair that wins the decisive match. *Exists.* |
| `individual_points` | Highest individual point total across the night. |
| `final_match` | Winner of the final, with placement matches below it. |

### 4.2 The catalogue

Each named format is a **preset** over those axes — a row of configuration,
not a new engine.

| Format | A — pairs | B — opponents | C — winner | State |
|---|---|---|---|---|
| Sobe e desce | `fixed` | `ladder` | `winning_pair` | **Exists** |
| Todos contra todos | `fixed` | `round_robin` | `winning_pair` | **Exists** |
| Americano | `rotating` | `round_robin` | `individual_points` | New |
| Mexicano | `by_standings` | `by_standings` | `individual_points` | New |
| Americano de equipas | `fixed` | `round_robin` | `individual_points` | Near-duplicate of Todos contra todos — differs only in axis C. Cheapest of all. |
| Americano misto | `rotating` (gender-constrained) | `round_robin` | `individual_points` | New. The gender constraint already exists — `migration_mix_gender_restriction.sql`. |
| King of the Hill / Beat the Box | `fixed` | `ladder`, two stages with regrouping between them | `final_match` | New |
| **Grupos + finais 1º/2º/3º/4º** | `fixed` | `groups_then_knockout` | `final_match` | New — Francisco's stated use case for large venues |

### 4.3 What the catalogue exposes that is genuinely missing

Two of these need schema work that no existing feature covers:

**Group stages do not exist.** There is a knockout (`eliminationPhases`,
`firstElimMatches`, `nextElimMatches`) but nothing that splits the field into
groups and tracks which group a pair is in. Needs a group marker on `teams`
(or on `matches`) plus qualification rules from `standings()`.

**There is no placement match.** `matches.phase` is
`CHECK (phase IN ('group', 'quarter', 'semi', 'final'))`. A 3rd/4th place
playoff has no valid value — so Francisco's "finais de 1 2 3 4 lugar" needs a
migration to widen that CHECK (e.g. add `third_place`), not just UI work.

**Rotating partners need per-round pairs** — the whole of §3, Option A.

By contrast, `Americano de equipas` needs no new pairing and no new
scheduling: it is `Todos contra todos` scored per player instead of per pair.
It is the cheapest possible first delivery and would prove axis C end to end
(including the `winner_user_id` path) before any pairing work starts.

### 4.4 Switching a mix to another format

*"Que também seja possível alterar para outro modelo sempre que quisermos."*

This splits cleanly by mix state, and the split matters because one half is
destructive:

- **Before the mix starts** (`open` / `closed` / `pending`): free. No `teams`
  or `matches` rows exist yet — it is just a column change.
- **After it starts** (`in_progress`): changing format invalidates the pairs,
  the schedule and any score already entered. It has to delete `teams` and
  `matches` and rebuild. That is a destructive action and per `CLAUDE.md`
  needs an explicit confirmation dialog spelling out that entered results
  will be lost.
- **Finished**: not allowed. Elo and `mix_player_stats` have already been
  written from the results; re-running a different format over them would
  corrupt ratings that are global and shared across clubs.

### 4.5 Suggested delivery order

Not a commitment, but the order that de-risks the most per step:

1. **Americano de equipas** — proves axis C (individual scoring +
   `winner_user_id`) with zero pairing or scheduling change.
2. **Americano** — adds axis A `rotating` (Option A, §3), reusing the axis C
   work from step 1.
3. **Grupos + finais 1º-4º** — adds axis B `groups_then_knockout` and the
   `third_place` phase. Independent of steps 1-2.
4. **Mexicano**, **King of the Hill** — combinations of what steps 1-3 built.

Steps 1 and 3 do not depend on each other and could run in parallel.

## 5 — Scope of work under Option A (per new format)

| Area | File(s) | Nature |
|---|---|---|
| Engine | `src/lib/mixLogic.js` | New pairing + per-player standings functions |
| Schema | new `migration_*.sql` | Relax `format` CHECK; add `games.winner_user_id` |
| Finalize | `finalize_mix`, `apply_mix_elo` | Accept a per-player winner |
| Mix page | `src/pages/GameDetails.jsx` | Per-round duplas, per-player table, winner pick |
| Create mix | `src/pages/GerirClube.jsx` | New format option |
| Bot | `whatsapp-bot/src/autostart.js`, `roster.js` | Same pairing rule; roster wording. **Manual redeploy, no CI** |
| Copy | `src/pages/Instructions.jsx`, `pt.json`, `en.json` | Rule text for the new format, both languages |
| Docs | `FEATURES.md` | Same-PR update, per that file's own rule |

## 6 — Open items

- **Scoring unit.** Americano is usually played to a fixed point total per
  round (first to 16/24/32) rather than to games. Does the existing score
  entry fit, or does this format need its own input? Not answerable from the
  code — it depends on how the target group actually plays.
- **Round count.** `totalRounds()` derives rounds from court time ÷ game
  time. Americano rotations usually want a fixed number of rounds so every
  player meets every partner. These may conflict.
- **Odd player counts.** The current engine assumes `2 × courts` teams and no
  byes. Americano groups are commonly 8/12/16, but not always.
- **Which group is testing this**, and do they play pares partidos with
  fixed-point rounds or with games? #102 is a testing card — the format the
  test group actually uses should drive the answers above.

## 7 — Decisão necessária (PT)

Resumo em português, porque quem decide isto não lê código.

**A pergunta do card #102:** entra em desenvolvimento agora, sim ou não?

**O que é preciso saber para responder:**

1. Isto **não é acrescentar uma opção a uma lista**. Hoje a app assume, na
   base de dados, que uma dupla é a mesma do princípio ao fim do mix. Nos
   "pares partidos" o parceiro muda a cada ronda, e isso mexe na peça
   central do motor de jogo.
2. **A boa notícia:** o ranking Elo e as estatísticas já contam por jogador,
   não por dupla. A parte que parecia mais assustadora já está preparada —
   não é preciso mexer no ranking.
3. **A parte que falta mesmo:** hoje quem ganha um mix é uma *dupla*. Nos
   pares partidos quem ganha é uma *pessoa*. Isso não existe em lado nenhum
   e tem de ser criado de raiz.
4. **Não esquecer o bot:** o bot do WhatsApp também arranca mixes sozinho e
   tem uma cópia da lógica das duplas. Qualquer formato novo tem de ser
   feito nos dois sítios, e o bot precisa de ser atualizado à mão no
   servidor — não vai sozinho com o push.

**Três decisões, não uma:**

- **(A)** Os "pares partidos" entram em desenvolvimento agora?
- **(B) — JÁ DECIDIDO (Francisco, 8 set 2026).** Catálogo estruturado de
  formatos prontos, extensível com formatos novos a pedido dos
  utilizadores. Não é um construtor operado pelo admin. Ver §4.
- **(B2) — por confirmar.** O catálogo proposto em §4.2 tem 8 formatos.
  Quais entram, e por que ordem? A sugestão está em §4.5: começar pelo
  "Americano de equipas", que é o mais barato de todos e prova a peça nova
  (vencedor individual) sem mexer em emparelhamentos.
- **(C)** O grupo que vai testar joga pares partidos **a pontos** (primeiro a
  chegar a 16/24/32) ou **a jogos**, como os mixes atuais? Isto muda o ecrã
  de introdução de resultados, e ninguém consegue responder a olhar para o
  código — é preciso perguntar ao grupo.

Sem (A) não há trabalho para fazer. Sem (B) o #37 não pode ser estimado. Sem
(C) corre-se o risco de construir o formato errado e ter de o refazer.
