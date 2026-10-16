# Liga entre Clubes — Design (Fase 1 detalhada, Fases 2–4 em esboço)

Escrito a 16 out 2026 a partir do prompt «Liga entre Clubes | Alinho» e da análise do código existente.
Mockups: https://claude.ai/artifact/6nJGNezXkoQxU4B2dDLjqx (um bloco por fase).

**Para validar:** Francisco (produto, nomes, regras por omissão) e Renato (modelo de dados, RLS, RPCs).
Sem esse «sim» não há migração — mesmo processo da Fase 0 dos torneios
(`2026-09-21-torneios-plano-tecnico.md`).

## Decisões já tomadas (Renato, 16 out 2026)

| # | Decisão |
|---|---|
| 1 | Os jogos da liga **contam para o Elo global e para o ranking «Por Clube»** (via `apply_elo_pairing`, como mix, torneio e jogo de grupo). |
| 2 | O objetivo é **escalar** (regional → nacional), não só servir os clubes do piloto. |
| 3 | As ligas criadas pela plataforma chamam-se **«Liga Alinho»**, nunca «Oficial» — evita confusão com a Federação e cumpre a regra de não inventar sinais de confiança. |
| 4 | Entrega **por fases**: 1) liga por jornadas · 2) playoffs · 3) desafios · 4) torneio interclubes. |

## Regra que manda em tudo

Igual aos torneios: **a liga é uma entidade nova.** Não é um mix, não reutiliza `games`, não reutiliza
`tournament_*`. Reaproveita o **núcleo comum**: `apply_elo_pairing`, `xp_events`, `notifications` (sino),
`check_and_award_achievements`, `is_org_admin`, `is_platform_admin`, o padrão de vistas públicas para leitura sem
sessão, e o padrão de confirmação cruzada de `confirm_private_match`.

## Vocabulário (para a UI — confirmar com o Francisco)

| Termo | Significa |
|---|---|
| **Liga** | a competição (ex.: «Liga Alinho Lisboa 2027») |
| **Categoria** | divisão dentro da liga (M4, F4, MX4) — cada uma tem a sua tabela |
| **Equipa** | a participação de um clube numa categoria |
| **Plantel** | os jogadores inscritos por uma equipa |
| **Jornada** | ronda com janela de datas |
| **Encontro** | clube contra clube numa jornada (pode ter várias partidas) |
| **Partida** | uma dupla contra outra dupla, dentro de um encontro |

«Encontro/partida» em vez de «eliminatória/jogo» porque «jogos» já quer dizer games dentro de um set em toda a app.

---

## Fase 1 — Liga por jornadas

### O que entra

1. Criar liga **comunitária** (admin de um clube, `kind='club'`) ou **Liga Alinho** (só `is_platform_admin`).
2. Categorias com género (M / F / MX) e intervalo de Elo.
3. Descoberta **na Home**, não num separador próprio nem no Ranking (Renato, 16 out): o tipo `league` já está
   reservado no redesign (`KIND_COLORS.league` rosa `#BE185D`, `topo-liga.webp`, `agenda.kind_league`). Cada
   encontro em que estás escalado é um cartão da Home (`HomeCard`) no dia dele; as ligas com inscrições abertas
   perto de ti aparecem em «Para ti»; o filtro «Liga» da Home mostra tudo. A página pública da liga (link
   partilhável, legível sem sessão) é uma página de evento com `EventHero`.
4. Candidatura do clube por categoria → pendente → aprovada / rejeitada / suplente / retirada.
5. Plantel por equipa, com nível congelado à entrada.
6. Calendário gerado (todos contra todos; **casa e fora** opcional), jornadas com janela de datas.
7. Marcação: o clube da casa propõe data, hora e campo; o outro aceita ou propõe outra.
8. Resultado: um lado submete → o outro confirma ou contesta → organizador resolve.
9. Classificação ao vivo / final, calculada só a partir de encontros oficiais.
10. Co-organizadores.
11. Avisos no sino.

### O que NÃO entra na Fase 1

Playoffs, desafios, torneio interclubes, WhatsApp, mais de uma equipa do mesmo clube na mesma categoria,
datas automáticas por disponibilidade de campos.

### Papéis

| Papel | Quem é | Pode |
|---|---|---|
| **Dono** | Liga comunitária: admins do clube criador. Liga Alinho: admins da plataforma. | tudo, incluindo co-organizadores e apagar |
| **Co-organizador** | utilizador nomeado pelo dono (`league_organizers`) | tudo menos nomear/remover organizadores, apagar a liga, mudar o tipo |
| **Representante** | admin do clube participante, ou capitão nomeado por ele | candidatura, plantel, escalação, marcação, submeter/confirmar/contestar **pelo seu lado** |
| **Jogador** | está num plantel | ver a liga, ver os seus encontros |
| **Público** | qualquer pessoa, mesmo sem sessão | ver ligas publicadas, categorias, equipas, calendário, classificação |

Sem permissões granulares por agora — dois níveis de organizador chegam (mesma lógica dos marcadores de torneio).

### Modelo de dados proposto

```
leagues               id, slug, name, kind ('comunitaria'|'alinho'), owner_org_id (NULL na Liga Alinho),
                      scope ('local'|'regional'|'nacional'), district, season_label, description,
                      status ('rascunho'|'inscricoes'|'a_decorrer'|'terminada'|'cancelada'),
                      applications_close_at, max_teams_per_category, created_by, created_at
league_organizers     league_id, user_id, added_by, created_at          -- co-organizadores
league_categories     id, league_id, code ('M4'), gender ('M'|'F'|'MX'), min_rating, max_rating,
                      matches_per_encounter (1|2|3|5), home_away bool,
                      points_win, points_draw, points_loss, tiebreak text[], rating_tolerance,
                      status ('inscricoes'|'calendario'|'a_decorrer'|'terminada')
league_teams          id, category_id, organization_id, name,
                      status ('pendente'|'aprovada'|'rejeitada'|'retirada'|'suplente'),
                      applied_by, decided_by, decided_at, reject_reason, waitlist_order
league_captains       team_id, user_id                                  -- representantes além dos admins
league_roster         id, league_id, team_id, user_id, rating_at_entry, added_at, removed_at
league_rounds         id, category_id, number, window_start, window_end
league_encounters     id, round_id, home_team_id, away_team_id,
                      scheduled_at, venue_text, proposed_by_team_id, proposed_at,
                      status ('por_marcar'|'proposto'|'marcado'|'submetido'|'contestado'|'oficial'|'cancelado'),
                      submitted_by, submitted_by_team_id, submitted_at,
                      confirmed_by, confirmed_at, contested_by, contested_at, contest_reason,
                      resolved_by, resolved_at, resolution_note
league_matches        id, encounter_id, slot (1..N), home_p1, home_p2, away_p1, away_p2,
                      sets jsonb, winner ('home'|'away'|NULL), walkover ('home'|'away'|NULL)
league_events         id, league_id, encounter_id, actor_id, kind, payload jsonb, created_at  -- append-only
organizations         + district text   -- 18 distritos + Açores + Madeira
xp_events / vouchers  origem generalizada (ver «Ligações»)
```

Notas:

1. **Um jogador, um clube por liga:** `UNIQUE (league_id, user_id) WHERE removed_at IS NULL` em `league_roster`.
   Necessário porque uma pessoa pode ser membro de vários clubes.
2. **Nível congelado:** `rating_at_entry` é o Elo no momento em que entra no plantel; a elegibilidade usa esse
   valor (± `rating_tolerance`), não o Elo atual. Assim ninguém fica inelegível a meio da época por ter ganho.
3. **MX:** a dupla tem de ter um homem e uma mulher (reaproveita a regra `'misto'` de `genderCheck.js`);
   o nível da dupla mista = média dos dois, como no resto da app.
4. **«Em atraso» não é estado gravado:** é `window_end < now() AND status NOT IN ('oficial','cancelado')`,
   calculado na leitura. Um job `pg_cron` diário só envia avisos.
5. **Classificação não é guardada.** Uma função `league_standings(category_id)` calcula-a a partir de
   `league_encounters` com `status='oficial'`. Corrigir um resultado nunca deixa pontos duplicados.
6. Resultado do encontro = maioria de partidas; com nº par de partidas pode haver empate (usa `points_draw`).

### Estados e transições (todas por RPC)

```
Equipa:     pendente ─aprovar→ aprovada | ─rejeitar→ rejeitada | ─lotação→ suplente
            pendente/suplente/aprovada (antes do calendário) ─retirar→ retirada
Encontro:   por_marcar ─propor→ proposto ─aceitar→ marcado
            proposto ─contrapropor→ proposto (do outro lado)
            marcado/por_marcar ─submeter resultado→ submetido
            submetido ─confirmar (só o OUTRO lado)→ oficial
            submetido ─contestar (só o OUTRO lado)→ contestado ─organizador resolve→ oficial
            oficial ─organizador corrige→ oficial (reverte Elo/XP e reaplica; fica em league_events)
```

### Classificação

- Pontos por omissão: vitória 3 · empate 1 · derrota 0 · falta de comparência −1 (configurável por categoria).
- Desempate por omissão, por esta ordem: pontos → confronto direto → diferença de partidas → diferença de sets →
  diferença de jogos → sorteio determinístico (hash de `league_id || team_id`, para dar sempre o mesmo resultado).
- Empate a três ou mais: o confronto direto conta só entre as empatadas (igual à suposição 2 dos torneios).
- Lógica pura espelhada em `src/lib/leagueStandings.js` (testes vitest), mas **a fonte oficial é a função SQL**;
  o teste compara as duas sobre os mesmos dados.

### Segurança (RLS)

| Tabela | Quem lê | Quem escreve |
|---|---|---|
| `leagues`, `league_categories`, `league_rounds` | qualquer pessoa (vista pública) se `status <> 'rascunho'`; organizadores sempre | só RPC |
| `league_teams` | público: clube, nome, estado aprovado; organizadores e o próprio clube veem candidaturas | só RPC |
| `league_roster` | público: nome e banda; **nunca** email/telefone/Elo exato | só RPC (representante do clube) |
| `league_encounters`, `league_matches` | público quando a liga é pública | só RPC |
| `league_organizers`, `league_captains` | organizadores / clube | só RPC (dono) |
| `league_events` | organizadores | só triggers/RPC |

Verificações-chave nas RPCs:
- `create_league(kind='alinho')` recusa se `NOT is_platform_admin()`. `kind` nunca muda depois de criada.
- Co-organizador não pode chamar `add_league_organizer` nem `delete_league`.
- `confirm_encounter` / `contest_encounter`: `auth.uid()` tem de representar a equipa **que não submeteu**.
  O dono de uma liga que também joga nela continua sujeito a esta regra para o seu próprio clube.
- `set_encounter_lineup`: cada jogador tem de estar no plantel **daquela** equipa e ser elegível pela regra de género.
- Candidatura concorrente: `UNIQUE (category_id, organization_id)` + `SELECT … FOR UPDATE` na categoria para a
  lotação, para dois pedidos simultâneos não passarem ambos o limite.

### RPCs propostas

| RPC | Quem | Faz |
|---|---|---|
| `create_league`, `update_league`, `publish_league`, `delete_league` | dono / co-org (delete: só dono) | ciclo de vida |
| `upsert_league_category` | org | categorias e regras, validadas no servidor |
| `add_league_organizer`, `remove_league_organizer` | dono | co-organizadores |
| `apply_to_league`, `withdraw_application` | representante | candidatura |
| `decide_application(team_id, decision, reason)` | org | aprovar / rejeitar / suplente |
| `set_league_captain` | admin do clube | capitães |
| `add_to_roster`, `remove_from_roster` | representante | plantel (bloqueado a partir da jornada N, configurável) |
| `generate_league_schedule(category_id, rounds_windows)` | org | jornadas + encontros, numa transação; recusa se houver resultados |
| `propose_encounter_time`, `accept_encounter_time` | representante | marcação |
| `submit_encounter_result(encounter_id, matches)` | representante | duplas + sets de cada partida |
| `confirm_encounter_result`, `contest_encounter_result(reason)` | representante do outro lado | |
| `resolve_encounter(encounter_id, matches, note)` | org | resolve contestação ou corrige |
| `get_league_page(slug)`, `list_public_leagues(filters)`, `league_standings(category_id)` | público | leitura |

### Ligações ao que já existe

- **Elo:** `apply_elo_pairing` por partida quando o encontro passa a `oficial`; correção = reverte e reaplica
  (padrão de `migration_group_matches.sql`). Faltas de comparência não contam para o Elo.
- **Ranking «Por Clube»:** `player_stats` do clube **que o jogador representa** naquela liga.
- **XP:** é a terceira vez que `xp_events` precisa de uma origem nova (mix, jogo entre amigos, torneio). Proposta:
  trocar as colunas `source_*` por `source_kind text` + `source_id uuid` com `UNIQUE (user_id, source_kind, source_id, reason)`.
  Migração do Renato — decidir se vale fazer já ou só acrescentar `source_league_match_id`.
- **Sino:** novos tipos em `notifications` — candidatura recebida / decidida, proposta de horário, resultado por
  confirmar, contestado, resolvido, prazo da jornada a acabar.
- **`cancel_stale_open_mixes`:** não toca nas ligas, por serem outra tabela; confirmar quando a migração estiver escrita.
- **Home / agenda:** acrescentar `'league'` a `EVENT_KINDS` (`src/lib/agenda.js`). Cor, ícone, capa e texto
  já existem. Um `LeagueEventCard` em `HomeCard`, como o `TournamentEventCard`: antes de haver encontro é o cartão
  da liga, e depois há um cartão por encontro meu. «Precisa de ti» (`NeedsYou`) serve para «confirma o resultado».
- **Navegação:** sem separador novo e sem nada no Ranking. Organizar e gerir as equipas do clube faz-se no Gerir
  («+ Criar → Liga», como o torneio). A página da liga e a do encontro usam `EventHero` com `kind="league"`.
- **Desenho:** o do `dev` a 16 out (R0–R12b). Mockups no canvas, atualizados para esse desenho.

### Testes

- vitest: `leagueSchedule.js` (todos contra todos, casa e fora, nº ímpar de equipas → folga), `leagueStandings.js`
  (pontos, desempates, empate a 3), `leagueEligibility.js` (género, nível congelado, um clube por liga),
  `leagueConfig.js` (combinações inválidas).
- SQL em `supabase/tests/`, corrido na alinho-dev: criar Liga Alinho sem ser platform admin (falha), co-org a
  promover-se (falha), clube A a mexer no plantel do B (falha), confirmar o próprio resultado (falha), anon a ler
  telefone/email (nada), ciclo completo com contestação e correção a verificar a tabela e o Elo.
- Não há framework E2E na app — o ciclo completo é verificado pelo script SQL e à mão na alinho-dev.

---

## Fase 2 — Playoffs (esboço)

`league_categories.playoff_teams` (0 = acaba pela tabela, 2/4/8). Ao fechar a fase regular, os N primeiros
entram num quadro. Reaproveita **`buildFirstRound`, `treeLayout.js` e `BracketTree.jsx`** dos torneios
(lógica pura, sem tocar nas tabelas de torneio). Encontros de playoff = `league_encounters` com `stage='playoff'`
e `bracket_slot`, mesmo fluxo de resultado. Sem campeão automático enquanto houver encontros por oficializar.

## Fase 3 — Desafios (esboço)

`league_categories.format = 'desafios'`: sem calendário gerado. Um representante desafia outro clube da
categoria dentro de uma janela; o desafiado aceita/recusa; a partir daí é um `league_encounter` normal.
Regras do organizador: nº máximo de desafios por clube, prazo para responder, não repetir o mesmo adversário.

## Fase 4 — Torneio interclubes (esboço)

Um torneio normal (`tournaments`) com `league_id` opcional e `representing_org_id` em `tournament_entries`.
A classificação por clube soma pontos por posição final de cada dupla. Nada de segundo motor de torneios.

## Perguntas abertas para o Francisco

1. «Encontro / partida» como vocabulário?
2. Pontos por omissão (3/1/0, −1 por falta)?
3. A partir de que jornada o plantel fecha?
4. Um clube pode ter duas equipas na mesma categoria (A e B)? Proposta: não na Fase 1.

## Estado (16 out 2026, fim da implementação da Fase 1)

- Fase 1 implementada no branch `feature/liga-entre-clubes` (worktree `padeleirosrobot-liga`), sem push. Plano: `docs/superpowers/plans/2026-10-16-liga-entre-clubes-fase1.md`.
- **Migrações `migration_liga_1` a `6` — correr por esta ordem na alinho-dev; em produção só quando a Fase 1 for para `main`.** Testadas numa base local descartável com um esqueleto do esquema; nenhuma correu ainda num projeto Supabase.
  - Antes da 5: ver o check atual de `xp_events.kind` na dev e em produção (a 5 reescreve-o com a lista mix/friendly/kudos + `league_match`, `league_win`).
  - Antes da 6: `pg_cron` ativo (Database → Extensions) — o lembrete de prazo é um trabalho diário.
  - Os testes `supabase/tests/liga_*.sql` têm marcadores `<…>` para preencher com ids da dev.
- Desvios ao desenho acima, decididos durante o plano e a implementação:
  - a tabela calcula-se em JS só a partir dos encontros oficiais devolvidos pelo servidor (não há `league_standings` em SQL);
  - o calendário calcula-se em JS e o servidor valida-o (sem tabela temporária);
  - nível por `level` + `rating_tolerance` (em vez de `min_rating`/`max_rating`);
  - XP com coluna `source_league_match_id` (sem generalizar `xp_events`), e soma também em `profiles.xp`; o XP nunca se retira numa correção;
  - um organizador que fala por um dos clubes não decide esse encontro (`conflict_of_interest`) — uma liga comunitária em que o clube dono joga precisa de um co-organizador neutro para as disputas desse clube;
  - retirar o pedido fecha o plantel do clube e avisa quem organiza;
  - todas as funções com `SET search_path = public, pg_temp`;
  - a nota da decisão e a lista de organizadores só aparecem a quem está dentro / organiza.
- As perguntas ao Francisco continuam abertas; a implementação usa os valores por omissão acima (todos configuráveis por categoria).
