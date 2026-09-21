# Torneios — Plano técnico (Fase 0)

Escrito pelo **Dev 3** a 21 set 2026, depois da prova de leitura aprovada pelo Francisco.
Fonte: `SPEC.md`, `ATUALIZACOES-21-SET.md`, os 16 prints, `wireframes/torneio.html` (v7) e `CODIGO-EXISTENTE.md`.

**Para validar:** o **Renato** (modelo de dados, RLS, RPCs) e o **Ruben** (as contas do formato e do horário).
**Sem o «sim» dos dois não há código de base de dados** (SPEC §10, Fase 0). O que já existe é só lógica pura, que não
toca em nada: `src/lib/tournamentFormat.js` + `src/lib/tournamentFormat.test.js` (32 testes a passar).

Regra que manda em tudo o que está aqui: **torneio é uma entidade nova. Não é um mix, não reutiliza `games` e não se
mexe no mix.**

---

## 1. O que já está feito (lógica pura, sem base de dados)

`src/lib/tournamentFormat.js` — funções puras, testadas, sem React e sem Supabase:

| Função | O que faz |
|---|---|
| `groupSizes(n, g)` | reparte n duplas por g grupos tão igual quanto possível (18/4 → 5+5+4+4) |
| `possibleGroupCounts(n)` | em quantos grupos se pode repartir, 3 a 7 por grupo, **preferindo grupos iguais** |
| `groupMatchCount`, `groupStageMatchCount`, `guaranteedMatches` | jogos de grupo e jogos garantidos por dupla |
| `knockoutMatchCount`, `knockoutRounds`, `nextPowerOfTwo` | jogos e rondas da eliminatória, com isentos |
| `courtHours`, `availableCourtHours` | tempo de campo preciso (pela duração **máxima**) e disponível |
| `formatOptions`, `recommendFormat` | as opções do assistente, com «cabe / não cabe» e a recomendada |
| `pickSeeds`, `drawGroups`, `seededRandom` | cabeças de série pelos pontos e sorteio repetível |
| `groupRoundRobin` | todos contra todos dentro do grupo |
| `groupStandings`, `headToHeadWins`, `sortWithTiebreak` | classificação com o desempate decidido |
| `bestOfPosition` | melhores terceiros entre grupos de tamanhos diferentes |
| `buildFirstRound`, `noSameGroupClash` | quadro sem juntar duplas do mesmo grupo na 1.ª ronda |

**Números do desenho, verificados por teste** (print 09, 16 duplas, jogos de 60 min):

| Opção | Jogos | Garantidos | Horas | Fases |
|---|---|---|---|---|
| 4 grupos de 4 → quartos (**recomendada**) | 31 | 3 | 31 h | 4 |
| 4 grupos de 4 → meias | 27 | 3 | 27 h | 3 |
| Só eliminatória | 15 | 1 | 15 h | 4 |
| 2 grupos de 8 → meias (só com o máximo em 8) | 59 | 7 | 59 h | 3 |

Tempo disponível do exemplo (sex 20 h + sáb 48 h + dom 27 h) = **95 h**, também verificado.

**Desempate** (decisão do Francisco, 21 set), num só sítio no código — `TIEBREAK_DEFAULT`:
vitórias → confronto direto → diferença de jogos → jogos ganhos.

---

## 2. Modelo de dados proposto — para o Renato

Parte da proposta do SPEC §11, com as decisões de 21 set. Nomes em inglês, como o resto da base de dados.

```
tournaments            id, organization_id, name, slug, location, poster_url,
                       entries_close_at, draw_at, status
                       ('rascunho'|'inscricoes'|'fechado'|'sorteado'|'a_decorrer'|'terminado'),
                       is_public, rules jsonb, organizer_text, created_by, created_at
tournament_days        id, tournament_id, date, starts_at, ends_at, courts
tournament_courts      id, tournament_id, name            -- "Campo 3 · KIA"
tournament_categories  id, tournament_id, code ('M5'), name, gender, level, age_group,
                       slots, price_cents, third_place_match bool, format jsonb, status
tournament_entries     id, category_id, player1_id, player2_id, guest_name, guest_phone_hash,
                       team_name, status ('convite'|'sem_parceiro'|'por_validar'|'validada'
                       |'selecionada'|'suplente'|'desistiu'), waitlist_order, seed_number,
                       created_at, validated_at, validated_by
tournament_groups      id, category_id, number, name       -- "Grupo A"
tournament_group_teams group_id, entry_id
tournament_matches     id, category_id, stage ('grupo'|'principal'|'secundario'|'3lugar'),
                       group_id, round ('R16'|'QF'|'SF'|'F'|'3P'), bracket_slot,
                       entry_a_id, entry_b_id, source_a text, source_b text,
                       scheduled_at, previous_scheduled_at, court_id,
                       duration_min_min, duration_max_min,
                       status ('marcado'|'a_decorrer'|'terminado'|'falta'|'desistencia'),
                       score_a, score_b, sets jsonb, winner_entry_id,
                       walkover_justified bool, started_at, ended_at
tournament_scorekeepers tournament_id, user_id, category_ids uuid[]
tournament_notices     id, tournament_id, body, author_id, created_at, also_whatsapp bool
```

Notas de desenho:

1. **`rules jsonb`** guarda o que o admin escolhe ao criar e não muda por jogo: pontuação, duração mín./máx.,
   chegar antes (20 min), aviso para antecipar (30 min), tolerância (10 min), máximo de jogos seguidos (2), máximo de
   categorias por pessoa (2), como se escolhe quem entra. Assim não são 10 colunas que ninguém consulta em SQL.
2. **`format jsonb`** por categoria: nº de grupos, quantos passam, quadro secundário, melhores terceiros — exatamente
   a opção escolhida no assistente, para se poder repetir o sorteio.
3. **`source_a` / `source_b`** guardam «vencedor do jogo X» ou «2.º do Grupo B» enquanto não se sabe quem é: é o que o
   desenho mostra no quadro e nos cartões («a definir»).
4. **`previous_scheduled_at`** é o «era 17:00» do cartão.
5. **Convidado sem conta**: `guest_name` + `guest_phone_hash` (mesma função de hash do bot, nunca o número em claro).
6. **Não** há coluna de «dupla»: a dupla é a própria `tournament_entries`.

### Segurança (RLS) — a parte que interessa mesmo

| Tabela | Quem lê | Quem escreve |
|---|---|---|
| `tournaments`, `tournament_categories`, `tournament_days`, `tournament_courts` | **qualquer pessoa, mesmo sem sessão**, se `is_public` e `status <> 'rascunho'`; admins do clube sempre | só admins do clube (RPC) |
| `tournament_entries` | público: nome da dupla e nome dos jogadores (decidido a 19 set); **nunca** telemóvel, email nem `guest_phone_hash` | o próprio (inscrever/desistir) e admins; estados só por RPC |
| `tournament_groups`, `tournament_group_teams`, `tournament_matches` | público quando o torneio é público | ninguém direto: só RPC (sorteio, resultado, antecipar) |
| `tournament_scorekeepers` | admins do clube | só admins (RPC) |
| `tournament_notices` | público | admins (RPC); **sem respostas** — não há tabela de comentários |

- A leitura pública é a novidade em relação a tudo o que existe: hoje nada na app se lê sem sessão. Proposta: uma
  **vista** por tabela com só as colunas públicas (`tournament_public_*`), com `GRANT SELECT` a `anon`, em vez de abrir
  as tabelas. Assim não há risco de um `select *` trazer o telemóvel de alguém.
- Pergunta do `CLAUDE.md` da app, aplicada a cada RPC nova: «o que impede alguém de a chamar diretamente, sem passar
  pelo ecrã?» → todas as RPCs abaixo verificam `is_org_admin(...)` ou a pessoa ser dona da inscrição.

### RPCs propostas

| RPC | Quem pode | O que faz |
|---|---|---|
| `create_tournament(...)` | admin do clube | cria torneio, dias, campos e categorias |
| `enter_tournament(category_id, partner_id \| guest, team_name)` | qualquer pessoa com conta | cria a inscrição; **o parceiro tem de aceitar** |
| `respond_tournament_invite(entry_id, accept)` | o parceiro convidado | aceita ou recusa |
| `validate_entry(entry_id)` | admin | marca paga/validada |
| `close_entries(category_id, picks)` | admin | junta os sozinhos, escolhe quem entra, cria suplentes |
| `draw_category(category_id, format, seeds, seed_number)` | admin | cria grupos, jogos e horas — **transação única** |
| `redraw_category(category_id, ...)` | admin | só enquanto **não houver nenhum resultado** |
| `save_match_result(match_id, score_a, score_b, sets)` | admin ou marcador da categoria | grava, recalcula classificação e preenche a fase seguinte |
| `mark_walkover(match_id, kind, justified)` | admin ou marcador | falta ou desistência |
| `reschedule_matches(ids[], new_times[])` | admin | antecipar / começar já, com os avisos |
| `publish_notice(tournament_id, body, also_whatsapp)` | admin | aviso do organizador |

O `draw_category` é o mais delicado: escreve grupos, equipas, jogos e horas de uma vez. Se falhar a meio não pode
deixar meia categoria sorteada — **uma transação só**, e a função recusa se já houver resultados.

### Ligações ao que já existe

- **Ranking**: `apply_elo_pairing` por jogo terminado, a mesma de todo o lado. **Faltas e desistências não contam.**
- **XP**: `xp_events` exige hoje `source_game_id` ou `source_private_match_id` → é preciso **acrescentar
  `source_tournament_match_id`** e alargar a restrição (migração do Renato).
- **Vouchers**: `vouchers.game_id` é `NOT NULL` → mesma coisa, precisa de origem de torneio.
- **Marcadores**: mesma ideia de `game_scorekeepers`, mas por torneio **e categoria**.
- **Avisos**: reaproveitar `notifications` + o sino; WhatsApp pelo bot (redeploy manual).
- **`cancel_stale_open_mixes`** (cron diário, 06:00) **não pode tocar em torneios** — hoje cancela qualquer mix parado
  há 24 h; um torneio de três dias seria cancelado ao terceiro.
- **Home**: `KIND_STYLE.tournament` já está reservado (`EventCard.jsx:38`, lilás `#E9E7FB`), mas **`EVENT_KINDS` em
  `src/lib/agenda.js:19` ainda não tem `tournament`** — é preciso acrescentar para o filtro «Torneios» da Home.

---

## 3. As contas — para o Ruben

As regras que a lógica aplica, todas verificadas por teste:

1. **Grupos** de 3 a 7 duplas, tão iguais quanto possível, **preferindo grupos todos iguais** (16 → 4 grupos de 4).
2. **Quem passa**: 1 ou 2 por grupo, até à potência de 2 seguinte. Se sobrarem lugares, os melhores primeiros passam
   direto (isentos).
3. **Jogos**: grupo de n → n×(n−1)/2; eliminatória → participantes − 1; +1 se houver jogo de 3.º/4.º; quadro
   secundário conta à parte.
4. **Garantidos**: grupo mais pequeno − 1 (é o mínimo que toda a gente tem). Só eliminatória: 1.
5. **Tempo** = jogos × **duração máxima**, comparado com dias × horas × campos.
6. **Recomendada**: a que dá mais jogos garantidos e ainda **cabe com 10% de folga**; empate desfaz-se pela que leva
   mais duplas à eliminatória (é o que o print 09 recomenda). Se nada couber, mostra a mais curta e diz que não cabe.
7. **Cabeças de série** pelos pontos do ranking somados da dupla, uma por grupo; o admin troca antes de sortear.
8. **Quadro**: cruza grupos; nenhum jogo da 1.ª ronda junta duas duplas do mesmo grupo.
9. **Classificação**: vitórias → confronto direto → diferença de jogos → jogos ganhos.

### Suposições minhas — é isto que preciso que confirmem

| # | Suposição | Porquê é preciso decidir |
|---|---|---|
| 1 | **Grupos de 3 a 7** | A SPEC §5 diz «4 a 7», o assistente diz «3 a 7», e o print 09 mostra uma opção de **2 grupos de 8**. Segui 3–7 (o número máximo está num parâmetro). Se o Smash Cup quiser grupos de 8, muda-se num sítio. |
| 2 | **Empate a três ou mais**: o confronto direto conta só entre as empatadas; se continuarem iguais, passa ao critério seguinte | É a regra da Federação e é o que evita voltas infinitas. Sem confirmação, um empate a três no Smash Cup fica à mercê de quem estiver ao computador. |
| 3 | **Melhores terceiros**: comparam-se entre si, ignorando os jogos contra o último classificado dos grupos maiores | Sem isto, o terceiro de um grupo de 5 leva vantagem por ter jogado mais um jogo. |
| 4 | **«Cabe com folga» = sobra 10%** | Com 0% de folga, um atraso de 20 min no sábado à tarde estraga o domingo. |
| 5 | **Isentos**: escolhem-se os melhores primeiros, pela classificação | O desenho só diz «os melhores classificados passam direto». |
| 6 | **Quadro secundário** conta para o tempo de campo | Se não contar, a app diz que cabe e depois não cabe. |

---

## 4. O que falta na Fase 0 (a seguir a este documento)

- **`src/lib/tournamentSchedule.js`** com testes: marcar as horas no sorteio (ninguém em dois jogos à mesma hora,
  nunca 3 seguidos, a fase seguinte só depois de acabada a anterior, hora prevista pela duração máxima) e as contas de
  antecipar (aviso mínimo de 30 min, «começar já»). É a parte do horário que o Ruben também tem de validar.
- Migração do torneio (tabelas, vistas públicas, RLS, RPCs) — **só depois do «sim» do Renato**.

**Ordem das migrações quando chegar a altura:** 1) tabelas + RLS + vistas públicas · 2) RPCs de inscrição e validação ·
3) RPC do sorteio · 4) resultados e ranking (+ `xp_events` e `vouchers` com origem de torneio) · 5) avisos.
Nada vai para `main` antes de a migração correr em produção (regra 5 do plano de ordens).

## 5. O que este plano NÃO faz

Pagamentos na app · liga · quadro de qualificação · troféus de evento · mexer no mix ou no `mixLogic.js`.
