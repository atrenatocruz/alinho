-- ═════════════════════════════════════════════════════════════════════════
-- Sugestões ao escolher pessoas: o parceiro no mix e no jogo em aberto (Dev 2)
-- e as pessoas do «Novo jogo entre amigos» (Bugs). Pedido do Francisco a 12
-- out: «Devia-me dar sugestões de pessoas, talvez com aquelas que jogo mais,
-- ou amigos, etc.» Combinado com o Bugs e o PO; sem plano à parte (só uma
-- função de leitura, sem tabela nova, com as regras de privacidade de sempre).
--
-- suggest_partners(p_limit DEFAULT 8, p_org_id DEFAULT NULL) → id, name,
-- avatar_url, rating, gender, reason ('jogaram_juntos' | 'seguem_se' |
-- 'mesmo_clube'), reason_count (jogos juntos, na 1.ª), org_name (na última).
--
-- ORDEM: 1) com quem joguei nos últimos 6 meses, como parceiro ou contra
-- (jogos com resultado dos mixes e jogos em aberto, e jogos entre amigos
-- confirmados), por número de jogos e depois pelo mais recente; 2) quem eu
-- sigo e me segue, depois quem eu sigo; 3) os membros dos meus clubes e
-- grupos. Ao contrário do suggest_people («talvez conheças»), quem já sigo
-- APARECE: aqui é para escolher, não para seguir.
-- p_org_id: só membros (sem convidados) desse clube ou grupo — o mix de um
-- clube, ou o jogo de grupo.
-- QUEM NUNCA APARECE (como no suggest_people): eu, contas de teste, super
-- admins, contas a apagar, convidados do WhatsApp e convidados dos clubes.
-- PRIVACIDADE (regra de 1 out): perfis privados aparecem SEMPRE, mas sem
-- seguir mútuo o nível e o género vêm a null. Só dados que a app já mostra.
--
-- Dev 2, 12 out 2026. Run this whole file in Supabase → SQL Editor → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.suggest_partners(p_limit INT DEFAULT 8, p_org_id UUID DEFAULT NULL)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, rating NUMERIC, gender TEXT,
               reason TEXT, reason_count INT, org_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  -- Cada jogo com resultado de um mix ou jogo em aberto em que entrei, com
  -- as outras três pessoas do campo.
  mix_plays AS (
    SELECT x.pid, m.id AS play_id, g.date AS at
      FROM matches m
      JOIN games g ON g.id = m.game_id
      JOIN teams ta ON ta.id = m.team_a_id
      JOIN teams tb ON tb.id = m.team_b_id
      CROSS JOIN LATERAL (VALUES (ta.player1_id), (ta.player2_id), (tb.player1_id), (tb.player2_id)) AS x(pid)
     WHERE m.winner_team_id IS NOT NULL
       AND g.date >= NOW() - INTERVAL '6 months'
       AND (SELECT uid FROM me) IN (ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id)
  ),
  -- Jogos entre amigos confirmados (um por combinação de duplas, regra de 8 out).
  friend_plays AS (
    SELECT x.pid, pm.id AS play_id, COALESCE(pm.played_at, pm.created_at) AS at
      FROM private_matches pm
      CROSS JOIN LATERAL (VALUES (pm.team_a_player1_id), (pm.team_a_player2_id),
                                 (pm.team_b_player1_id), (pm.team_b_player2_id)) AS x(pid)
     WHERE pm.status = 'confirmed'
       AND COALESCE(pm.played_at, pm.created_at) >= NOW() - INTERVAL '6 months'
       AND (SELECT uid FROM me) IN (pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id)
  ),
  played AS (
    SELECT pid, count(DISTINCT play_id)::int AS n, max(at) AS last_at
      FROM (SELECT * FROM mix_plays UNION ALL SELECT * FROM friend_plays) p
     WHERE pid IS NOT NULL AND pid <> (SELECT uid FROM me)
     GROUP BY pid
  ),
  i_follow AS (
    SELECT f.followed_id AS pid FROM follows f
     WHERE f.follower_id = (SELECT uid FROM me) AND f.status = 'accepted'
  ),
  -- Os meus clubes e grupos (o nome do primeiro em comum, para a razão).
  clubs AS (
    SELECT m2.user_id AS pid, min(o.name) AS org_name
      FROM memberships m1
      JOIN memberships m2 ON m2.organization_id = m1.organization_id AND m2.user_id <> m1.user_id
      JOIN organizations o ON o.id = m1.organization_id
     WHERE m1.user_id = (SELECT uid FROM me) AND NOT COALESCE(m2.is_guest, FALSE)
     GROUP BY m2.user_id
  ),
  cand AS (
    SELECT p.id, p.name, p.avatar_url, p.rating, p.gender, p.is_private,
           pl.n, pl.last_at, c.org_name,
           (pl.pid IS NOT NULL) AS played_with,
           (f.pid IS NOT NULL) AS followed,
           (f.pid IS NOT NULL AND is_mutual_follow((SELECT uid FROM me), p.id)) AS mutual
      FROM profiles p
      LEFT JOIN played pl ON pl.pid = p.id
      LEFT JOIN i_follow f ON f.pid = p.id
      LEFT JOIN clubs c ON c.pid = p.id
     WHERE (pl.pid IS NOT NULL OR f.pid IS NOT NULL OR c.pid IS NOT NULL)
       AND p.id <> (SELECT uid FROM me)
       AND NOT COALESCE(p.is_test, FALSE)
       AND NOT COALESCE(p.is_platform_admin, FALSE)
       AND p.deletion_requested_at IS NULL
       AND COALESCE(p.email, '') NOT ILIKE 'guest-%@whatsapp.alinho.pt'
       AND (p_org_id IS NULL OR EXISTS (
             SELECT 1 FROM memberships mo
              WHERE mo.organization_id = p_org_id AND mo.user_id = p.id AND NOT COALESCE(mo.is_guest, FALSE)))
  )
  SELECT c.id, c.name, c.avatar_url,
         CASE WHEN NOT COALESCE(c.is_private, FALSE) OR is_mutual_follow((SELECT uid FROM me), c.id) THEN c.rating END,
         CASE WHEN NOT COALESCE(c.is_private, FALSE) OR is_mutual_follow((SELECT uid FROM me), c.id) THEN c.gender END,
         CASE WHEN c.played_with THEN 'jogaram_juntos' WHEN c.followed THEN 'seguem_se' ELSE 'mesmo_clube' END,
         CASE WHEN c.played_with THEN c.n END,
         CASE WHEN NOT c.played_with AND NOT c.followed THEN c.org_name END
    FROM cand c
   WHERE (SELECT uid FROM me) IS NOT NULL
   ORDER BY c.played_with DESC, c.n DESC NULLS LAST, c.last_at DESC NULLS LAST,
            c.mutual DESC, c.followed DESC, c.name
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50);
$function$;

REVOKE ALL ON FUNCTION public.suggest_partners(INT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_partners(INT, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.suggest_partners(int,uuid)', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'public.suggest_partners(int,uuid)', 'EXECUTE');  -- true
