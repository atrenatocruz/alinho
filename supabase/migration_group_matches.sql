-- ════════════════════════════════════════════════════════════════════════
-- "Jogo" dentro do grupo/clube: 2x2 simples, criado por qualquer membro
-- (Trello #239 — pedido do Rui). SISTEMA À PARTE de private_matches
-- ("jogo entre amigos" do perfil, #233) — não estende nem referencia essa
-- tabela. Reaproveita a MESMA MECÂNICA desenhada para "jogo em aberto"
-- (#236, docs/superpowers/specs/2026-09-10-jogo-em-aberto-clube-design.md),
-- adaptada para ser lançado por qualquer membro em vez de só o admin
-- (decisão de Francisco, 11 set 2026 — ver [[francisco-confirm-before-
-- coding-multipart-features]] no histórico do projeto).
--
-- Regras (do design #236, com a alteração de quem cria):
-- 1. Qualquer membro do grupo cria, escolhe ranked/amigável e convida
--    colegas do MESMO grupo para os outros 3 lugares (nunca alguém de
--    fora — ao contrário do jogo entre amigos, aqui não há nomes sem
--    conta nem jogadores fora do grupo).
-- 2. Entrar = aceitar ficar registado, mas qualquer participante pode
--    sair a qualquer momento ATÉ o resultado ser inserido. Depois disso
--    fica trancado (locked_at).
-- 3. Correção do resultado por "democracia": qualquer participante pode
--    propor, só se aplica se TODOS os 4 aceitarem.
-- 4. Exceção: se foi um admin do grupo a inserir o resultado, só um admin
--    o pode corrigir depois — sem votação.
-- 5. Cancelar participação ≠ eliminar o jogo inteiro (isso continua a ser
--    exclusivo de quem criou ou de um admin).
--
-- Fora de âmbito nesta primeira versão (registar para decidir depois):
-- inscrição por WhatsApp (só app, por agora — confirmado por Francisco,
-- 11 set 2026) e motor de torneios (totalmente separado, não reaproveitado
-- aqui).
--
-- Ranking/estatísticas (decisão de Francisco, 11 set 2026, verbatim): "sim
-- mexe. Se for dentro do grupo mesmo que duas duplas tenham jogado os
-- pontos mexem. Mas tem de ser com malta que pertencem aquele grupo." —
-- um jogo ranked alimenta o MESMO player_stats (organization_id-scoped,
-- usado pelo separador "Por Clube" em Rankings.jsx) e o MESMO rating
-- global (profiles.rating, via apply_elo_pairing) que um mix ou um jogo
-- entre amigos ranked já alimentam — sem tabela nova, só mais uma fonte
-- para as duas que já existem. Aplica-se só quando ranked=TRUE, e só entre
-- os 4 jogadores do jogo (já garantidamente membros do grupo, ver acima).
-- Uma correção de resultado (regras 3/4) reverte e reaplica o ranking com
-- o resultado novo — ver apply_group_match_ranking/reverse_group_match_
-- ranking, secção 5.
--
-- Visibilidade por nível de subscrição: "Jogo" está disponível em todos os
-- níveis (free/plus/pro/club) — ver cartão "Rever modelo de
-- subscrições/planos" no Trello. Nada aqui depende de organizations.plan_tier
-- (essa coluna nem existe ainda — migration_self_serve_groups_and_plans.sql
-- continua um rascunho à parte).
--
-- Depende de apply_elo_pairing já existir (migration_elo_provisional_8.sql
-- ou mais recente) e de organizations.points_rules (schema.sql) — ambos já
-- devem estar live, mas confirmar antes de correr este ficheiro.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor, ANTES do merge.
-- NOT LIVE until run there — this file existing in the repo changes
-- nothing on its own.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Tabela ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS group_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),

  ranked BOOLEAN NOT NULL DEFAULT TRUE,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  location TEXT,
  location_latitude DOUBLE PRECISION,
  location_longitude DOUBLE PRECISION,

  -- 2x2 fixo — "apenas um 2x2", não um mix com vagas variáveis. O criador
  -- ocupa sempre team_a_player1; os outros 3 ficam NULL até serem
  -- preenchidos por claim_group_match_slot.
  team_a_player1_id UUID NOT NULL REFERENCES profiles(id),
  team_a_player2_id UUID REFERENCES profiles(id),
  team_b_player1_id UUID REFERENCES profiles(id),
  team_b_player2_id UUID REFERENCES profiles(id),

  score_a INTEGER,
  score_b INTEGER,
  winner_team TEXT CHECK (winner_team IN ('a', 'b')),
  result_inserted_by UUID REFERENCES profiles(id),
  -- NULL = ainda aceita saídas/entradas. Preenchido no primeiro resultado
  -- inserido — a partir daí só se corrige pelo fluxo de correção (regras 3/4).
  locked_at TIMESTAMPTZ,

  -- Proposta de correção pendente (regra 3). Um único slot pendente de cada
  -- vez — uma segunda proposta substitui a anterior. accepted_by acumula
  -- quem já concordou; aplica-se sozinho quando cobrir os 4 participantes
  -- (ver accept_group_match_correction).
  pending_correction_score_a INTEGER,
  pending_correction_score_b INTEGER,
  pending_correction_proposed_by UUID REFERENCES profiles(id),
  pending_correction_accepted_by UUID[] NOT NULL DEFAULT '{}',

  -- Snapshot do que foi aplicado ao ranking (player_stats + rating global)
  -- para o resultado ATUAL — só existe para permitir reverter com exatidão
  -- se o resultado for corrigido depois (ver apply_group_match_ranking/
  -- reverse_group_match_ranking). applied_elo_deltas é {user_id: delta};
  -- applied_stats_points é {slot: pontos}.
  ranked_applied BOOLEAN NOT NULL DEFAULT FALSE,
  applied_winner_team TEXT,
  applied_elo_deltas JSONB,
  applied_stats_points JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_group_matches_organization_id ON group_matches(organization_id);

ALTER TABLE group_matches ENABLE ROW LEVEL SECURITY;

-- Só membros do próprio grupo veem os seus jogos — nunca membros de outro
-- grupo/clube, ao contrário do jogo entre amigos que segue os 4 jogadores.
DROP POLICY IF EXISTS "Org members can view group matches" ON group_matches;
CREATE POLICY "Org members can view group matches"
  ON group_matches FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = group_matches.organization_id AND m.user_id = auth.uid()
  ));

-- Eliminar o jogo inteiro fica reservado a quem o criou ou a um admin do
-- grupo (regra 5) — via RLS direta, como o resto do app já faz para
-- `games`, em vez de mais uma RPC só para isto.
--
-- locked_at IS NULL é obrigatório aqui: uma vez inserido o resultado,
-- apply_group_match_ranking já escreveu em player_stats e no rating global
-- (profiles.rating via apply_elo_pairing) — um DELETE simples não reverte
-- isso, deixava pontos/rating "presos" para sempre. Mesma cautela que
-- delete_private_match (migration_private_matches_delete_rpc.sql) já toma
-- para o jogo entre amigos ("só quem criou... e só enquanto pending").
-- Corrigir um resultado errado passa por propose/accept_group_match_
-- correction (secção 5), nunca por apagar e recriar o jogo.
DROP POLICY IF EXISTS "Creator or org admin can delete group match" ON group_matches;
CREATE POLICY "Creator or org admin can delete group match"
  ON group_matches FOR DELETE
  USING (
    locked_at IS NULL
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.organization_id = group_matches.organization_id AND m.user_id = auth.uid() AND m.is_admin
      )
    )
  );

-- ── 2. create_group_match ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_group_match(
  p_organization_id UUID,
  p_ranked BOOLEAN,
  p_scheduled_date DATE,
  p_scheduled_time TIME DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_location_latitude DOUBLE PRECISION DEFAULT NULL,
  p_location_longitude DOUBLE PRECISION DEFAULT NULL,
  p_team_a_player2_id UUID DEFAULT NULL,
  p_team_b_player1_id UUID DEFAULT NULL,
  p_team_b_player2_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_filled UUID[];
  v_candidate UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships WHERE organization_id = p_organization_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Não és membro deste grupo';
  END IF;

  IF p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'A data do jogo é obrigatória';
  END IF;

  v_filled := ARRAY_REMOVE(ARRAY[auth.uid(), p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id], NULL);
  IF (SELECT COUNT(*) FROM unnest(v_filled)) <> (SELECT COUNT(DISTINCT x) FROM unnest(v_filled) AS x) THEN
    RAISE EXCEPTION 'Cada jogador só pode ocupar uma posição no jogo';
  END IF;

  -- Todos os lugares preenchidos à criação têm de já ser membros do
  -- grupo — este jogo fica ligado ao grupo, não é uma convocação aberta a
  -- qualquer jogador da app (diferença deliberada face ao jogo entre amigos).
  FOREACH v_candidate IN ARRAY ARRAY_REMOVE(ARRAY[p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id], NULL)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM memberships WHERE organization_id = p_organization_id AND user_id = v_candidate
    ) THEN
      RAISE EXCEPTION 'Só podes convidar colegas que já são membros deste grupo';
    END IF;
  END LOOP;

  INSERT INTO group_matches (
    organization_id, created_by, ranked, scheduled_date, scheduled_time,
    location, location_latitude, location_longitude,
    team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id
  )
  VALUES (
    p_organization_id, auth.uid(), p_ranked, p_scheduled_date, p_scheduled_time,
    p_location, p_location_latitude, p_location_longitude,
    auth.uid(), p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_group_match(
  UUID, BOOLEAN, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, UUID
) FROM public;
GRANT EXECUTE ON FUNCTION create_group_match(
  UUID, BOOLEAN, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, UUID
) TO authenticated;

-- ── 3. claim_group_match_slot / leave_group_match_slot ──────────────────

CREATE OR REPLACE FUNCTION claim_group_match_slot(p_match_id UUID, p_slot TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
BEGIN
  IF p_slot IS NULL OR p_slot NOT IN ('team_a_player2', 'team_b_player1', 'team_b_player2') THEN
    RAISE EXCEPTION 'Posição inválida';
  END IF;

  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este jogo já tem resultado, não aceita novos jogadores';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM memberships WHERE organization_id = v_match.organization_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Não és membro deste grupo';
  END IF;
  IF auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ], NULL)) THEN
    RAISE EXCEPTION 'Já estás neste jogo';
  END IF;

  IF p_slot = 'team_a_player2' THEN
    IF v_match.team_a_player2_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE group_matches SET team_a_player2_id = auth.uid() WHERE id = p_match_id;
  ELSIF p_slot = 'team_b_player1' THEN
    IF v_match.team_b_player1_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE group_matches SET team_b_player1_id = auth.uid() WHERE id = p_match_id;
  ELSE
    IF v_match.team_b_player2_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE group_matches SET team_b_player2_id = auth.uid() WHERE id = p_match_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION claim_group_match_slot(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION claim_group_match_slot(UUID, TEXT) TO authenticated;

-- Sair fica disponível a qualquer participante (menos o criador, que tem de
-- eliminar o jogo inteiro em vez disso) enquanto não houver resultado —
-- regra 2 do design.
CREATE OR REPLACE FUNCTION leave_group_match_slot(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
  v_slot TEXT;
BEGIN
  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Já há resultado registado, já não podes sair deste jogo';
  END IF;

  v_slot := CASE
    WHEN v_match.team_a_player2_id = auth.uid() THEN 'team_a_player2'
    WHEN v_match.team_b_player1_id = auth.uid() THEN 'team_b_player1'
    WHEN v_match.team_b_player2_id = auth.uid() THEN 'team_b_player2'
    WHEN v_match.team_a_player1_id = auth.uid() THEN 'creator'
    ELSE NULL
  END;
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'Não fazes parte deste jogo';
  END IF;
  IF v_slot = 'creator' THEN
    RAISE EXCEPTION 'Quem criou o jogo não pode sair — elimina o jogo em vez disso';
  END IF;

  EXECUTE format('UPDATE group_matches SET %I = NULL WHERE id = $1', v_slot || '_id') USING p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION leave_group_match_slot(UUID) FROM public;
GRANT EXECUTE ON FUNCTION leave_group_match_slot(UUID) TO authenticated;

-- ── 4a. apply_group_match_ranking / reverse_group_match_ranking ─────────
-- Internas — só chamadas via PERFORM a partir das funções abaixo, nunca
-- diretamente pelo cliente (REVOKE de tudo, sem GRANT a authenticated,
-- mesmo padrão de apply_elo_pairing). Mesma fonte de pontos que finalize_mix
-- (organizations.points_rules, chaves point_per_match_played/_win) e mesma
-- matemática de rating que mixes e jogo entre amigos (apply_elo_pairing) —
-- só sem os bónus de mix (mix_wins/mixes_played ficam a 0 aqui).

CREATE OR REPLACE FUNCTION apply_group_match_ranking(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
  v_rules JSONB;
  v_deltas JSONB := '{}'::jsonb;
  v_points JSONB := '{}'::jsonb;
  v_won BOOLEAN;
  v_pts INTEGER;
  pl RECORD;
  slotrec RECORD;
BEGIN
  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id;
  IF NOT v_match.ranked OR v_match.winner_team IS NULL THEN
    RETURN;
  END IF;

  SELECT points_rules INTO v_rules FROM organizations WHERE id = v_match.organization_id;
  IF v_rules IS NULL THEN
    v_rules := '{"point_per_match_played": 1, "point_per_match_win": 3}'::jsonb;
  END IF;

  FOR pl IN
    SELECT * FROM apply_elo_pairing(
      v_match.team_a_player1_id, v_match.team_a_player2_id,
      v_match.team_b_player1_id, v_match.team_b_player2_id,
      CASE WHEN v_match.winner_team = 'a' THEN 1 ELSE 0 END
    )
  LOOP
    v_deltas := v_deltas || jsonb_build_object(pl.pid::text, pl.delta);
  END LOOP;

  FOR slotrec IN
    SELECT * FROM (VALUES
      ('team_a_player1', v_match.team_a_player1_id),
      ('team_a_player2', v_match.team_a_player2_id),
      ('team_b_player1', v_match.team_b_player1_id),
      ('team_b_player2', v_match.team_b_player2_id)
    ) AS t(slot, pid)
  LOOP
    v_won := slotrec.slot LIKE 'team\_' || v_match.winner_team || '\_%' ESCAPE '\';
    v_pts := COALESCE((v_rules->>'point_per_match_played')::int, 1)
      + CASE WHEN v_won THEN COALESCE((v_rules->>'point_per_match_win')::int, 3) ELSE 0 END;
    v_points := v_points || jsonb_build_object(slotrec.slot, v_pts);

    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    VALUES (
      slotrec.pid, v_match.organization_id,
      CASE WHEN v_won THEN 1 ELSE 0 END, CASE WHEN v_won THEN 0 ELSE 1 END,
      0, 0, v_pts
    )
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
        game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
        total_points = player_stats.total_points + EXCLUDED.total_points,
        updated_at   = NOW();
  END LOOP;

  UPDATE group_matches
  SET ranked_applied = TRUE,
      applied_winner_team = v_match.winner_team,
      applied_elo_deltas = v_deltas,
      applied_stats_points = v_points
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION apply_group_match_ranking(UUID) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION reverse_group_match_ranking(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
  slotrec RECORD;
  v_won BOOLEAN;
  v_delta NUMERIC;
  v_pts INTEGER;
BEGIN
  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id;
  IF NOT v_match.ranked_applied THEN
    RETURN;
  END IF;

  FOR slotrec IN
    SELECT * FROM (VALUES
      ('team_a_player1', v_match.team_a_player1_id),
      ('team_a_player2', v_match.team_a_player2_id),
      ('team_b_player1', v_match.team_b_player1_id),
      ('team_b_player2', v_match.team_b_player2_id)
    ) AS t(slot, pid)
  LOOP
    v_won := slotrec.slot LIKE 'team\_' || v_match.applied_winner_team || '\_%' ESCAPE '\';
    v_delta := COALESCE((v_match.applied_elo_deltas ->> slotrec.pid::text)::numeric, 0);
    v_pts := COALESCE((v_match.applied_stats_points ->> slotrec.slot)::int, 0);

    UPDATE profiles
    SET rating = GREATEST(0, COALESCE(rating, 900) - v_delta),
        rating_games = GREATEST(0, rating_games - 1)
    WHERE id = slotrec.pid;

    UPDATE player_stats
    SET game_wins    = GREATEST(0, game_wins - CASE WHEN v_won THEN 1 ELSE 0 END),
        game_losses  = GREATEST(0, game_losses - CASE WHEN v_won THEN 0 ELSE 1 END),
        total_points = GREATEST(0, total_points - v_pts),
        updated_at   = NOW()
    WHERE user_id = slotrec.pid AND organization_id = v_match.organization_id;
  END LOOP;

  UPDATE group_matches
  SET ranked_applied = FALSE, applied_winner_team = NULL,
      applied_elo_deltas = NULL, applied_stats_points = NULL
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION reverse_group_match_ranking(UUID) FROM public, anon, authenticated;

-- ── 4. submit_group_match_result ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION submit_group_match_result(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
  v_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este jogo já tem resultado — usa a correção em vez de inserir de novo';
  END IF;
  IF v_match.team_a_player2_id IS NULL OR v_match.team_b_player1_id IS NULL OR v_match.team_b_player2_id IS NULL THEN
    RAISE EXCEPTION 'O resultado só pode ser inserido com as equipas completas';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a = p_score_b OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  SELECT is_admin INTO v_is_admin FROM memberships
  WHERE organization_id = v_match.organization_id AND user_id = auth.uid();

  IF NOT (
    auth.uid() = ANY (ARRAY[
      v_match.team_a_player1_id, v_match.team_a_player2_id,
      v_match.team_b_player1_id, v_match.team_b_player2_id
    ])
    OR COALESCE(v_is_admin, FALSE)
  ) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo ou um admin do grupo podem inserir o resultado';
  END IF;

  UPDATE group_matches
  SET score_a = p_score_a,
      score_b = p_score_b,
      winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' ELSE 'b' END,
      result_inserted_by = auth.uid(),
      locked_at = TIMEZONE('utc', NOW())
  WHERE id = p_match_id;

  PERFORM apply_group_match_ranking(p_match_id);
END;
$$;

REVOKE ALL ON FUNCTION submit_group_match_result(UUID, INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION submit_group_match_result(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 5. propose_group_match_correction / accept_group_match_correction ───
-- Regras 3+4: se quem inseriu o resultado era admin do grupo NA ALTURA,
-- só um admin corrige, e corrige de imediato (sem votação — a autoridade já
-- é dele). Caso contrário, qualquer um dos 4 participantes propõe e só se
-- aplica com os 4 a aceitar.

CREATE OR REPLACE FUNCTION propose_group_match_correction(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
  v_inserter_was_admin BOOLEAN;
  v_caller_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.locked_at IS NULL THEN
    RAISE EXCEPTION 'Ainda não há resultado para corrigir';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a = p_score_b OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  SELECT is_admin INTO v_inserter_was_admin FROM memberships
  WHERE organization_id = v_match.organization_id AND user_id = v_match.result_inserted_by;
  SELECT is_admin INTO v_caller_is_admin FROM memberships
  WHERE organization_id = v_match.organization_id AND user_id = auth.uid();

  IF COALESCE(v_inserter_was_admin, FALSE) THEN
    IF NOT COALESCE(v_caller_is_admin, FALSE) THEN
      RAISE EXCEPTION 'Este resultado foi inserido por um admin — só um admin do grupo o pode corrigir';
    END IF;
    -- Autoridade do admin é direta, sem votação dos jogadores.
    PERFORM reverse_group_match_ranking(p_match_id);
    UPDATE group_matches
    SET score_a = p_score_a, score_b = p_score_b,
        winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' ELSE 'b' END,
        pending_correction_score_a = NULL, pending_correction_score_b = NULL,
        pending_correction_proposed_by = NULL, pending_correction_accepted_by = '{}'
    WHERE id = p_match_id;
    PERFORM apply_group_match_ranking(p_match_id);
    RETURN;
  END IF;

  IF NOT (auth.uid() = ANY (ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ])) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem propor uma correção';
  END IF;

  UPDATE group_matches
  SET pending_correction_score_a = p_score_a,
      pending_correction_score_b = p_score_b,
      pending_correction_proposed_by = auth.uid(),
      pending_correction_accepted_by = ARRAY[auth.uid()]
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION propose_group_match_correction(UUID, INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION propose_group_match_correction(UUID, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION accept_group_match_correction(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
  v_participants UUID[];
  v_accepted UUID[];
BEGIN
  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.pending_correction_proposed_by IS NULL THEN
    RAISE EXCEPTION 'Não há nenhuma correção proposta para este jogo';
  END IF;
  IF NOT (auth.uid() = ANY (ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ])) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem aceitar a correção';
  END IF;

  v_accepted := ARRAY(SELECT DISTINCT unnest(v_match.pending_correction_accepted_by || auth.uid()));
  v_participants := ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ];

  IF (SELECT COUNT(*) FROM unnest(v_participants) p WHERE p = ANY (v_accepted)) = 4 THEN
    PERFORM reverse_group_match_ranking(p_match_id);
    UPDATE group_matches
    SET score_a = v_match.pending_correction_score_a,
        score_b = v_match.pending_correction_score_b,
        winner_team = CASE WHEN v_match.pending_correction_score_a > v_match.pending_correction_score_b THEN 'a' ELSE 'b' END,
        pending_correction_score_a = NULL, pending_correction_score_b = NULL,
        pending_correction_proposed_by = NULL, pending_correction_accepted_by = '{}'
    WHERE id = p_match_id;
    PERFORM apply_group_match_ranking(p_match_id);
  ELSE
    UPDATE group_matches SET pending_correction_accepted_by = v_accepted WHERE id = p_match_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION accept_group_match_correction(UUID) FROM public;
GRANT EXECUTE ON FUNCTION accept_group_match_correction(UUID) TO authenticated;

-- ── 6. get_group_matches ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_group_matches(p_organization_id UUID)
RETURNS TABLE (
  id UUID,
  ranked BOOLEAN,
  scheduled_date DATE,
  scheduled_time TIME,
  location TEXT,
  location_latitude DOUBLE PRECISION,
  location_longitude DOUBLE PRECISION,
  score_a INTEGER,
  score_b INTEGER,
  winner_team TEXT,
  locked_at TIMESTAMPTZ,
  created_by UUID,
  result_inserted_by UUID,
  result_inserted_by_name TEXT,
  pending_correction_score_a INTEGER,
  pending_correction_score_b INTEGER,
  pending_correction_proposed_by UUID,
  pending_correction_accepted_by UUID[],
  team_a_player1_id UUID, team_a_player1_name TEXT, team_a_player1_avatar TEXT,
  team_a_player2_id UUID, team_a_player2_name TEXT, team_a_player2_avatar TEXT,
  team_b_player1_id UUID, team_b_player1_name TEXT, team_b_player1_avatar TEXT,
  team_b_player2_id UUID, team_b_player2_name TEXT, team_b_player2_avatar TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    gm.id, gm.ranked, gm.scheduled_date, gm.scheduled_time, gm.location,
    gm.location_latitude, gm.location_longitude,
    gm.score_a, gm.score_b, gm.winner_team, gm.locked_at,
    gm.created_by, gm.result_inserted_by, pri.name,
    gm.pending_correction_score_a, gm.pending_correction_score_b,
    gm.pending_correction_proposed_by, gm.pending_correction_accepted_by,
    gm.team_a_player1_id, pa1.name, pa1.avatar_url,
    gm.team_a_player2_id, pa2.name, pa2.avatar_url,
    gm.team_b_player1_id, pb1.name, pb1.avatar_url,
    gm.team_b_player2_id, pb2.name, pb2.avatar_url,
    gm.created_at
  FROM group_matches gm
  LEFT JOIN profiles pa1 ON pa1.id = gm.team_a_player1_id
  LEFT JOIN profiles pa2 ON pa2.id = gm.team_a_player2_id
  LEFT JOIN profiles pb1 ON pb1.id = gm.team_b_player1_id
  LEFT JOIN profiles pb2 ON pb2.id = gm.team_b_player2_id
  LEFT JOIN profiles pri ON pri.id = gm.result_inserted_by
  WHERE gm.organization_id = p_organization_id
    AND EXISTS (
      SELECT 1 FROM memberships m WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid()
    )
  ORDER BY gm.scheduled_date DESC, gm.created_at DESC;
$$;

REVOKE ALL ON FUNCTION get_group_matches(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_group_matches(UUID) TO authenticated;
