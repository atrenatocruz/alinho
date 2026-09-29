-- ═════════════════════════════════════════════════════════════════════════
-- get_friend_match diz de que grupo é o jogo
--
-- PORQUÊ. #586, falha 3 do jogo de grupo (pedido do Bugs, confirmado pelo
-- PO a 28 set): no Editar de um jogo de grupo, juntar pessoas tem de
-- procurar só nos membros do grupo e mostrar «No <grupo>». O ecrã já está
-- no dev (1ab8420) e usa estes campos quando vierem.
--
-- O QUE FAZ. No objeto 'match' do get_friend_match entram organization_id,
-- organization_name, organization_slug e organization_kind (null num jogo entre amigos sem
-- grupo). Troca só esse fragmento no corpo VIVO (1 vez; «já estava»).
--
-- Dev 3, 28 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '(''teams_set_at'', m\.teams_set_at)';
  c_bom CONSTANT TEXT := '\1,
                ''organization_id'', m.organization_id,
                ''organization_name'', (SELECT og.name FROM organizations og WHERE og.id = m.organization_id),
                ''organization_slug'', (SELECT og.slug FROM organizations og WHERE og.id = m.organization_id)';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''organization_slug''%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- E o tipo: 'club' ou 'group' (Dev 2, 28 set: num clube o editar diz «jogo
-- em aberto»). À parte, para valer também se a parte de cima já correu.
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(''organization_slug'', \(SELECT og\.slug FROM organizations og WHERE og\.id = m\.organization_id\))';
  c_bom CONSTANT TEXT := '\1,
                ''organization_kind'', (SELECT og.kind FROM organizations og WHERE og.id = m.organization_id)';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''organization_kind''%' THEN
    RAISE NOTICE 'get_friend_match (tipo): já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: o organization_slug não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE ALL ON FUNCTION public.get_friend_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_friend_match(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_friend_match(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure) LIKE '%''organization_kind''%';  -- true
--   SELECT has_function_privilege('anon', 'public.get_friend_match(uuid)', 'EXECUTE');                         -- false
