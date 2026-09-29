-- ═════════════════════════════════════════════════════════════════════════
-- CONVIDADOS DO WHATSAPP: ENTRAM NO NÍVEL DO MIX, FICAM FORA DOS RANKINGS,
-- E O NÍVEL DE CONVIDADO PREVALECE NA FUSÃO (Ruben, 29 set 2026)
--
-- Hoje o bot cria o convidado a 900/900 — um número que ninguém escolheu.
-- Num mix M4 isso faz a dupla dele parecer fraca e distorce o rating dos
-- adversários (~5 pontos por jogo, sempre no mesmo sentido) até ele
-- calibrar. E o convidado aparecia nos rankings com «N» sem saber.
--
-- O QUE MUDA
--   1. guest_entry_rating(game, org): o ponto de partida do convidado.
--      Mix com nível (games.level, «M4»/«F5»/«MX6») → a âncora dessa banda,
--      a mesma que quem se regista escolhe (1→1900 … 6→850). Sem nível →
--      o MÍNIMO do rating dos inscritos com nível (sem convidados nem contas
--      de teste); senão o mínimo dos membros do clube; senão 900. É o mais
--      conservador que não distorce os outros. O bot chama-a ao criar o
--      convidado e guarda em rating E rating_anchor.
--   2. complete_rating_onboarding: subtrai a âncora antiga, não 900. Com
--      âncoras ≠ 900 a fórmula antiga dava pontos de borla no registo.
--   3. juntar_convidado: se o convidado tem 4+ jogos, a conta registada
--      fica com o rating, a âncora e os jogos do convidado — o nível que a
--      pessoa escolheu no registo é ignorado (era um reset de borla). Com
--      menos de 4, como antes: o que ganhou/perdeu soma-se ao nível
--      escolhido.
--   4. get_public_rankings: convidados do WhatsApp (email guest-…@) ficam
--      fora até criarem conta. get_global_rankings NÃO muda — é com ela que
--      a app forma as duplas e mostra os níveis dentro do mix.
--
-- As alterações 2, 3 e 4 são REMENDOS ao corpo vivo (pg_get_functiondef),
-- não reescritas: outras migrações mexem nas mesmas funções e assim não se
-- pisa nada. Cada remendo confirma que encontrou o que procurava; se não,
-- pára e diz.
--
-- Correr à mão no SQL Editor, DEPOIS de migration_537_confirmar_numero.sql,
-- migration_rankings_visiveis.sql e migration_niveis_mx.sql. O bot precisa
-- de redeploy (chama a RPC nova); até lá continua a criar a 900.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regprocedure('juntar_convidado(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_537_confirmar_numero.sql (juntar_convidado).';
  END IF;
  IF to_regprocedure('get_public_rankings()') IS NULL THEN
    RAISE EXCEPTION 'Falta migration_rankings_visiveis.sql (get_public_rankings).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'level') THEN
    RAISE EXCEPTION 'Falta games.level.';
  END IF;
END $$;

-- ── 1. guest_entry_rating ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION guest_entry_rating(p_game_id UUID, p_organization_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level TEXT;
  v_num   INTEGER;
  v_min   NUMERIC;
BEGIN
  -- a) o nível do mix, se tiver: a âncora dessa banda
  IF p_game_id IS NOT NULL THEN
    SELECT g.level INTO v_level FROM games g WHERE g.id = p_game_id;
    v_num := (regexp_match(COALESCE(v_level, ''), '^(?:MX|M|F)([1-6])$', 'i'))[1]::INTEGER;
    IF v_num IS NOT NULL THEN
      RETURN CASE v_num WHEN 1 THEN 1900 WHEN 2 THEN 1700 WHEN 3 THEN 1500
                        WHEN 4 THEN 1300 WHEN 5 THEN 1100 ELSE 850 END;
    END IF;

    -- b) o mínimo dos inscritos com nível (sem convidados nem contas de teste)
    SELECT MIN(pr.rating) INTO v_min
      FROM participants pa
      JOIN LATERAL (VALUES (pa.user_id), (pa.partner_id)) AS who(pid) ON who.pid IS NOT NULL
      JOIN profiles pr ON pr.id = who.pid
     WHERE pa.game_id = p_game_id
       AND COALESCE(pa.status, 'confirmed') <> 'out'
       AND pr.rating IS NOT NULL
       AND COALESCE(pr.is_test, FALSE) = FALSE
       AND pr.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
       AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = pr.id AND m.organization_id = p_organization_id AND m.is_guest);
    IF v_min IS NOT NULL THEN RETURN round(v_min); END IF;
  END IF;

  -- c) o mínimo dos membros do clube
  IF p_organization_id IS NOT NULL THEN
    SELECT MIN(pr.rating) INTO v_min
      FROM memberships m JOIN profiles pr ON pr.id = m.user_id
     WHERE m.organization_id = p_organization_id
       AND NOT m.is_guest AND COALESCE(m.is_test, FALSE) = FALSE
       AND pr.rating IS NOT NULL AND COALESCE(pr.is_test, FALSE) = FALSE;
    IF v_min IS NOT NULL THEN RETURN round(v_min); END IF;
  END IF;

  -- d) o de sempre
  RETURN 900;
END;
$$;
REVOKE ALL ON FUNCTION guest_entry_rating(UUID, UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION guest_entry_rating(UUID, UUID) TO service_role;

-- ── 2. complete_rating_onboarding: baseline = âncora antiga ────────────
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.complete_rating_onboarding(text)'::regprocedure);
  c_mau CONSTANT TEXT := 'GREATEST(0, v_anchor + (COALESCE(rating, 900) - 900))';
  c_bom CONSTANT TEXT := 'GREATEST(0, v_anchor + (COALESCE(rating, 900) - COALESCE(rating_anchor, 900)))';
BEGIN
  IF position(c_bom IN v_def) > 0 THEN
    RAISE NOTICE 'complete_rating_onboarding: já estava';
  ELSIF position(c_mau IN v_def) = 0 THEN
    RAISE EXCEPTION 'complete_rating_onboarding: não encontrei a fórmula do baseline 900. Ler o corpo vivo.';
  ELSE
    EXECUTE replace(v_def, c_mau, c_bom);
  END IF;
END $$;

-- ── 3. juntar_convidado: 4+ jogos → o nível do convidado prevalece ─────
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.juntar_convidado(uuid, uuid)'::regprocedure);
  -- as três expressões que decidem o nível da conta registada
  c_rating_mau  CONSTANT TEXT := 'CASE WHEN v_para.rating IS NULL THEN v_de.rating ELSE v_para.rating + v_delta END';
  c_rating_bom  CONSTANT TEXT := 'CASE WHEN v_de_prevalece THEN v_de.rating WHEN v_para.rating IS NULL THEN v_de.rating ELSE v_para.rating + v_delta END';
  c_anchor_mau  CONSTANT TEXT := 'COALESCE(v_para.rating_anchor, v_de.rating_anchor)';
  c_anchor_bom  CONSTANT TEXT := 'CASE WHEN v_de_prevalece THEN v_de.rating_anchor ELSE COALESCE(v_para.rating_anchor, v_de.rating_anchor) END';
  c_decl_mau    CONSTANT TEXT := E'  v_para   profiles%ROWTYPE;\n';
  c_decl_bom    CONSTANT TEXT := E'  v_para   profiles%ROWTYPE;\n  v_de_prevalece BOOLEAN := FALSE;  -- 4+ jogos como convidado: o nível dele manda (29 set)\n';
  c_set_mau     CONSTANT TEXT := 'ELSE v_de.rating - COALESCE(v_de.rating_anchor, 900) END;';
  c_set_bom     CONSTANT TEXT := E'ELSE v_de.rating - COALESCE(v_de.rating_anchor, 900) END;\n  v_de_prevalece := COALESCE(v_de.rating_games, 0) >= 4 AND v_de.rating IS NOT NULL;';
BEGIN
  IF position('v_de_prevalece' IN v_def) > 0 THEN
    RAISE NOTICE 'juntar_convidado: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_rating_mau, ''))) / length(c_rating_mau) < 2
     OR position(c_anchor_mau IN v_def) = 0
     OR position(c_decl_mau IN v_def) = 0
     OR position(c_set_mau IN v_def) = 0 THEN
    RAISE EXCEPTION 'juntar_convidado: o corpo vivo não é o esperado. Ler antes de remendar.';
  END IF;
  v_def := replace(v_def, c_rating_mau, c_rating_bom);
  v_def := replace(v_def, c_anchor_mau, c_anchor_bom);
  v_def := replace(v_def, c_decl_mau, c_decl_bom);
  v_def := replace(v_def, c_set_mau, c_set_bom);
  EXECUTE v_def;
END $$;

-- ── 4. get_public_rankings: sem convidados do WhatsApp ─────────────────
DO $$
DECLARE
  v_def TEXT := pg_get_functiondef('public.get_public_rankings()'::regprocedure);
  c_mau CONSTANT TEXT := E'   ORDER BY g.ordinality;';
  c_bom CONSTANT TEXT := E'     AND NOT EXISTS (\n     SELECT 1 FROM profiles p WHERE p.id = g.user_id AND p.email LIKE ''guest-%@whatsapp.alinho.pt''\n   )\n   ORDER BY g.ordinality;';
BEGIN
  IF position('guest-%@whatsapp.alinho.pt' IN v_def) > 0 THEN
    RAISE NOTICE 'get_public_rankings: já estava';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, 'ORDER BY g\.ordinality;', 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_public_rankings: não encontrei o ORDER BY. Ler o corpo vivo.';
  ELSE
    EXECUTE replace(v_def, c_mau, c_bom);
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- CONFIRMAR (só leitura)
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT guest_entry_rating(id, organization_id) FROM games WHERE level = 'M4' LIMIT 1;   -- 1300
--   SELECT guest_entry_rating(id, organization_id) FROM games WHERE level IS NULL LIMIT 1;  -- o mínimo dos inscritos
--   SELECT guest_entry_rating(NULL, NULL);                                                    -- 900
--   SELECT position('COALESCE(rating_anchor, 900)' IN pg_get_functiondef('complete_rating_onboarding(text)'::regprocedure)) > 0;  -- true
--   SELECT position('v_de_prevalece' IN pg_get_functiondef('juntar_convidado(uuid, uuid)'::regprocedure)) > 0;            -- true
--   SELECT position('guest-%' IN pg_get_functiondef('get_public_rankings()'::regprocedure)) > 0;                           -- true
--   SELECT count(*) FROM get_public_rankings() r WHERE (r->>'user_id')::uuid IN
--     (SELECT id FROM profiles WHERE email LIKE 'guest-%@whatsapp.alinho.pt');                                             -- 0
