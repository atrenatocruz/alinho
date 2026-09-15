# Cap de dominância + financiamento por derrota inesperada no Elo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um jogador que domina um campo claramente mais fraco deixa de conseguir ganhar mais pontos do que todos os outros no mix — o ganho total do mix (Elo + bónus) passa a ter um teto quando a diferença média para os adversários é grande — e o financiamento do bónus do vencedor deixa de taxar quem tem mais rating no grupo, passando a taxar especificamente quem perdeu contra os premiados, pesado por quão inesperada foi essa derrota.

**Architecture:** Tudo continua no núcleo único já existente em Postgres (`apply_elo_pairing` / `apply_mix_elo`, `supabase/migration_elo_partner_shield.sql`). `apply_elo_pairing` **não muda** — o Elo por-jogo já desconta corretamente pela força do adversário. `apply_mix_elo` tira um snapshot do rating de cada jogador no início do mix (antes de qualquer delta desse mix) e usa-o, dos DOIS lados (o próprio e os adversários), para (a) taxar as derrotas específicas contra os premiados pelo seu `E` nesse jogo, em vez de pelo rating geral do pagador, e (b) aplicar um teto ao ganho total do mix quando a diferença média para os adversários é grande — a média de adversários é calculada diretamente em `apply_mix_elo`, a partir de `_elo_night.rating_before`, dentro do próprio loop de jogos (a mesma técnica já usada no passo de financiamento), não a partir de nada devolvido por `apply_elo_pairing`. Fecha com uma recalibração total do histórico (mesmo padrão de `migration_elo_backfill_v2.sql`).

**Correção de 2026-09-15 (ronda de fix 1/5, Task 1):** a primeira versão deste plano tinha `apply_elo_pairing` a devolver uma coluna extra (`opp_r`) calculada a partir do rating AO VIVO (`v_r_a`/`v_r_b`, que mudam ronda a ronda dentro do próprio mix), para `apply_mix_elo` usar na média de adversários do cap — violando a própria Global Constraint deste plano ("rating no início do mix, não o que vai mudando ronda a ronda"). O implementador que transcreveu a Task 1 apanhou a inconsistência ao comparar com a Global Constraint e reportou DONE_WITH_CONCERNS em vez de "corrigir" por conta própria. Ruling do controlador: remover a mudança a `apply_elo_pairing` por completo (fica exatamente como em `migration_elo_partner_shield.sql`, sem DROP/CREATE) e calcular a média de adversários do cap dentro de `apply_mix_elo`, a partir de `_elo_night.rating_before` — a mesma fonte já usada (corretamente) no passo de financiamento. Isto simplifica a migração (menos uma função a redefinir) e elimina o risco sobre `confirm_private_match`/`migration_elo_backfill_v2.sql` que a mudança de assinatura teria introduzido. O SQL abaixo já reflete a correção.

**Tech Stack:** PL/pgSQL (Postgres/Supabase). Sem ORM nem migration runner neste repo — estes ficheiros só ficam ativos depois de alguém os colar manualmente no SQL Editor do Supabase, por esta ordem: `migration_elo_dominance_cap.sql` primeiro, `migration_elo_backfill_v3.sql` depois.

**Spec:** `docs/superpowers/specs/2026-09-15-fair-pairing-and-dominance-cap-design.md`

## Global Constraints

- Cap por diferença média de rating para os adversários (rating no início do mix, não o que vai mudando ronda a ronda): `< 150` sem teto, `150–300` teto de 15 pontos, `≥ 300` teto de 5 pontos — nunca aplicado ao lado mais fraco nem a quem está a perder.
- Financiamento do bónus: paga quem perdeu especificamente contra um jogador premiado (equipa vencedora do mix / 100% vitórias), pesado pelo `E` que esse jogador já tinha nesse jogo específico (derrota esperada contra um favorito paga ~0; derrota surpreendente paga mais). Se ninguém pagar nada (ninguém perdeu de forma surpreendente contra os premiados), o bónus fica por financiar — aceite, porque o cap já limita esse cenário a valores pequenos.
- Recalibração total do histórico depois da mudança de fórmula — os rankings atuais de todos os clubes vão mudar quando o backfill correr (decisão explícita do Renato, não opcional).
- Nenhuma migração fica ativa só por estar no repositório — tem de ser colada e corrida manualmente no SQL Editor do Supabase, pela ordem indicada acima, com o dry-run da Task 2 feito e revisto antes de correr o backfill da Task 3.

---

### Task 1: `apply_elo_pairing` devolve a força do adversário + `apply_mix_elo` com cap e novo financiamento

**Files:**
- Create: `supabase/migration_elo_dominance_cap.sql`

**Interfaces:**
- Produces: `apply_elo_pairing` mantém-se **inalterado** (mesma assinatura, mesmo `RETURNS TABLE(pid UUID, delta NUMERIC, s NUMERIC)` de sempre) — ver "Correção de 2026-09-15" acima. `apply_mix_elo(p_game_id, p_winner_team_id)` mantém a mesma assinatura e continua a escrever em `profiles.rating`/`rating_games` e `mix_player_stats.rating_delta`/`rating_after`, tal como hoje — só a matemática interna muda.

- [ ] **Step 1: Escrever a migração completa**

Criar `supabase/migration_elo_dominance_cap.sql` com o seguinte conteúdo:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Elo — cap de dominância + financiamento do bónus por derrota inesperada
-- (revisão de 2026-09-15; correr DEPOIS de migration_elo_partner_shield.sql)
--
-- Caso que motivou: mix onde o jogador mais forte (M4 contra um campo de
-- M6) ficou com o maior ganho de pontos do mix, e quem perdeu contra ele
-- (claramente mais fraco, uma derrota esperada e barata no Elo core) pagou
-- a fatia maior do imposto que financia o bónus do vencedor — só porque
-- tinha o rating mais alto entre quem não foi 100% vitórias, não por ter
-- perdido de forma surpreendente contra alguém.
--
-- Duas mudanças, ambas dentro de apply_mix_elo (o Elo por-jogo em
-- apply_elo_pairing NÃO MUDA — já desconta corretamente pela força do
-- adversário via E_a; só o bónus fixo por cima é que não descontava):
--
--   A. CAP no ganho total do mix (Elo + bónus somados), só do lado de quem
--      tem, em média, adversários muito mais fracos nesse mix — nunca do
--      lado de quem está a perder ou a dar a reviravolta:
--        diferença média para os adversários < 150  -> sem teto
--        150-300                                    -> teto de 15 pontos
--        >= 300                                      -> teto de 5 pontos
--      "diferença média" usa o rating de CADA jogador (o próprio E os
--      adversários) no INÍCIO do mix (antes de qualquer delta desse mix),
--      não o que vai mudando ronda a ronda -- por isso apply_mix_elo tira
--      um snapshot logo à entrada (rating_before) e usa-o dos dois lados;
--      a média de adversários é calculada dentro do próprio loop de jogos,
--      a partir desse snapshot, não a partir de nada devolvido por
--      apply_elo_pairing (que continua a usar rating AO VIVO para o Elo em
--      si — correto para o Elo, errado se fosse usado para o cap).
--
--   B. Financiamento do bónus deixa de ser proporcional ao rating do
--      pagador. Passa a ser proporcional a quão inesperada foi a derrota
--      ESPECIFICAMENTE contra os premiados: usa o E que o perdedor já
--      tinha nesse jogo (com os ratings de início de mix, a mesma régua
--      do cap). Perder contra alguém claramente mais forte financia ~0;
--      perder contra alguém a um nível parecido financia mais. Se ninguém
--      perdeu de forma surpreendente contra os premiados, o bónus fica por
--      financiar -- o cap A já limita esse cenário a valores pequenos.
--
-- apply_elo_pairing não precisa de mudar nada para isto: fica exatamente
-- como em migration_elo_partner_shield.sql, sem DROP/CREATE, sem risco
-- para confirm_private_match nem para migration_elo_backfill_v2.sql.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a NUMERIC;
  v_had_matches BOOLEAN := FALSE;
  v_bonus_total NUMERIC;
  v_weight_sum NUMERIC;
  v_a_rating_before NUMERIC;
  v_b_rating_before NUMERIC;
  v_e_a_before NUMERIC;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _elo_night (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0,
    rating_before NUMERIC,
    opp_r_sum NUMERIC NOT NULL DEFAULT 0,
    surprise_weight NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_night;

  -- Snapshot do rating de cada jogador ANTES de qualquer delta deste mix —
  -- a régua usada pelo cap (gap contra a média dos adversários) e pelo
  -- financiamento (E de cada derrota), para não se mexerem sozinhos à
  -- medida que as rondas do próprio mix vão correndo.
  INSERT INTO _elo_night (pid, rating_before)
  SELECT DISTINCT pid, COALESCE(pr.rating, 900)
  FROM (
    SELECT player1_id AS pid FROM teams WHERE game_id = p_game_id
    UNION
    SELECT player2_id FROM teams WHERE game_id = p_game_id
  ) t
  JOIN profiles pr ON pr.id = t.pid
  ON CONFLICT (pid) DO NOTHING;

  FOR m IN
    SELECT mt.score_a, mt.score_b, mt.winner_team_id, mt.team_a_id,
           ta.player1_id AS a1, ta.player2_id AS a2,
           tb.player1_id AS b1, tb.player2_id AS b2
    FROM matches mt
    JOIN teams ta ON ta.id = mt.team_a_id
    JOIN teams tb ON tb.id = mt.team_b_id
    WHERE mt.game_id = p_game_id
      AND mt.winner_team_id IS NOT NULL
    ORDER BY mt.round_number NULLS LAST, mt.created_at, mt.id
  LOOP
    v_had_matches := TRUE;

    v_s_a := CASE
      WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
      WHEN m.winner_team_id = m.team_a_id THEN 1
      ELSE 0
    END;

    -- Ratings de início de mix das duas duplas deste jogo — a régua do cap
    -- (média de adversários), não o rating ao vivo que apply_elo_pairing já
    -- vai ter mexido para outros jogadores nesta mesma ronda.
    SELECT AVG(rating_before) INTO v_a_rating_before FROM _elo_night WHERE pid IN (m.a1, m.a2);
    SELECT AVG(rating_before) INTO v_b_rating_before FROM _elo_night WHERE pid IN (m.b1, m.b2);

    FOR pl IN
      SELECT * FROM apply_elo_pairing(m.a1, m.a2, m.b1, m.b2, v_s_a, p_partner_chosen => FALSE)
    LOOP
      INSERT INTO _elo_night (pid, delta, played, won, opp_r_sum)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END,
              CASE WHEN pl.pid IN (m.a1, m.a2) THEN v_b_rating_before ELSE v_a_rating_before END)
      ON CONFLICT (pid) DO UPDATE
      SET delta = _elo_night.delta + EXCLUDED.delta,
          played = _elo_night.played + 1,
          won = _elo_night.won + EXCLUDED.won,
          opp_r_sum = _elo_night.opp_r_sum + EXCLUDED.opp_r_sum;
    END LOOP;
  END LOOP;

  IF v_had_matches THEN
    IF p_winner_team_id IS NOT NULL THEN
      -- Recompensa (inalterada): +1% do próprio rating por estar na equipa
      -- vencedora do mix, +0,5% extra por 100% de vitórias.
      UPDATE _elo_night n
      SET bonus = (CASE WHEN n.pid IN (SELECT unnest(ARRAY[player1_id, player2_id])
                                       FROM teams WHERE id = p_winner_team_id)
                        THEN 0.01 ELSE 0 END
                 + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
                * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900)
      WHERE TRUE;

      -- Financiamento novo: paga quem perdeu ESPECIFICAMENTE contra um
      -- premiado, pesado pelo E que já tinha nesse jogo (ratings de início
      -- de mix) — não mais "quem tem mais rating no grupo".
      FOR m IN
        SELECT mt.winner_team_id, mt.team_a_id, mt.team_b_id,
               ta.player1_id AS a1, ta.player2_id AS a2,
               tb.player1_id AS b1, tb.player2_id AS b2
        FROM matches mt
        JOIN teams ta ON ta.id = mt.team_a_id
        JOIN teams tb ON tb.id = mt.team_b_id
        WHERE mt.game_id = p_game_id AND mt.winner_team_id IS NOT NULL
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM _elo_night n
          WHERE n.bonus > 0
            AND n.pid = ANY(CASE WHEN m.winner_team_id = m.team_a_id
                                  THEN ARRAY[m.a1, m.a2] ELSE ARRAY[m.b1, m.b2] END)
        ) THEN
          CONTINUE;
        END IF;

        SELECT AVG(rating_before) INTO v_a_rating_before FROM _elo_night WHERE pid IN (m.a1, m.a2);
        SELECT AVG(rating_before) INTO v_b_rating_before FROM _elo_night WHERE pid IN (m.b1, m.b2);
        v_e_a_before := 1 / (1 + power(10::numeric, (v_b_rating_before - v_a_rating_before) / 400));

        IF m.winner_team_id = m.team_a_id THEN
          UPDATE _elo_night SET surprise_weight = surprise_weight + (1 - v_e_a_before)
          WHERE pid IN (m.b1, m.b2);
        ELSE
          UPDATE _elo_night SET surprise_weight = surprise_weight + v_e_a_before
          WHERE pid IN (m.a1, m.a2);
        END IF;
      END LOOP;

      SELECT COALESCE(SUM(bonus), 0) INTO v_bonus_total FROM _elo_night WHERE bonus > 0;
      SELECT COALESCE(SUM(surprise_weight), 0) INTO v_weight_sum FROM _elo_night WHERE bonus = 0;

      IF v_bonus_total > 0 AND v_weight_sum > 0 THEN
        UPDATE _elo_night
        SET bonus = - v_bonus_total * surprise_weight / v_weight_sum
        WHERE bonus = 0 AND surprise_weight > 0;
      END IF;
      -- Se v_weight_sum = 0 (ninguém perdeu de forma surpreendente contra
      -- os premiados), o bónus fica por financiar — aceite, ver cabeçalho.
    END IF;

    -- Cap de dominância: só do lado de quem ganhou por ter, em média,
    -- adversários muito mais fracos nesse mix — nunca no lado do azarão
    -- nem de quem está a perder.
    UPDATE _elo_night n
    SET bonus = bonus + LEAST(0,
          (CASE WHEN g.gap >= 300 THEN 5 WHEN g.gap >= 150 THEN 15 END) - (n.delta + n.bonus))
    FROM (
      SELECT pid, (rating_before - opp_r_sum / NULLIF(played, 0)) AS gap
      FROM _elo_night WHERE played > 0
    ) g
    WHERE g.pid = n.pid
      AND g.gap >= 150
      AND (n.delta + n.bonus) > 0;

    UPDATE _elo_night SET delta = delta + bonus WHERE bonus <> 0;

    UPDATE profiles pr
    SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus)
    FROM _elo_night n
    WHERE pr.id = n.pid AND n.bonus <> 0;
  END IF;

  UPDATE mix_player_stats mps
  SET rating_delta = ROUND(n.delta, 2),
      rating_after = ROUND(COALESCE(pr.rating, 900), 2)
  FROM _elo_night n
  JOIN profiles pr ON pr.id = n.pid
  WHERE mps.game_id = p_game_id AND mps.user_id = n.pid AND n.played > 0;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION apply_mix_elo(UUID, UUID) FROM public, anon, authenticated;
```

- [ ] **Step 2: Dry-run manual no SQL Editor do Supabase (sem tocar em dados a sério)**

Esta função só existe depois de a migração acima ser colada e corrida no SQL Editor — não há Postgres local neste repo, por isso não há forma de a testar sem isso. Antes de sequer pensar em correr o backfill (Task 2 do plano seguinte), validar assim:

1. Colar e correr o conteúdo do Step 1 no SQL Editor do Supabase (ambiente de desenvolvimento/staging do projeto, não direto em produção, se existir um).
2. Escolher o `game_id` de um mix já finalizado que se pareça com o caso do Renato (um jogador claramente mais forte que dominou o resto) — por exemplo:

```sql
SELECT id, date, organization_id, winner_team_id
FROM games
WHERE status = 'finished'
ORDER BY date DESC
LIMIT 20;
```

3. Correr o dry-run dentro de uma transação que nunca é confirmada:

```sql
BEGIN;

-- Antes: ratings atuais dos jogadores desse mix, para comparar depois.
SELECT p.id, p.name, p.rating
FROM profiles p
JOIN mix_player_stats mps ON mps.user_id = p.id
WHERE mps.game_id = '<game_id escolhido acima>';

SELECT apply_mix_elo('<game_id escolhido acima>', (SELECT winner_team_id FROM games WHERE id = '<game_id escolhido acima>'));

-- Depois: confirmar que quem tinha rating claramente mais alto que a média
-- dos adversários ficou com um ganho pequeno (≤15, ou ≤5 se a diferença
-- era grande), e que ninguém que perdeu contra um favorito muito mais
-- forte pagou uma fatia grande do financiamento do bónus.
SELECT mps.user_id, p.name, mps.rating_delta, mps.rating_after
FROM mix_player_stats mps
JOIN profiles p ON p.id = mps.user_id
WHERE mps.game_id = '<game_id escolhido acima>'
ORDER BY mps.rating_delta DESC;

ROLLBACK; -- crítico: isto é só para validar a fórmula, não para aplicar a sério
```

4. Confirmar visualmente que os números batem certo com a spec (tabela "Efeito esperado") antes de avançar para o plano do backfill. Se os números não baterem, corrigir a função no Step 1 e repetir o dry-run — nunca avançar para o backfill com dúvidas sobre a fórmula.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_elo_dominance_cap.sql
git commit -m "feat(elo): cap de dominancia + financiamento do bonus por derrota inesperada"
```

---

### Task 2: Recalibração total do histórico

**Files:**
- Create: `supabase/migration_elo_backfill_v3.sql`

**Interfaces:**
- Consumes: `apply_mix_elo` já redefinido pela Task 1 (`apply_elo_pairing` não muda, ver Task 1) — esta migração não muda a lógica, só repete o replay cronológico completo (mesmo padrão de `migration_elo_backfill_v2.sql`) para que o histórico todo passe a refletir o cap e o novo financiamento.

- [ ] **Step 1: Escrever a migração de recalibração**

Criar `supabase/migration_elo_backfill_v3.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════
-- Elo — recalibração total v3 (correr DEPOIS de migration_elo_dominance_cap.sql)
--
-- Re-replay do histórico COMPLETO com o cap de dominância + o novo
-- financiamento do bónus (derrota inesperada contra o premiado, não mais
-- rating do pagador) — ver migration_elo_dominance_cap.sql e a spec
-- docs/superpowers/specs/2026-09-15-fair-pairing-and-dominance-cap-design.md.
--
-- Mesmo mecanismo do v2: reset às âncoras + re-replay cronológico,
-- intercalando mixes finished e amigáveis confirmados. Quem escolheu
-- âncora no onboarding mantém-na; os restantes ficam na âncora 900. O XP
-- não é tocado (sistema separado e aditivo).
-- Re-corrível: reset + replay completo.
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  ev RECORD;
  pm private_matches;
  pl RECORD;
  n_mixes INTEGER := 0;
  n_friendlies INTEGER := 0;
BEGIN
  UPDATE profiles
  SET rating_anchor = COALESCE(rating_anchor, 900),
      rating = COALESCE(rating_anchor, 900),
      rating_games = 0
  WHERE TRUE;

  UPDATE mix_player_stats SET rating_delta = NULL, rating_after = NULL WHERE TRUE;
  UPDATE private_match_stats SET rating_delta = NULL, rating_after = NULL WHERE TRUE;

  FOR ev IN
    SELECT 'mix'::text AS kind, g.id, g.winner_team_id,
           g.date AS happened_at, f.finalized_at AS tiebreak
    FROM games g
    LEFT JOIN LATERAL (
      SELECT MIN(created_at) AS finalized_at FROM mix_player_stats WHERE game_id = g.id
    ) f ON TRUE
    WHERE g.status = 'finished'
    UNION ALL
    SELECT 'friendly', p.id, NULL::uuid, p.confirmed_at, p.confirmed_at
    FROM private_matches p
    WHERE p.status = 'confirmed'
    ORDER BY happened_at, tiebreak NULLS LAST, id
  LOOP
    IF ev.kind = 'mix' THEN
      PERFORM apply_mix_elo(ev.id, ev.winner_team_id);
      n_mixes := n_mixes + 1;
    ELSE
      SELECT * INTO pm FROM private_matches WHERE id = ev.id;
      IF pm.winner_team IS NULL THEN
        CONTINUE;
      END IF;
      FOR pl IN
        SELECT * FROM apply_elo_pairing(
          pm.team_a_player1_id, pm.team_a_player2_id,
          pm.team_b_player1_id, pm.team_b_player2_id,
          CASE WHEN pm.winner_team = 'a' THEN 1 ELSE 0 END
        )
      LOOP
        UPDATE private_match_stats
        SET rating_delta = ROUND(pl.delta, 2),
            rating_after = ROUND((SELECT COALESCE(pr.rating, 900) FROM profiles pr WHERE pr.id = pl.pid), 2)
        WHERE private_match_id = pm.id AND user_id = pl.pid;
      END LOOP;
      n_friendlies := n_friendlies + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Recalibração v3: % mixes + % amigáveis reproduzidos', n_mixes, n_friendlies;
END $$;

-- Conferência: top-30 recalculado, para comparar com o top-30 anterior
-- (correr a mesma query antes de aplicar esta migração e guardar o
-- resultado para comparação, já que isto muda os rankings de todos os
-- clubes).
SELECT ROW_NUMBER() OVER (ORDER BY p.rating DESC) AS pos,
       p.name, ROUND(p.rating) AS pts, p.rating_games
FROM profiles p
WHERE p.rating_games > 0
ORDER BY p.rating DESC
LIMIT 30;
```

- [ ] **Step 2: Instruções de execução (manual, fora deste ambiente)**

Este ficheiro só deve ser corrido pelo Renato (ou por quem tiver acesso ao SQL Editor do Supabase do projeto a sério), depois de:
1. A Task 1 (migração + dry-run) estar colada e validada no ambiente correto.
2. Guardar o resultado da query de top-30 (mesma forma, sem o cap/financiamento novo) **antes** de correr este backfill, para poder comparar depois e confirmar que a mudança nos rankings faz sentido (ninguém deve subir/descer de forma bizarra fora dos casos discutidos na spec).
3. Colar e correr `migration_elo_backfill_v3.sql` no SQL Editor.
4. Comparar o top-30 novo com o guardado no passo 2 e confirmar visualmente que os jogadores dominantes contra campos fracos (como o Renato no caso que motivou isto) desceram para os valores esperados, e que quem perdia contra favoritos claros deixou de pagar tanto.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration_elo_backfill_v3.sql
git commit -m "feat(elo): recalibracao total v3 com o cap de dominancia e o novo financiamento"
```
