-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: categorias que chocam (#615)
--
-- PORQUÊ. SPEC design-handoff/2026-10-09-torneio-categorias-chocam (Francisco,
-- 9 out: «…é importante que o admin tb tenha essa visibilidade e possa tirar
-- a pessoa duma categoria»; e o MUDOU: «tem de ser verificado antes da
-- formação dos quadros»). Ecrãs: Dev 1 (nomes combinados com ele).
--
-- QUANDO HÁ CHOQUE (para uma pessoa com conta, em duas inscrições ativas
-- de categorias diferentes do mesmo torneio)
--   · 'near_start' (antes do sorteio de uma delas): as duas categorias
--     começam no mesmo dia com menos de 1 hora entre elas (inclui a mesma
--     hora). at_a / at_b = as horas de início.
--   · 'match_overlap' (as duas sorteadas): dois jogos dela, por jogar, a
--     menos da duração máxima de um jogo um do outro (rules.duration_max,
--     60 por omissão). at_a / at_b = as horas dos jogos.
--   Inscrições ativas: convite, sem_parceiro, por_validar, validada,
--   selecionada (suplentes e desistências não jogam).
--
-- O QUE FAZ
--   1. tournament_clash_rows (interna): todos os choques de um torneio.
--   2. my_category_clashes(p_tournament_id) → os meus; tournament_player
--      _clashes(p_tournament_id) → todos, com user_id e name (só quem
--      organiza). Campos: category_a, category_b, code_a, code_b,
--      entry_id_a, entry_id_b, kind, at_a, at_b.
--   3. admin_remove_player_from_entry(p_entry_id, p_user_id) → a pessoa sai
--      da inscrição; o parceiro fica «sem dupla» (passa para o 1.º lugar,
--      com a t-shirt dele). Sem parceiro, a inscrição fica 'desistiu'.
--      Avisos 'tournament_removed_clash' {tournament_*, category_code,
--      kept_code} e 'tournament_partner_removed' {tournament_*,
--      category_code, removed_name}. Erros: not_admin, entry_not_found,
--      not_in_entry, already_drawn (depois do sorteio usa-se o «Trocar
--      jogador», que já existe).
--   4. Antes do sorteio BLOQUEIA (exceção à regra «avisamos, não
--      bloqueamos», MUDOU de 9 out): close_category_entries e draw_category
--      recusam com 'has_clashes' enquanto a categoria tiver algum caso
--      'near_start' (corpo VIVO, 1 troca em cada; «já estava»). A inscrição
--      nunca é bloqueada.
--   5. Aviso 'tournament_clash' {tournament_*, code_a, code_b, at_a, at_b,
--      match_a, match_b} a quem joga, uma vez por choque, quando o horário
--      (ou o sorteio) cria um 'match_overlap'. Corre no fim da transação
--      (gatilho adiado), com o horário já todo gravado; nunca faz falhar a
--      gravação.
--
-- Dev 3, 12 out 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Os choques de um torneio ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_clash_rows(p_tournament_id UUID)
RETURNS TABLE(user_id UUID, category_a UUID, category_b UUID, code_a TEXT, code_b TEXT,
              entry_id_a UUID, entry_id_b UUID, kind TEXT, at_a TIMESTAMPTZ, at_b TIMESTAMPTZ,
              match_a UUID, match_b UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH pe AS (
    -- Cada pessoa com conta em cada inscrição ativa.
    SELECT x.uid, e.id AS entry_id, c.id AS cat, c.code, c.position, c.status AS cat_status,
           CASE WHEN c.day_date IS NOT NULL AND c.start_time IS NOT NULL
                THEN (c.day_date + c.start_time) AT TIME ZONE 'Europe/Lisbon' END AS starts
      FROM tournament_entries e
      JOIN tournament_categories c ON c.id = e.category_id
      CROSS JOIN LATERAL (VALUES (e.player1_id), (e.player2_id)) AS x(uid)
     WHERE c.tournament_id = p_tournament_id AND x.uid IS NOT NULL
       AND e.status IN ('convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada')
  ), pares AS (
    SELECT a.uid, a.entry_id AS ea, b.entry_id AS eb, a.cat AS ca, b.cat AS cb, a.code AS code_a, b.code AS code_b,
           a.starts AS sa, b.starts AS sb,
           (a.cat_status IN ('sorteada', 'a_decorrer', 'terminada') AND b.cat_status IN ('sorteada', 'a_decorrer', 'terminada')) AS ambas_sorteadas
      FROM pe a JOIN pe b ON b.uid = a.uid AND b.cat <> a.cat
                         AND (a.position, a.code) < (b.position, b.code)
  ), dur AS (
    SELECT COALESCE((rules->>'duration_max')::int, 60) AS mins FROM tournaments WHERE id = p_tournament_id
  )
  -- Antes do sorteio: as horas de início das categorias.
  SELECT p.uid, p.ca, p.cb, p.code_a, p.code_b, p.ea, p.eb, 'near_start', p.sa, p.sb, NULL::uuid, NULL::uuid
    FROM pares p
   WHERE NOT p.ambas_sorteadas AND p.sa IS NOT NULL AND p.sb IS NOT NULL
     AND (p.sa AT TIME ZONE 'Europe/Lisbon')::date = (p.sb AT TIME ZONE 'Europe/Lisbon')::date
     AND abs(extract(epoch FROM p.sa - p.sb)) < 3600
  UNION ALL
  -- Depois do sorteio: os jogos marcados.
  SELECT p.uid, p.ca, p.cb, p.code_a, p.code_b, p.ea, p.eb, 'match_overlap', ma.scheduled_at, mb.scheduled_at, ma.id, mb.id
    FROM pares p
    JOIN tournament_matches ma ON ma.category_id = p.ca AND p.ea IN (ma.entry_a_id, ma.entry_b_id)
         AND ma.scheduled_at IS NOT NULL AND ma.status NOT IN ('terminado', 'falta', 'desistencia')
    JOIN tournament_matches mb ON mb.category_id = p.cb AND p.eb IN (mb.entry_a_id, mb.entry_b_id)
         AND mb.scheduled_at IS NOT NULL AND mb.status NOT IN ('terminado', 'falta', 'desistencia')
   WHERE p.ambas_sorteadas
     AND abs(extract(epoch FROM ma.scheduled_at - mb.scheduled_at)) < (SELECT mins FROM dur) * 60;
$function$;
REVOKE ALL ON FUNCTION public.tournament_clash_rows(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. As listas ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_category_clashes(p_tournament_id UUID)
RETURNS TABLE(category_a UUID, category_b UUID, code_a TEXT, code_b TEXT, entry_id_a UUID, entry_id_b UUID,
              kind TEXT, at_a TIMESTAMPTZ, at_b TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT r.category_a, r.category_b, r.code_a, r.code_b, r.entry_id_a, r.entry_id_b, r.kind, r.at_a, r.at_b
    FROM tournament_clash_rows(p_tournament_id) r
   WHERE auth.uid() IS NOT NULL AND r.user_id = auth.uid()
   ORDER BY r.at_a, r.code_a, r.code_b;
$function$;
REVOKE ALL ON FUNCTION public.my_category_clashes(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_category_clashes(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.tournament_player_clashes(p_tournament_id UUID)
RETURNS TABLE(user_id UUID, name TEXT, category_a UUID, category_b UUID, code_a TEXT, code_b TEXT,
              entry_id_a UUID, entry_id_b UUID, kind TEXT, at_a TIMESTAMPTZ, at_b TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  RETURN QUERY
    SELECT r.user_id, p.name, r.category_a, r.category_b, r.code_a, r.code_b, r.entry_id_a, r.entry_id_b, r.kind, r.at_a, r.at_b
      FROM tournament_clash_rows(p_tournament_id) r
      JOIN profiles p ON p.id = r.user_id
     ORDER BY lower(p.name), r.at_a, r.code_a;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_player_clashes(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_player_clashes(UUID) TO authenticated;

-- ── 3. Tirar uma pessoa de uma categoria (antes do sorteio) ─────────────
CREATE OR REPLACE FUNCTION public.admin_remove_player_from_entry(p_entry_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_e       tournament_entries%ROWTYPE;
  v_c       tournament_categories%ROWTYPE;
  v_t       tournaments%ROWTYPE;
  v_partner UUID;
  v_kept    TEXT;
  v_result  TEXT;
BEGIN
  SELECT * INTO v_e FROM tournament_entries WHERE id = p_entry_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  SELECT * INTO v_c FROM tournament_categories WHERE id = v_e.category_id;
  SELECT * INTO v_t FROM tournaments WHERE id = v_c.tournament_id;
  IF NOT is_tournament_admin(v_t.id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_user_id IS NULL OR p_user_id NOT IN (v_e.player1_id, v_e.player2_id) OR v_e.status = 'desistiu' THEN
    RAISE EXCEPTION 'not_in_entry';
  END IF;
  -- Depois do sorteio tirar alguém parte o quadro: usa-se o «Trocar jogador».
  IF v_c.status IN ('sorteada', 'a_decorrer', 'terminada') THEN RAISE EXCEPTION 'already_drawn'; END IF;

  -- A categoria com que chocava (a da hora mais cedo), para o aviso.
  SELECT CASE WHEN r.entry_id_a = p_entry_id THEN r.code_b ELSE r.code_a END INTO v_kept
    FROM tournament_clash_rows(v_t.id) r
   WHERE r.user_id = p_user_id AND p_entry_id IN (r.entry_id_a, r.entry_id_b)
   ORDER BY LEAST(r.at_a, r.at_b) LIMIT 1;

  IF v_e.player1_id = p_user_id THEN
    v_partner := v_e.player2_id;
    IF v_e.player2_id IS NULL AND v_e.guest_name IS NULL THEN
      -- Estava sozinha: a inscrição sai.
      UPDATE tournament_entries SET status = 'desistiu' WHERE id = p_entry_id;
      v_result := 'desistiu';
    ELSE
      -- O parceiro passa para o 1.º lugar (com conta, ou o convidado pelo
      -- nome), com a t-shirt dele.
      UPDATE tournament_entries
         SET player1_id = v_e.player2_id,
             guest1_name = CASE WHEN v_e.player2_id IS NULL THEN v_e.guest_name END,
             guest1_email = CASE WHEN v_e.player2_id IS NULL THEN v_e.guest_email END,
             invite_token_player1 = CASE WHEN v_e.player2_id IS NULL THEN v_e.invite_token END,
             player1_tshirt = v_e.player2_tshirt,
             player2_id = NULL, guest_name = NULL, guest_email = NULL, guest_phone_hash = NULL,
             invite_token = NULL, invite_email_status = 'none', player2_tshirt = NULL,
             partner_accepted_at = NULL, respond_by = NULL, status = 'sem_parceiro'
       WHERE id = p_entry_id;
      v_result := 'sem_parceiro';
    END IF;
  ELSE
    v_partner := v_e.player1_id;
    UPDATE tournament_entries
       SET player2_id = NULL, guest_name = NULL, guest_email = NULL, guest_phone_hash = NULL,
           invite_token = NULL, invite_email_status = 'none', player2_tshirt = NULL,
           partner_accepted_at = NULL, respond_by = NULL, status = 'sem_parceiro'
     WHERE id = p_entry_id;
    v_result := 'sem_parceiro';
  END IF;

  INSERT INTO notifications (user_id, kind, actor_id, data)
  VALUES (p_user_id, 'tournament_removed_clash', auth.uid(),
          jsonb_build_object('tournament_id', v_t.id, 'tournament_slug', v_t.slug, 'tournament_name', v_t.name,
                             'category_code', v_c.code, 'kept_code', v_kept));
  IF v_partner IS NOT NULL THEN
    INSERT INTO notifications (user_id, kind, actor_id, data)
    VALUES (v_partner, 'tournament_partner_removed', auth.uid(),
            jsonb_build_object('tournament_id', v_t.id, 'tournament_slug', v_t.slug, 'tournament_name', v_t.name,
                               'category_code', v_c.code, 'removed_name', (SELECT name FROM profiles WHERE id = p_user_id)));
  END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_remove_player_from_entry(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_player_from_entry(UUID, UUID) TO authenticated;

-- ── 4. Antes do sorteio: bloqueia (corpo VIVO) ──────────────────────────
DO $$
DECLARE
  f      RECORD;
  v_def  TEXT;
  v_n    INTEGER;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.close_category_entries(uuid,uuid[],uuid[])',
     '  SELECT status, slots INTO v_status, v_slots FROM tournament_categories WHERE id = p_category_id;'),
    ('public.draw_category(uuid,jsonb)',
     '  -- A regra que protege o torneio a decorrer: depois do primeiro resultado')
  ) AS t(sig, mau) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF position('has_clashes' IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, f.mau, ''))) / length(f.mau);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar aparece % vez(es). Parar e ler.', f.sig, v_n;
    END IF;
    EXECUTE replace(v_def, f.mau,
         E'  -- Categorias que chocam (#615, Francisco 9 out): resolve-se antes de sortear.\n'
      || E'  IF EXISTS (SELECT 1 FROM tournament_clash_rows(v_tournament) x\n'
      || E'              WHERE x.kind = ''near_start'' AND p_category_id IN (x.category_a, x.category_b)) THEN\n'
      || E'    RAISE EXCEPTION ''has_clashes'';\n'
      || E'  END IF;\n\n'
      || f.mau);
  END LOOP;
END $$;

-- ── 5. Aviso no sino quando o horário cria um choque ────────────────────
CREATE OR REPLACE FUNCTION public.tournament_matches_notify_clash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_t tournaments%ROWTYPE;
BEGIN
  BEGIN
    SELECT t.* INTO v_t FROM tournaments t JOIN tournament_categories c ON c.tournament_id = t.id WHERE c.id = NEW.category_id;
    IF v_t.id IS NULL THEN RETURN NULL; END IF;
    INSERT INTO notifications (user_id, kind, data)
    SELECT r.user_id, 'tournament_clash',
           jsonb_build_object('tournament_id', v_t.id, 'tournament_slug', v_t.slug, 'tournament_name', v_t.name,
                              'code_a', r.code_a, 'code_b', r.code_b, 'at_a', r.at_a, 'at_b', r.at_b,
                              'match_a', r.match_a, 'match_b', r.match_b)
      FROM tournament_clash_rows(v_t.id) r
     WHERE r.kind = 'match_overlap' AND NEW.id IN (r.match_a, r.match_b)
       -- Uma vez por choque (os mesmos dois jogos às mesmas horas).
       AND NOT EXISTS (SELECT 1 FROM notifications n
                        WHERE n.user_id = r.user_id AND n.kind = 'tournament_clash'
                          AND n.data->>'match_a' = r.match_a::text AND n.data->>'match_b' = r.match_b::text
                          AND (n.data->>'at_a')::timestamptz = r.at_a AND (n.data->>'at_b')::timestamptz = r.at_b);
  EXCEPTION WHEN OTHERS THEN
    -- O aviso nunca faz falhar o horário.
    RAISE WARNING 'tournament_matches_notify_clash (%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_matches_notify_clash() FROM PUBLIC, anon, authenticated;

-- Adiado: corre no fim da transação, com o horário todo gravado (o
-- save_match_schedule grava jogo a jogo; um choque a meio não conta).
DROP TRIGGER IF EXISTS tournament_matches_notify_clash ON tournament_matches;
CREATE CONSTRAINT TRIGGER tournament_matches_notify_clash
  AFTER INSERT OR UPDATE OF scheduled_at ON tournament_matches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.scheduled_at IS NOT NULL)
  EXECUTE FUNCTION tournament_matches_notify_clash();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('close_category_entries', 'draw_category') AND pg_get_functiondef(oid) LIKE '%has_clashes%';  -- 2
--   SELECT has_function_privilege('anon', 'public.tournament_player_clashes(uuid)', 'EXECUTE');  -- false
