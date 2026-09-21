-- ════════════════════════════════════════════════════════════════════════
-- Kudos: quem recebe passa a ver quem deu (Trello #340)
--
-- Hoje o ecrã de celebrações diz só "Recebeste 2 👍 no Mix de quinta". A
-- tabela mix_kudos já guarda quem deu (voter_id), mas a leitura da tabela
-- está fechada aos clientes e get_unseen_celebrations() só devolve a
-- contagem e o título do mix.
--
-- Isto acrescenta uma coluna `voters` (jsonb) com o nome e a foto de quem
-- deu, e **só a quem recebeu**: a função é SECURITY DEFINER e o ramo dos
-- kudos continua filtrado por k.recipient_id = auth.uid(). A tabela
-- mix_kudos não abre — um terceiro continua a ver apenas o total, como
-- hoje. Não mexe no XP nem no ranking de kudos.
--
-- Proposta do Dev 2 para o Renato validar (o cartão diz que a parte de
-- base de dados é dele). Correr depois de migration_achievements_rename.sql
-- (é essa que tem a versão atual da função).
--
-- Francisco, 21 set 2026 · cartão #340 (P0)
-- ════════════════════════════════════════════════════════════════════════

-- O tipo de retorno muda (coluna nova), e CREATE OR REPLACE não consegue
-- mudar o tipo de retorno de uma função: tem de ser DROP + CREATE.
DROP FUNCTION IF EXISTS get_unseen_celebrations();

CREATE FUNCTION get_unseen_celebrations()
RETURNS TABLE (
  kind TEXT, trophy_key TEXT, rarity TEXT,
  kudos_count BIGINT, game_title TEXT, voters JSONB,
  happened_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH me AS (
    SELECT id, COALESCE(celebrations_seen_at, '-infinity'::timestamptz) AS seen
    FROM profiles WHERE id = auth.uid()
  )
  -- O alias happened_at no 1º ramo é obrigatório: num UNION, o ORDER BY
  -- final resolve pelos nomes de coluna do primeiro SELECT.
  SELECT 'trophy'::text AS kind, pa.achievement_key AS trophy_key, a.rarity,
         NULL::bigint AS kudos_count, NULL::text AS game_title,
         NULL::jsonb AS voters,
         pa.awarded_at AS happened_at
  FROM player_achievements pa
  JOIN achievements a ON a.key = pa.achievement_key AND a.active
  JOIN me ON pa.user_id = me.id AND pa.awarded_at > me.seen
  UNION ALL
  -- LEFT JOIN de propósito: se quem deu o kudo apagou a conta, o kudo
  -- continua a contar e o cliente mostra "Jogador removido".
  SELECT 'kudos', NULL, NULL, COUNT(*)::bigint, g.title,
         COALESCE(
           jsonb_agg(
             jsonb_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url)
             ORDER BY p.name
           ) FILTER (WHERE p.id IS NOT NULL),
           '[]'::jsonb
         ),
         MAX(k.created_at)
  FROM mix_kudos k
  JOIN games g ON g.id = k.game_id
  JOIN me ON k.recipient_id = me.id AND k.created_at > me.seen
  LEFT JOIN profiles p ON p.id = k.voter_id
  GROUP BY g.id, g.title
  ORDER BY happened_at DESC;
$$;

REVOKE ALL ON FUNCTION get_unseen_celebrations() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_unseen_celebrations() TO authenticated;

COMMENT ON FUNCTION get_unseen_celebrations() IS
  'Troféus e kudos por ver desde celebrations_seen_at. O ramo dos kudos devolve, só a quem recebeu, quem deu (voters: id, name, avatar_url). Trello #340.';

-- ── Conferir depois de correr ────────────────────────────────────────────
-- Deve devolver a coluna voters no tipo de retorno:
-- SELECT pg_get_function_result(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'get_unseen_celebrations';
