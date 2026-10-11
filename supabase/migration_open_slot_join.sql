-- ═════════════════════════════════════════════════════════════════════════
-- Abrir um jogo a partir de um horário livre, com parceiro e nível
-- (Home do futuro, SPEC-4, ponto 4 — aprovado pelo Francisco a 9 out; plano
-- dos dados com o «okay» dele a 11 out; nível acertado com a UX a 11 out).
--
-- PORQUÊ. Na folha «Abrir um jogo no <clube>», quem abre escolhe com quem vai
-- (Sozinho · Com parceiro) e o nível do jogo («M3 (o teu)» · «M2» · «M4» ·
-- «Qualquer»). Hoje o ecrã só sabe entrar sozinho, e o nível fica o de quem
-- entra primeiro (lock_open_slot_level), sem perguntar.
--
-- O QUE FAZ
--   1. open_slot_join(p_game_id, p_level, p_partner_id): entra no jogo em
--      aberto, sozinho ou com parceiro (participants.partner_id, como no mix;
--      as regras de hoje valem: lotação, inscrição em dupla, idade, aprovar
--      quem entra — são os gatilhos de participants que as fazem). Se for o
--      1.º a entrar, o jogo fica com o nível escolhido: o seu ou um vizinho
--      (ex.: M3 → M2, M3 ou M4). NULL = «Qualquer»: o jogo fica sem nível.
--      Quem não é o 1.º entra no jogo como ele está (o nível é ignorado).
--   2. lock_open_slot_level (corpo VIVO, 1 troca; «já estava»): com
--      «Qualquer», a regra automática não põe o nível de quem entrou.
--      O resto da regra fica igual (quem entra pela app ou pelo robô sem
--      passar por aqui continua a deixar o seu nível).
--
-- ATENÇÃO: as faixas do nível (1800/1600/1400/1200/1000/700) estão escritas
-- aqui outra vez — manter iguais às do lock_open_slot_level e às da app
-- (src/lib/elo.js, ratingBand). Não há função que as dê (revisão do Dev 3).
--
-- Erros: not_allowed, not_open, not_member, bad_level, bad_partner,
-- already_in; e os dos gatilhos: game_full, pair_signup_disabled.
--
-- Dev 2, 11 out 2026 (a pedido do PO, combinado com o Dev 3).
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 2. «Qualquer»: a regra automática não põe o nível ───────────────────
DO $$
DECLARE
  c_anchor CONSTANT TEXT := 'IF v_origin != ''open_slot'' OR v_current_level IS NOT NULL THEN';
  v_def TEXT := pg_get_functiondef('public.lock_open_slot_level()'::regprocedure);
BEGIN
  IF v_def LIKE '%alinho.open_slot_any_level%' THEN
    RAISE NOTICE 'lock_open_slot_level: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 THEN
    RAISE EXCEPTION 'lock_open_slot_level: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := replace(v_def, c_anchor,
    'IF current_setting(''alinho.open_slot_any_level'', TRUE) = ''on'' THEN' || chr(10)
    || '    RETURN NEW; -- «Qualquer» (open_slot_join): o jogo fica sem nível' || chr(10)
    || '  END IF;' || chr(10) || chr(10) || '  ' || c_anchor);
  EXECUTE v_def;
END $$;

-- ── 1. Entrar num horário livre, com parceiro e nível ───────────────────
CREATE OR REPLACE FUNCTION public.open_slot_join(p_game_id UUID, p_level TEXT DEFAULT NULL, p_partner_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_me     UUID := auth.uid();
  g        games%ROWTYPE;
  v_first  BOOLEAN;
  v_rating NUMERIC;
  v_gender TEXT;
  v_num    INT;
  v_prefix TEXT;
  v_want   INT;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;

  SELECT * INTO g FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR g.origin IS DISTINCT FROM 'open_slot' OR g.status <> 'open' OR g.date <= NOW() THEN
    RAISE EXCEPTION 'not_open';
  END IF;
  -- As mesmas condições da política «Users can join games in their org».
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = g.organization_id AND m.user_id = v_me) THEN
    RAISE EXCEPTION 'not_member';
  END IF;
  IF NOT meets_age_restriction(v_me, g.age_restriction) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_partner_id IS NOT NULL THEN
    IF p_partner_id = v_me OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_partner_id)
       OR NOT meets_age_restriction(p_partner_id, g.age_restriction) THEN
      RAISE EXCEPTION 'bad_partner';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM participants p WHERE p.game_id = g.id
               AND (p.user_id IN (v_me, p_partner_id) OR p.partner_id IN (v_me, p_partner_id))) THEN
    RAISE EXCEPTION 'already_in';
  END IF;

  v_first := NOT EXISTS (SELECT 1 FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed');

  IF v_first THEN
    IF p_level IS NULL THEN
      -- «Qualquer»: o jogo fica sem nível, e a regra automática não entra.
      UPDATE games SET level = NULL, updated_at = NOW() WHERE id = g.id AND level IS NOT NULL;
      PERFORM set_config('alinho.open_slot_any_level', 'on', TRUE);
    ELSE
      -- O seu nível ou um vizinho, na mesma escala (a banda é a do
      -- lock_open_slot_level, que é a da app).
      SELECT rating, gender INTO v_rating, v_gender FROM profiles WHERE id = v_me;
      v_num := CASE
        WHEN v_rating >= 1800 THEN 1 WHEN v_rating >= 1600 THEN 2 WHEN v_rating >= 1400 THEN 3
        WHEN v_rating >= 1200 THEN 4 WHEN v_rating >= 1000 THEN 5 WHEN v_rating >= 700 THEN 6
        ELSE NULL END;
      v_prefix := CASE WHEN v_gender = 'feminino' THEN 'F' WHEN v_gender = 'masculino' THEN 'M' ELSE NULL END;
      IF v_num IS NULL OR v_prefix IS NULL OR p_level !~ ('^' || v_prefix || '[1-6]$') THEN
        RAISE EXCEPTION 'bad_level';
      END IF;
      v_want := substring(p_level FROM '[1-6]$')::INT;
      IF abs(v_want - v_num) > 1 THEN RAISE EXCEPTION 'bad_level'; END IF;
      UPDATE games SET level = p_level, updated_at = NOW() WHERE id = g.id;
    END IF;
  END IF;

  INSERT INTO participants (game_id, user_id, partner_id, status, joined_alone)
  VALUES (g.id, v_me, p_partner_id, 'confirmed', p_partner_id IS NULL);

  RETURN 'joined';
END;
$function$;

REVOKE ALL ON FUNCTION public.open_slot_join(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_slot_join(UUID, TEXT, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.lock_open_slot_level()'::regprocedure) LIKE '%alinho.open_slot_any_level%';  -- true
--   SELECT has_function_privilege('anon', 'public.open_slot_join(uuid,text,uuid)', 'EXECUTE');           -- false
--   SELECT has_function_privilege('authenticated', 'public.open_slot_join(uuid,text,uuid)', 'EXECUTE');  -- true
