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
  IF p_opponent IS NULL OR p_opponent = v_uid OR NOT are_friends(v_uid, p_opponent) THEN
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
    SELECT u.id, (
      SELECT count(*)::int
        FROM private_match_stats s
        JOIN private_matches m ON m.id = s.private_match_id
       WHERE s.user_id = u.id
         AND m.status = 'confirmed'
         AND m.played_at >= c.starts_at AND m.played_at < c.ends_at
    )
    FROM (VALUES (c.challenger_id), (c.opponent_id)) AS u(id);
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
    SELECT CASE WHEN fr.requester_id = auth.uid() THEN fr.addressee_id ELSE fr.requester_id END AS id
      FROM friend_requests fr
     WHERE fr.status = 'accepted'
       AND auth.uid() IN (fr.requester_id, fr.addressee_id)
  )
  SELECT f.id, count(*)::int, count(*) FILTER (WHERE s.won)::int
    FROM friends f
    JOIN private_match_stats s ON s.user_id = f.id
    JOIN private_matches m ON m.id = s.private_match_id
   WHERE auth.uid() IS NOT NULL
     AND m.status = 'confirmed'
     AND m.played_at >= now() - interval '7 days'
     AND played_history_visible(f.id)
   GROUP BY f.id;
$function$;
REVOKE ALL ON FUNCTION public.friends_week_games() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friends_week_games() TO authenticated;

COMMIT;
