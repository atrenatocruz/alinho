-- ═════════════════════════════════════════════════════════════════════════
-- «Pessoas que talvez conheças» (Home do futuro — ecrã do Dev 4; dados do
-- Dev 2, a pedido do PO, regras combinadas com o Dev 3; plano com o «okay» do
-- Francisco a 11 out).
--
-- suggest_people(p_limit DEFAULT 8) → id, name, avatar_url, rating, gender,
-- follow_status ('none' | 'pending' | 'following'), reason ('jogaram_juntos'
-- | 'mesmo_clube').
--
-- QUEM APARECE: quem jogou comigo (estatísticas do mesmo mix ou jogo em
-- aberto) ou está num clube/grupo meu, e que eu ainda não sigo (o pedido
-- pendente aparece, com follow_status 'pending'). Primeiro quem jogou comigo
-- (mais jogos, mais recente), depois os dos clubes. 'jogaram_juntos' ganha
-- quando há as duas.
-- QUEM NUNCA APARECE: eu, contas de teste (is_test), super admins da
-- plataforma (invisíveis, como nas listas de membros), contas a apagar,
-- convidados do WhatsApp (guest-…@whatsapp.alinho.pt) e convidados dos
-- clubes (memberships.is_guest).
-- PRIVACIDADE: perfis privados aparecem SEMPRE (regra de 1 out), mas sem
-- seguir mútuo o nível (rating) e o género vêm a null. Nada de contactos nem
-- telemóvel: só o que a app já mostra (jogos e membros dos clubes).
--
-- Dev 2, 11 out 2026. Run this whole file in Supabase → SQL Editor → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.suggest_people(p_limit INT DEFAULT 8)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, rating NUMERIC, gender TEXT, follow_status TEXT, reason TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  played AS (
    SELECT s2.user_id AS pid, count(DISTINCT s2.game_id) AS games, max(g.date) AS last_at
      FROM mix_player_stats s1
      JOIN mix_player_stats s2 ON s2.game_id = s1.game_id AND s2.user_id <> s1.user_id
      JOIN games g ON g.id = s1.game_id
     WHERE s1.user_id = (SELECT uid FROM me)
     GROUP BY s2.user_id
  ),
  clubs AS (
    SELECT DISTINCT m2.user_id AS pid
      FROM memberships m1
      JOIN memberships m2 ON m2.organization_id = m1.organization_id AND m2.user_id <> m1.user_id
     WHERE m1.user_id = (SELECT uid FROM me) AND NOT COALESCE(m2.is_guest, FALSE)
  ),
  cand AS (
    SELECT p.id, p.name, p.avatar_url, p.rating, p.gender, p.is_private,
           pl.games, pl.last_at, (pl.pid IS NOT NULL) AS played_with
      FROM profiles p
      LEFT JOIN played pl ON pl.pid = p.id
     WHERE (pl.pid IS NOT NULL OR p.id IN (SELECT pid FROM clubs))
       AND p.id <> (SELECT uid FROM me)
       AND NOT COALESCE(p.is_test, FALSE)
       AND NOT COALESCE(p.is_platform_admin, FALSE)
       AND p.deletion_requested_at IS NULL
       AND COALESCE(p.email, '') NOT ILIKE 'guest-%@whatsapp.alinho.pt'
       AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = (SELECT uid FROM me) AND f.followed_id = p.id AND f.status = 'accepted')
  )
  SELECT c.id, c.name, c.avatar_url,
         CASE WHEN NOT COALESCE(c.is_private, FALSE) OR is_mutual_follow((SELECT uid FROM me), c.id) THEN c.rating END,
         CASE WHEN NOT COALESCE(c.is_private, FALSE) OR is_mutual_follow((SELECT uid FROM me), c.id) THEN c.gender END,
         COALESCE((SELECT CASE f.status WHEN 'accepted' THEN 'following' ELSE 'pending' END
                     FROM follows f WHERE f.follower_id = (SELECT uid FROM me) AND f.followed_id = c.id), 'none'),
         CASE WHEN c.played_with THEN 'jogaram_juntos' ELSE 'mesmo_clube' END
    FROM cand c
   WHERE (SELECT uid FROM me) IS NOT NULL
   ORDER BY c.played_with DESC, c.games DESC NULLS LAST, c.last_at DESC NULLS LAST, c.name
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.suggest_people(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_people(INT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.suggest_people(int)', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'public.suggest_people(int)', 'EXECUTE');  -- true
