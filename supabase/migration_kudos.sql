-- ════════════════════════════════════════════════════════════════════════
-- Kudos — o 👍 da noite (spec 2026-09-09)
--
-- No fim de um mix, cada participante pode dar UM kudos a outro jogador
-- do mix (à Strava): reconhecimento social, +1 XP por kudos recebido.
-- Terceiro eixo do sistema — Elo mede nível, XP mede presença, kudos
-- mede o que os colegas viram (a boa onda, o carry, o novato que
-- surpreendeu).
--
-- Guardas (todas aqui, no Postgres): 1 voto por (mix, votante) via
-- UNIQUE; nunca em si próprio (CHECK); só participantes confirmados do
-- mix; só depois de finalizado; janela de 48h após a data do mix (ritual
-- de fecho, não botão eterno). Voto é final — sem trocas (evita a dança
-- de ±1 XP).
--
-- XP: +1 por kudos recebido, no ledger como UM evento 'kudos' por
-- (jogador, mix) com amount incremental — o UNIQUE parcial do ledger
-- (user_id, kind, source_game_id) não permitiria 11 linhas, e assim o
-- histórico fica compacto: amount = total de kudos naquele mix.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mix_kudos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  voter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (game_id, voter_id),
  CHECK (voter_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_mix_kudos_recipient ON mix_kudos (recipient_id);

-- Deny-all para clientes: escrita e leitura passam pelos RPCs abaixo.
ALTER TABLE mix_kudos ENABLE ROW LEVEL SECURITY;

-- kind novo no ledger de XP.
ALTER TABLE xp_events DROP CONSTRAINT IF EXISTS xp_events_kind_check;
ALTER TABLE xp_events ADD CONSTRAINT xp_events_kind_check CHECK (kind IN
  ('mix_participation','mix_games','mix_win','friendly_match','friendly_win','kudos'));

-- ── Dar o 👍 ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION give_mix_kudos(p_game_id UUID, p_recipient_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game games;
  v_voter UUID := auth.uid();
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND OR v_game.status <> 'finished' THEN
    RAISE EXCEPTION 'O mix ainda não terminou';
  END IF;
  IF NOW() > v_game.date + INTERVAL '48 hours' THEN
    RAISE EXCEPTION 'O período para dar kudos deste mix já fechou';
  END IF;
  IF p_recipient_id = v_voter THEN
    RAISE EXCEPTION 'Não podes dar kudos a ti próprio';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE game_id = p_game_id AND status = 'confirmed'
      AND (user_id = v_voter OR partner_id = v_voter)
  ) THEN
    RAISE EXCEPTION 'Só quem jogou o mix pode dar kudos';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM participants
    WHERE game_id = p_game_id AND status = 'confirmed'
      AND (user_id = p_recipient_id OR partner_id = p_recipient_id)
  ) THEN
    RAISE EXCEPTION 'Esse jogador não jogou este mix';
  END IF;

  BEGIN
    INSERT INTO mix_kudos (game_id, voter_id, recipient_id)
    VALUES (p_game_id, v_voter, p_recipient_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já deste o teu kudos neste mix';
  END;

  -- +1 XP para quem recebe — um evento por (jogador, mix), amount soma.
  INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount)
  VALUES (p_recipient_id, v_game.organization_id, 'kudos', p_game_id, 1)
  ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL
  DO UPDATE SET amount = xp_events.amount + 1;

  UPDATE profiles SET xp = xp + 1 WHERE id = p_recipient_id;
END;
$$;

REVOKE ALL ON FUNCTION give_mix_kudos(UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION give_mix_kudos(UUID, UUID) TO authenticated;

-- ── Ler o pódio de um mix ───────────────────────────────────────────────
-- my_vote marca a linha em que está o voto do caller (para a UI realçar
-- e saber que já votou).

CREATE OR REPLACE FUNCTION get_mix_kudos(p_game_id UUID)
RETURNS TABLE (recipient_id UUID, name TEXT, avatar_url TEXT, kudos_count BIGINT, my_vote BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT k.recipient_id, p.name, p.avatar_url,
         COUNT(*)::bigint,
         BOOL_OR(k.voter_id = auth.uid())
  FROM mix_kudos k
  JOIN profiles p ON p.id = k.recipient_id
  WHERE k.game_id = p_game_id
    -- visível para membros do clube do mix (o pódio é parte do resultado)
    AND EXISTS (
      SELECT 1 FROM games g
      JOIN memberships m ON m.organization_id = g.organization_id AND m.user_id = auth.uid()
      WHERE g.id = p_game_id
    )
  GROUP BY k.recipient_id, p.name, p.avatar_url
  ORDER BY COUNT(*) DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_mix_kudos(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_mix_kudos(UUID) TO authenticated;

-- ── Total de kudos no perfil (à Strava) ─────────────────────────────────
-- get_player_xp ganha o total de kudos recebidos (RETURNS muda → DROP).

DROP FUNCTION IF EXISTS get_player_xp(UUID);

CREATE OR REPLACE FUNCTION get_player_xp(p_user_id UUID)
RETURNS TABLE (xp INTEGER, last_played_at TIMESTAMPTZ, kudos BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.xp, p.last_played_at,
         COALESCE((SELECT SUM(e.amount) FROM xp_events e
                   WHERE e.user_id = p_user_id AND e.kind = 'kudos'), 0)::bigint
  FROM profiles p WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_xp(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_player_xp(UUID) TO authenticated;
