-- ═════════════════════════════════════════════════════════════════════════
-- Professores podem não aparecer nos rankings (Renato, 29 set 2026).
--
-- «Os professores deveriam ter uma opção para não aparecerem no ranking,
-- tipo ficarem invisíveis.» Decidido com o Renato:
--   · onde: o ranking de pontos (Global / Masculino / Feminino e o do
--     clube), o de XP, e o «#N no ranking» do próprio perfil;
--   · quem liga: o próprio professor, no Perfil → Professor;
--   · os pontos continuam a mexer quando joga — só fica escondido. São
--     precisos para formar duplas equilibradas nos mixes.
--
-- COMO
--   · profiles.hide_from_rankings — a marca, desligada por omissão.
--   · Só conta para quem é PROFESSOR APROVADO (teacher_profiles, status
--     'approved', em qualquer clube). Um jogador que ligasse a marca por
--     fora não ficava escondido, e quem deixa de ser professor volta a
--     aparecer sozinho — a marca fica, mas deixa de contar.
--   · set_hide_from_rankings(bool) — o caminho da app; recusa quem não é
--     professor aprovado.
--   · ranking_hidden_user_ids() — quem está escondido agora, para o ecrã
--     filtrar as listas que monta sozinho (o ranking do clube e o do mês).
--   · get_public_rankings / get_public_xp_rankings (as listas que se
--     MOSTRAM, migration_rankings_visiveis.sql) deixam de os devolver. O
--     lugar no perfil vem da mesma lista, por isso some também.
--
-- O QUE NÃO MUDA
--   · get_global_rankings fica exatamente como está: é com ela que a app e o
--     bot formam as duplas (ver o cabeçalho de migration_rankings_visiveis
--     .sql). Tirar alguém de lá punha-o a valer 0 pontos na formação.
--   · As contas do Elo e do XP: o professor ganha e perde pontos como
--     qualquer jogador.
--
-- Seguro de correr mais do que uma vez. Precisa de migration_rankings_visiveis
-- .sql corrida antes (cria as duas funções que aqui se reescrevem).
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hide_from_rankings BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Quem está escondido agora ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ranking_hidden_user_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
    FROM profiles p
   WHERE p.hide_from_rankings
     AND EXISTS (
       SELECT 1 FROM teacher_profiles tp
        WHERE tp.user_id = p.id AND tp.status = 'approved'
     );
$$;
REVOKE ALL ON FUNCTION ranking_hidden_user_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION ranking_hidden_user_ids() TO authenticated;

-- ── Ligar / desligar (só o próprio, só professor aprovado) ───────────────
CREATE OR REPLACE FUNCTION set_hide_from_rankings(p_hide BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessão';
  END IF;
  IF p_hide AND NOT EXISTS (
    SELECT 1 FROM teacher_profiles WHERE user_id = auth.uid() AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Só professores aprovados podem esconder-se dos rankings';
  END IF;
  UPDATE profiles SET hide_from_rankings = COALESCE(p_hide, FALSE) WHERE id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION set_hide_from_rankings(BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION set_hide_from_rankings(BOOLEAN) TO authenticated;

-- ── O ranking que se mostra: sem contas de teste e sem quem se escondeu ──
CREATE OR REPLACE FUNCTION get_public_rankings()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(g) - 'ordinality'
    FROM get_global_rankings() WITH ORDINALITY AS g
   WHERE NOT EXISTS (
     SELECT 1 FROM memberships m WHERE m.user_id = g.user_id AND m.is_test
   )
     AND NOT EXISTS (
     SELECT 1 FROM profiles p WHERE p.id = g.user_id AND p.email LIKE '%@ensaio.alinho.test'
   )
     AND g.user_id NOT IN (SELECT ranking_hidden_user_ids())
   ORDER BY g.ordinality;
$$;
REVOKE ALL ON FUNCTION get_public_rankings() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_public_rankings() TO authenticated;

-- O de XP, só onde a get_xp_rankings existe (como na migração de origem).
DO $$
BEGIN
  IF to_regprocedure('get_xp_rankings(uuid)') IS NULL THEN
    RAISE NOTICE 'Sem get_xp_rankings nesta base de dados: get_public_xp_rankings não mexida.';
    RETURN;
  END IF;

  EXECUTE $f$
    CREATE OR REPLACE FUNCTION get_public_xp_rankings(p_organization_id UUID DEFAULT NULL)
    RETURNS SETOF jsonb
    LANGUAGE sql
    STABLE SECURITY DEFINER
    SET search_path = public
    AS $b$
      SELECT to_jsonb(x) - 'ordinality'
        FROM get_xp_rankings(p_organization_id) WITH ORDINALITY AS x
       WHERE NOT EXISTS (
         SELECT 1 FROM memberships m WHERE m.user_id = x.user_id AND m.is_test
       )
         AND NOT EXISTS (
         SELECT 1 FROM profiles p WHERE p.id = x.user_id AND p.email LIKE '%@ensaio.alinho.test'
       )
         AND x.user_id NOT IN (SELECT ranking_hidden_user_ids())
       ORDER BY x.ordinality;
    $b$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION get_public_xp_rankings(UUID) FROM public, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION get_public_xp_rankings(UUID) TO authenticated';
END $$;
