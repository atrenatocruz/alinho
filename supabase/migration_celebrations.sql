-- ════════════════════════════════════════════════════════════════════════
-- Celebrações in-app (spec 2026-09-09, decisão: SEM DMs do bot)
--
-- Ao abrir a app, o jogador vê um modal com o que ganhou desde a última
-- visita: troféus novos e kudos recebidos. O "visto" é um timestamp em
-- profiles; a leitura é um RPC que junta os dois feeds.
--
-- Contas existentes são carimbadas com NOW() — ninguém é inundado com o
-- histórico do backfill; só eventos novos notificam. Contas novas ficam
-- NULL (= tudo é novidade, e a primeira Primeira Bola celebra-se).
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS celebrations_seen_at TIMESTAMPTZ;

UPDATE profiles SET celebrations_seen_at = TIMEZONE('utc', NOW())
WHERE celebrations_seen_at IS NULL;

-- (coluna nova fica read-only para o cliente por omissão — os grants por
-- coluna de migration_fix_profiles_column_grants.sql tratam disso; a
-- escrita é só via RPC abaixo.)

-- ── O que há de novo para mim ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_unseen_celebrations()
RETURNS TABLE (kind TEXT, trophy_key TEXT, rarity TEXT, kudos_count BIGINT, game_title TEXT, happened_at TIMESTAMPTZ)
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
  SELECT 'trophy'::text AS kind, pt.trophy_key, t.rarity,
         NULL::bigint AS kudos_count, NULL::text AS game_title,
         pt.awarded_at AS happened_at
  FROM player_trophies pt
  JOIN trophies t ON t.key = pt.trophy_key AND t.active
  JOIN me ON pt.user_id = me.id AND pt.awarded_at > me.seen
  UNION ALL
  SELECT 'kudos', NULL, NULL, COUNT(*)::bigint, g.title, MAX(k.created_at)
  FROM mix_kudos k
  JOIN games g ON g.id = k.game_id
  JOIN me ON k.recipient_id = me.id AND k.created_at > me.seen
  GROUP BY g.id, g.title
  ORDER BY happened_at DESC;
$$;

REVOKE ALL ON FUNCTION get_unseen_celebrations() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_unseen_celebrations() TO authenticated;

-- ── Marcar como visto ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION mark_celebrations_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles SET celebrations_seen_at = TIMEZONE('utc', NOW())
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION mark_celebrations_seen() FROM public, anon;
GRANT EXECUTE ON FUNCTION mark_celebrations_seen() TO authenticated;
