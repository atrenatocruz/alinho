-- ════════════════════════════════════════════════════════════════════════
-- Relógio, Fase C: desafios de 7 dias entre amigos, «Amigos esta semana» e o
-- resultado do relógio num jogo entre amigos registado a partir dele.
-- docs/superpowers/specs/2026-10-26-relogio-prototipo-23out-design.md
--
-- O que vai ao servidor: só jogos registados (os jogos entre amigos que já
-- existem) e os desafios. A saúde (pulsação, calorias, esforço) nunca: fica no
-- telemóvel. Aos amigos só aparecem contagens de jogos confirmados, e só de
-- quem tem os resultados visíveis para eles (played_history_visible).
--
-- Compatível com as versões antigas da app: só acrescenta (uma coluna nula,
-- uma tabela e funções novas).
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor (dev primeiro, depois prod).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O resultado que o relógio contou ─────────────────────────────────
-- Quando quem regista muda o resultado à mão, os outros veem os dois.
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS watch_result TEXT;

CREATE OR REPLACE FUNCTION public.set_friend_match_watch_result(p_match_id UUID, p_text TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessão';
  END IF;
  IF p_text IS NOT NULL AND length(p_text) > 60 THEN
    RAISE EXCEPTION 'Resultado demasiado comprido';
  END IF;
  UPDATE private_matches
     SET watch_result = p_text
   WHERE id = p_match_id
     AND creator_id = auth.uid()
     AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Só quem criou o jogo, e só antes de estar confirmado';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_friend_match_watch_result(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_friend_match_watch_result(UUID, TEXT) TO authenticated;

-- Estado dos jogos registados a partir do relógio, para «Os meus números» e para
-- o ecrã de aceitar: quantos dos outros jogadores (com conta) já aceitaram e o
-- resultado do relógio. Só dos jogos em que quem pergunta joga.
CREATE OR REPLACE FUNCTION public.get_watch_match_states(p_ids UUID[])
RETURNS TABLE(id UUID, status TEXT, accepted INTEGER, others INTEGER, watch_result TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT m.id, m.status,
         (SELECT count(*)::int FROM (VALUES
            (m.team_a_player1_id, m.team_a_player1_status), (m.team_a_player2_id, m.team_a_player2_status),
            (m.team_b_player1_id, m.team_b_player1_status), (m.team_b_player2_id, m.team_b_player2_status)
          ) AS t(pid, st) WHERE t.pid IS NOT NULL AND t.pid <> m.creator_id AND t.st IN ('accepted_all', 'accepted_no_ranking')),
         (SELECT count(*)::int FROM (VALUES
            (m.team_a_player1_id), (m.team_a_player2_id), (m.team_b_player1_id), (m.team_b_player2_id)
          ) AS t(pid) WHERE t.pid IS NOT NULL AND t.pid <> m.creator_id),
         m.watch_result
    FROM private_matches m
   WHERE m.id = ANY(p_ids)
     AND auth.uid() IN (m.team_a_player1_id, m.team_a_player2_id, m.team_b_player1_id, m.team_b_player2_id);
$function$;
REVOKE ALL ON FUNCTION public.get_watch_match_states(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_watch_match_states(UUID[]) TO authenticated;

-- Jogos entre amigos confirmados de uma pessoa, entre duas datas, com as
-- vitórias. Conta todos os confirmados, também com convidados ou sem ranking
-- (o private_match_stats só tem os que contaram para o ranking). Só para usar
-- dentro das funções abaixo.
CREATE OR REPLACE FUNCTION public.confirmed_friend_games(p_uid UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE(games INTEGER, wins INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT count(*)::int,
         count(*) FILTER (WHERE
           (m.winner_team = 'a' AND p_uid IN (m.team_a_player1_id, m.team_a_player2_id))
        OR (m.winner_team = 'b' AND p_uid IN (m.team_b_player1_id, m.team_b_player2_id)))::int
    FROM private_matches m
   WHERE m.status = 'confirmed'
     AND m.played_at >= p_from AND m.played_at < p_to
     AND p_uid IN (m.team_a_player1_id, m.team_a_player2_id, m.team_b_player1_id, m.team_b_player2_id);
$function$;
REVOKE ALL ON FUNCTION public.confirmed_friend_games(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ── 2. Desafios de 7 dias ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friend_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenger_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  opponent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (challenger_id <> opponent_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_friend_challenges_challenger ON friend_challenges(challenger_id);
CREATE INDEX IF NOT EXISTS idx_friend_challenges_opponent ON friend_challenges(opponent_id);

ALTER TABLE friend_challenges ENABLE ROW LEVEL SECURITY;

-- Só os dois veem o desafio. Sem políticas de escrita: tudo passa pelas RPCs.
DROP POLICY IF EXISTS "Challenge players can view" ON friend_challenges;
CREATE POLICY "Challenge players can view"
  ON friend_challenges FOR SELECT
  USING (auth.uid() = challenger_id OR auth.uid() = opponent_id);

CREATE OR REPLACE FUNCTION public.create_friend_challenge(p_opponent UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sem sessão';
  END IF;
  -- «Amigos» = seguem-se os dois (is_mutual_follow, que substituiu o are_friends).
  IF p_opponent IS NULL OR p_opponent = v_uid OR NOT is_mutual_follow(v_uid, p_opponent) THEN
    RAISE EXCEPTION 'Só se desafia um amigo';
  END IF;
  -- Um desafio ativo (pendente ou aceite, ainda a decorrer) por par.
  IF EXISTS (
    SELECT 1 FROM friend_challenges
     WHERE status IN ('pending', 'accepted') AND ends_at > now()
       AND ((challenger_id = v_uid AND opponent_id = p_opponent)
         OR (challenger_id = p_opponent AND opponent_id = v_uid))
  ) THEN
    RAISE EXCEPTION 'Já há um desafio entre os dois';
  END IF;
  INSERT INTO friend_challenges (challenger_id, opponent_id, starts_at, ends_at)
  VALUES (v_uid, p_opponent, now(), now() + interval '7 days')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_friend_challenge(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_friend_challenge(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_friend_challenge(p_id UUID, p_accept BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessão';
  END IF;
  UPDATE friend_challenges
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
   WHERE id = p_id
     AND opponent_id = auth.uid()
     AND status = 'pending'
     AND ends_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Desafio não encontrado';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_friend_challenge(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_friend_challenge(UUID, BOOLEAN) TO authenticated;

-- Jogos entre amigos confirmados de cada um dos dois, dentro do desafio. Só os
-- dois o podem ler, e só com o desafio aceite: aceitar é o acordo para verem a
-- contagem um do outro.
CREATE OR REPLACE FUNCTION public.friend_challenge_scores(p_id UUID)
RETURNS TABLE(user_id UUID, games INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c friend_challenges;
BEGIN
  -- Só depois de aceite: até lá o desafiado ainda não deu acordo a mostrar a contagem.
  SELECT * INTO c FROM friend_challenges
   WHERE id = p_id AND status = 'accepted'
     AND (challenger_id = auth.uid() OR opponent_id = auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Desafio não encontrado';
  END IF;
  RETURN QUERY
    SELECT u.id, g.games
      FROM (VALUES (c.challenger_id), (c.opponent_id)) AS u(id)
      CROSS JOIN LATERAL confirmed_friend_games(u.id, c.starts_at, c.ends_at) g;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_challenge_scores(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_challenge_scores(UUID) TO authenticated;

-- ── 3. Amigos esta semana ───────────────────────────────────────────────
-- Jogos entre amigos confirmados dos últimos 7 dias de cada amigo, só de quem
-- mostra os resultados a quem pergunta (o mesmo porteiro do histórico).
CREATE OR REPLACE FUNCTION public.friends_week_games()
RETURNS TABLE(friend_id UUID, games INTEGER, wins INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH friends AS (
    SELECT f.followed_id AS id
      FROM follows f
     WHERE f.follower_id = auth.uid() AND f.status = 'accepted'
       AND is_mutual_follow(auth.uid(), f.followed_id)
  )
  SELECT f.id, g.games, g.wins
    FROM friends f
    CROSS JOIN LATERAL confirmed_friend_games(f.id, now() - interval '7 days', now()) g
   WHERE auth.uid() IS NOT NULL
     AND g.games > 0
     AND played_history_visible(f.id);
$function$;
REVOKE ALL ON FUNCTION public.friends_week_games() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friends_week_games() TO authenticated;

COMMIT;
