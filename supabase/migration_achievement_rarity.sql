-- ═════════════════════════════════════════════════════════════════════════
-- A «% têm» de todas as conquistas, também das que ainda não tenho
-- (conquistas animadas, 11 out — o Francisco pediu para não se perder a
-- percentagem; a UX quer-na no cartão aberto, também nas por ganhar,
-- «porque ajuda a perceber se é difícil»).
--
-- PORQUÊ. get_player_achievements só traz a percentagem das conquistas que a
-- pessoa já ganhou. Para as outras não havia de onde a ler.
--
-- O QUE FAZ. get_achievement_rarity(): uma linha por conquista ativa, com a
-- mesma conta da get_player_achievements (numerador e denominador nos perfis
-- com rating). Só leitura, só números agregados — ninguém fica a saber quem
-- tem o quê.
--
-- Sem esta função a app não parte: o cartão por ganhar fica sem a «% têm».
--
-- Dev 2, 11 out 2026.
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_achievement_rarity()
RETURNS TABLE (achievement_key TEXT, rarity_pct NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH active_players AS (
    SELECT COUNT(*) AS n FROM profiles WHERE rating IS NOT NULL
  ), holders AS (
    SELECT x.achievement_key, COUNT(*) AS n
      FROM player_achievements x
      JOIN profiles px ON px.id = x.user_id AND px.rating IS NOT NULL
     GROUP BY x.achievement_key
  )
  SELECT a.key, ROUND(100.0 * COALESCE(h.n, 0) / GREATEST((SELECT n FROM active_players), 1), 1)
    FROM achievements a
    LEFT JOIN holders h ON h.achievement_key = a.key
   WHERE a.active;
$$;

REVOKE ALL ON FUNCTION public.get_achievement_rarity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_achievement_rarity() TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM get_achievement_rarity();                                        -- = conquistas ativas
--   SELECT has_function_privilege('anon', 'public.get_achievement_rarity()', 'EXECUTE');  -- false
