-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: refeição escolhida na inscrição, como a t-shirt (Trello #799)
--
-- PORQUÊ. Francisco, 11 nov: «Sim temos de ter isso asap». Para o 1.º
-- Torneio +1 (28 nov): só torneio 15 €, com refeição +10 €, com t-shirt
-- +10 €. SPEC da UX: design-handoff/2026-11-11-torneio-refeicao/SPEC.md.
-- Faz o mesmo caminho da t-shirt (migration_torneio_t_shirts.sql,
-- _t_shirt_por_pessoa.sql e _tshirt_preco_so_aceites.sql), sem tamanhos.
-- Ecrãs: Dev 1. Nomes combinados com ele a 11 nov.
--
-- O QUE FAZ
--   1. tournaments.rules.meal = { mode: 'none'|'gift'|'sale', price_cents,
--      description }. Grava-se pelo create_tournament / update_tournament
--      de hoje (já juntam rules). Um gatilho valida: mode é um dos três;
--      'sale' tem price_cents inteiro >= 0; description, se houver, é
--      texto de até 80 caracteres.
--   2. tournament_entries.player1_meal / player2_meal (boolean): NULL =
--      ainda não respondeu · true = sim · false = não. Uma resposta por
--      pessoa com conta no torneio (herda e espalha-se pelas inscrições
--      ativas dela, como a t-shirt); o convidado sem conta fica por
--      inscrição. Mudar a pessoa de um lugar apaga a resposta desse lugar;
--      torneio sem refeição não guarda nada.
--   3. Parâmetros novos, no fim e opcionais (DROP + CREATE do corpo VIVO):
--      tournament_signup(…, p_player1_meal, p_player2_meal): o 2.º só conta
--        para o parceiro sem conta (quem tem conta responde ao aceitar);
--      tournament_admin_signup(…, p_player1_meal, p_player2_meal);
--      tournament_respond_invite(…, p_meal).
--      A app antiga chama com os nomes de hoje e continua a funcionar.
--   4. Novas:
--      set_my_tournament_meal(p_entry_id, p_meal, p_for_guest DEFAULT false)
--        → a resposta. O próprio, até as inscrições fecharem. Com
--        p_for_guest, quem inscreveu responde pelo parceiro sem conta.
--        Erros: entry_not_found, no_meal, entries_closed, bad_meal.
--      admin_set_tournament_meal(p_entry_id, p_slot 1|2, p_meal) → a
--        resposta. Só quem organiza, sem prazo. Erros: not_admin,
--        no_player, no_meal, bad_meal.
--      tournament_meal_counts(p_tournament_id) → { mode, price_cents,
--        description, yes, no, pending } — conta pessoas, das categorias
--        todas, só inscrições que ocupam lugar e convites já aceites.
--      tournament_meal_people(p_tournament_id) → [{ user_id, name,
--        category_codes[], entry_ids[], slots[], meal }] por nome.
--      tournament_player_meal(p_tournament_id, p_user_id) → { chosen, meal }
--        (a resposta só a vê o próprio ou quem organiza).
--   5. Leituras: list_tournament_entries traz player1_meal e player2_meal;
--      list_my_tournament_invites traz meal (a do torneio) e my_meal; a
--      página do torneio traz tournament.meal e, em my e my_entries, meal
--      e guest_meal. admin_remove_player_from_entry leva a resposta do
--      parceiro para o 1.º lugar, como a t-shirt.
--
-- ORDEM. Não depende de outras por correr. Pode correr antes ou depois dos
-- ecrãs do Dev 1: sem rules.meal, nada muda para ninguém.
--
-- Dev 3, 11 nov 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Colunas ──────────────────────────────────────────────────────────
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS player1_meal BOOLEAN;
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS player2_meal BOOLEAN;

-- ── 2. A refeição do torneio ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournaments_meal_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_m JSONB := NEW.rules->'meal';
BEGIN
  IF v_m IS NULL OR jsonb_typeof(v_m) = 'null' THEN RETURN NEW; END IF;
  IF jsonb_typeof(v_m) <> 'object' OR COALESCE(v_m->>'mode', '') NOT IN ('none', 'gift', 'sale') THEN
    RAISE EXCEPTION 'bad_meal';
  END IF;
  -- Cada passo à parte: com um campo em falta, um «OR» dava NULL e deixava
  -- passar (a lição da t-shirt).
  IF v_m->>'mode' = 'sale' THEN
    IF COALESCE(jsonb_typeof(v_m->'price_cents'), '') <> 'number' THEN RAISE EXCEPTION 'bad_meal'; END IF;
    IF (v_m->>'price_cents')::numeric < 0 OR (v_m->>'price_cents')::numeric <> trunc((v_m->>'price_cents')::numeric) THEN
      RAISE EXCEPTION 'bad_meal';
    END IF;
  END IF;
  IF v_m ? 'description' AND jsonb_typeof(v_m->'description') <> 'null' THEN
    IF jsonb_typeof(v_m->'description') <> 'string' THEN RAISE EXCEPTION 'bad_meal'; END IF;
    IF char_length(v_m->>'description') > 80 THEN RAISE EXCEPTION 'bad_meal'; END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournaments_meal_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tournaments_meal_check ON tournaments;
CREATE TRIGGER tournaments_meal_check
  BEFORE INSERT OR UPDATE OF rules ON tournaments
  FOR EACH ROW EXECUTE FUNCTION tournaments_meal_check();

-- O torneio tem refeição (incluída ou à parte)?
CREATE OR REPLACE FUNCTION public.tournament_meal_offer(p_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM tournaments t
                  WHERE t.id = p_tournament_id AND t.rules->'meal'->>'mode' IN ('gift', 'sale'));
$function$;
REVOKE ALL ON FUNCTION public.tournament_meal_offer(UUID) FROM PUBLIC, anon, authenticated;

-- A resposta que a pessoa já deu neste torneio (fora da inscrição p_skip).
-- Um convite que ela ainda não aceitou não conta (PO, 13 out, como a t-shirt).
CREATE OR REPLACE FUNCTION public.tournament_person_meal(p_tournament_id UUID, p_user UUID, p_skip UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT x.meal FROM (
    SELECT CASE WHEN e.player1_id = p_user THEN e.player1_meal ELSE e.player2_meal END AS meal, e.created_at
      FROM tournament_entries e
      JOIN tournament_categories c ON c.id = e.category_id
     WHERE c.tournament_id = p_tournament_id AND e.status <> 'desistiu'
       AND e.id IS DISTINCT FROM p_skip
       AND (e.player1_id = p_user OR (e.player2_id = p_user AND e.status <> 'convite'))
      ) x
   WHERE x.meal IS NOT NULL
   ORDER BY x.created_at
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.tournament_person_meal(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. A resposta de cada um ────────────────────────────────────────────
-- Antes de gravar: limpar quando muda a pessoa, herdar, e nada sem refeição.
CREATE OR REPLACE FUNCTION public.tournament_entries_meal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tour UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Mudou a pessoa daquele lugar: a resposta era da outra. Quem fica com o
    -- lugar pelo link (sem conta → com conta) é a mesma pessoa e mantém-na.
    IF NEW.player1_meal IS NOT DISTINCT FROM OLD.player1_meal
       AND ((OLD.player1_id IS NOT NULL AND NEW.player1_id IS DISTINCT FROM OLD.player1_id)
         OR (OLD.player1_id IS NULL AND NEW.player1_id IS NULL AND NEW.guest1_name IS DISTINCT FROM OLD.guest1_name)) THEN
      NEW.player1_meal := NULL;
    END IF;
    IF NEW.player2_meal IS NOT DISTINCT FROM OLD.player2_meal
       AND ((OLD.player2_id IS NOT NULL AND NEW.player2_id IS DISTINCT FROM OLD.player2_id)
         OR (OLD.player2_id IS NULL AND NEW.player2_id IS NULL AND NEW.guest_name IS DISTINCT FROM OLD.guest_name)) THEN
      NEW.player2_meal := NULL;
    END IF;
    -- Um lugar vazio não tem resposta.
    IF NEW.player2_id IS NULL AND NEW.guest_name IS NULL THEN
      NEW.player2_meal := NULL;
    END IF;
  END IF;

  SELECT c.tournament_id INTO v_tour FROM tournament_categories c WHERE c.id = NEW.category_id;
  IF NOT tournament_meal_offer(v_tour) THEN
    -- Torneio sem refeição: não se guarda nada.
    NEW.player1_meal := NULL;
    NEW.player2_meal := NULL;
    RETURN NEW;
  END IF;

  -- Uma resposta por pessoa no torneio: sem resposta aqui, herda a que a
  -- pessoa já deu noutra inscrição ativa do mesmo torneio.
  IF NEW.status <> 'desistiu' AND NEW.player1_id IS NOT NULL AND NEW.player1_meal IS NULL THEN
    NEW.player1_meal := tournament_person_meal(v_tour, NEW.player1_id, NEW.id);
  END IF;
  IF NEW.status <> 'desistiu' AND NEW.player2_id IS NOT NULL AND NEW.player2_meal IS NULL THEN
    NEW.player2_meal := tournament_person_meal(v_tour, NEW.player2_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_entries_meal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_entries_meal ON tournament_entries;
CREATE TRIGGER tournament_entries_meal
  BEFORE INSERT OR UPDATE ON tournament_entries
  FOR EACH ROW EXECUTE FUNCTION tournament_entries_meal();

-- Depois de gravar: a mesma resposta nas outras inscrições da pessoa.
CREATE OR REPLACE FUNCTION public.tournament_entries_meal_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tour UUID;
  s      RECORD;
BEGIN
  IF NEW.status = 'desistiu' THEN RETURN NULL; END IF;
  SELECT tournament_id INTO v_tour FROM tournament_categories WHERE id = NEW.category_id;
  FOR s IN SELECT * FROM (VALUES
      (NEW.player1_id, NEW.player1_meal, CASE WHEN TG_OP = 'UPDATE' THEN OLD.player1_meal END),
      (NEW.player2_id, NEW.player2_meal, CASE WHEN TG_OP = 'UPDATE' THEN OLD.player2_meal END)) AS t(u, v, antes)
  LOOP
    -- Só uma resposta dada se espalha; um lugar que ficou vazio (mudou a
    -- pessoa) não apaga o que ela respondeu nas outras inscrições.
    CONTINUE WHEN s.u IS NULL OR s.v IS NULL OR s.v IS NOT DISTINCT FROM s.antes;
    UPDATE tournament_entries e SET player1_meal = s.v
     WHERE e.id <> NEW.id AND e.player1_id = s.u AND e.status <> 'desistiu'
       AND e.category_id IN (SELECT id FROM tournament_categories WHERE tournament_id = v_tour)
       AND e.player1_meal IS DISTINCT FROM s.v;
    UPDATE tournament_entries e SET player2_meal = s.v
     WHERE e.id <> NEW.id AND e.player2_id = s.u AND e.status <> 'desistiu'
       AND e.category_id IN (SELECT id FROM tournament_categories WHERE tournament_id = v_tour)
       AND e.player2_meal IS DISTINCT FROM s.v;
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_entries_meal_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_entries_meal_sync ON tournament_entries;
CREATE TRIGGER tournament_entries_meal_sync
  AFTER INSERT OR UPDATE OF player1_meal, player2_meal ON tournament_entries
  FOR EACH ROW EXECUTE FUNCTION tournament_entries_meal_sync();

-- ── 4. Inscrever, aceitar e tirar alguém (corpo VIVO) ───────────────────
-- Trocas literais, cada uma contada antes; marca «refeição no torneio (#799)».
DO $patch$
DECLARE
  c_marca CONSTANT TEXT := 'refeição no torneio (#799)';
  f       RECORD;
  r       RECORD;
  v_def   TEXT;
  v_n     INT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      (1, 'public.tournament_signup(uuid,uuid,text,text,text,text,text,text)', TRUE),
      (2, 'public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text,boolean)', TRUE),
      (3, 'public.tournament_respond_invite(uuid,boolean,text)', TRUE),
      (4, 'public.admin_remove_player_from_entry(uuid,uuid)', FALSE)
    ) AS t(n, sig, muda_assinatura)
    ORDER BY n
  LOOP
    IF to_regprocedure(f.sig) IS NULL THEN
      -- Já corrida: a assinatura antiga deixou de existir.
      RAISE NOTICE '%: já estava (assinatura antiga não existe)', f.sig;
      CONTINUE;
    END IF;
    v_def := replace(pg_get_functiondef(f.sig::regprocedure), E'\r', '');
    IF position(c_marca IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;

    FOR r IN SELECT * FROM (VALUES
        -- tournament_signup
        (1, 1, $a$p_partner_gender text DEFAULT NULL::text)
 RETURNS$a$,
            $a$p_partner_gender text DEFAULT NULL::text, p_player1_meal boolean DEFAULT NULL::boolean, p_player2_meal boolean DEFAULT NULL::boolean)
 RETURNS$a$),
        (1, 1, $a$  RETURN jsonb_build_object('entry_id', v_id, 'status', v_status, 'invite_token', v_token);
$a$,
            $a$  -- Refeição: a minha, e a do parceiro sem conta (quem tem conta
  -- responde ao aceitar). refeição no torneio (#799)
  IF p_player1_meal IS NOT NULL OR (p_partner_id IS NULL AND p_player2_meal IS NOT NULL) THEN
    UPDATE tournament_entries
       SET player1_meal = COALESCE(p_player1_meal, player1_meal),
           player2_meal = CASE WHEN p_partner_id IS NULL AND guest_name IS NOT NULL
                               THEN COALESCE(p_player2_meal, player2_meal) END
     WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object('entry_id', v_id, 'status', v_status, 'invite_token', v_token);
$a$),
        -- tournament_admin_signup
        (2, 1, $a$p_force_gender boolean DEFAULT false)
 RETURNS$a$,
            $a$p_force_gender boolean DEFAULT false, p_player1_meal boolean DEFAULT NULL::boolean, p_player2_meal boolean DEFAULT NULL::boolean)
 RETURNS$a$),
        (2, 1, $a$  RETURN jsonb_build_object('entry_id', v_id, 'status', v_status, 'invite_token', v_token, 'invite_token_player1', v_token1);
$a$,
            $a$  -- Refeição: quem organiza responde pelos dois. refeição no torneio (#799)
  IF p_player1_meal IS NOT NULL OR p_player2_meal IS NOT NULL THEN
    UPDATE tournament_entries
       SET player1_meal = COALESCE(p_player1_meal, player1_meal),
           player2_meal = CASE WHEN player2_id IS NOT NULL OR guest_name IS NOT NULL
                               THEN COALESCE(p_player2_meal, player2_meal) END
     WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object('entry_id', v_id, 'status', v_status, 'invite_token', v_token, 'invite_token_player1', v_token1);
$a$),
        -- tournament_respond_invite
        (3, 1, $a$p_tshirt text DEFAULT NULL::text)
 RETURNS$a$,
            $a$p_tshirt text DEFAULT NULL::text, p_meal boolean DEFAULT NULL::boolean)
 RETURNS$a$),
        (3, 1, $a$partner_accepted_at = NOW(), player2_tshirt = p_tshirt
$a$,
            $a$partner_accepted_at = NOW(), player2_tshirt = p_tshirt,
           player2_meal = p_meal  -- refeição no torneio (#799): sem resposta, herda
$a$),
        -- admin_remove_player_from_entry
        (4, 1, $a$             player1_tshirt = v_e.player2_tshirt,
$a$,
            $a$             player1_tshirt = v_e.player2_tshirt,
             player1_meal = v_e.player2_meal,  -- refeição no torneio (#799)
$a$),
        (4, 2, $a$invite_email_status = 'none', player2_tshirt = NULL,
$a$,
            $a$invite_email_status = 'none', player2_tshirt = NULL, player2_meal = NULL,
$a$)
      ) AS x(fn, vezes, old_txt, new_txt)
      WHERE x.fn = f.n
    LOOP
      v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
      IF v_n <> r.vezes THEN
        RAISE EXCEPTION '%: esperava % vez(es) «%», encontrei %. Parar e ler.', f.sig, r.vezes, left(r.old_txt, 60), v_n;
      END IF;
      v_def := replace(v_def, r.old_txt, r.new_txt);
    END LOOP;

    IF position(c_marca IN v_def) = 0 THEN
      RAISE EXCEPTION '%: a troca não ficou. Parar e ler.', f.sig;
    END IF;
    IF f.muda_assinatura THEN
      EXECUTE 'DROP FUNCTION ' || f.sig;
    END IF;
    EXECUTE v_def;
  END LOOP;
END $patch$;

-- DROP + CREATE dá EXECUTE a PUBLIC: voltar aos acessos de hoje.
REVOKE ALL ON FUNCTION public.tournament_signup(uuid,uuid,text,text,text,text,text,text,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_signup(uuid,uuid,text,text,text,text,text,text,boolean,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text,boolean,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text,boolean,boolean,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tournament_respond_invite(uuid,boolean,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_respond_invite(uuid,boolean,text,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_remove_player_from_entry(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_player_from_entry(uuid,uuid) TO authenticated, service_role;

-- ── 5. Leituras (corpo VIVO) ────────────────────────────────────────────
DO $patch$
DECLARE
  c_marca CONSTANT TEXT := 'refeição no torneio (#799)';
  f       RECORD;
  r       RECORD;
  v_def   TEXT;
  v_n     INT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      (1, 'public.list_tournament_entries(uuid)', TRUE),
      (2, 'public.list_my_tournament_invites()', TRUE),
      (3, 'public.tournament_page_json(uuid,boolean)', FALSE)
    ) AS t(n, sig, muda_retorno)
    ORDER BY n
  LOOP
    v_def := replace(pg_get_functiondef(f.sig::regprocedure), E'\r', '');
    IF position(c_marca IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;

    FOR r IN SELECT * FROM (VALUES
        -- list_tournament_entries
        (1, 1, $a$player1_tshirt text, player2_tshirt text)$a$,
               $a$player1_tshirt text, player2_tshirt text, player1_meal boolean, player2_meal boolean)$a$),
        (1, 1, $a$e.respond_by, e.player1_tshirt, e.player2_tshirt$a$,
               $a$e.respond_by, e.player1_tshirt, e.player2_tshirt, e.player1_meal, e.player2_meal  -- refeição no torneio (#799)
$a$),
        -- list_my_tournament_invites
        (2, 1, $a$tshirt jsonb, my_tshirt text)$a$,
               $a$tshirt jsonb, my_tshirt text, meal jsonb, my_meal boolean)$a$),
        (2, 1, $a$tournament_person_tshirt(t.id, auth.uid(), e.id)$a$,
               $a$tournament_person_tshirt(t.id, auth.uid(), e.id),
         -- refeição no torneio (#799)
         CASE WHEN t.rules->'meal'->>'mode' IN ('gift', 'sale') THEN t.rules->'meal' END,
         tournament_person_meal(t.id, auth.uid(), e.id)$a$),
        -- tournament_page_json
        (3, 1, $a$THEN t.rules->'tshirt' END AS tshirt,$a$,
               $a$THEN t.rules->'tshirt' END AS tshirt,
               -- refeição no torneio (#799)
               CASE WHEN t.rules->'meal'->>'mode' IN ('gift', 'sale') THEN t.rules->'meal' END AS meal,$a$),
        (3, 2, $a$THEN e.player2_tshirt END AS guest_tshirt$a$,
               $a$THEN e.player2_tshirt END AS guest_tshirt, CASE WHEN e.player1_id = auth.uid() THEN e.player1_meal ELSE e.player2_meal END AS meal, CASE WHEN e.player1_id = auth.uid() AND e.player2_id IS NULL AND e.guest_name IS NOT NULL THEN e.player2_meal END AS guest_meal$a$)
      ) AS x(fn, vezes, old_txt, new_txt)
      WHERE x.fn = f.n
    LOOP
      v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
      IF v_n <> r.vezes THEN
        RAISE EXCEPTION '%: esperava % vez(es) «%», encontrei %. Parar e ler.', f.sig, r.vezes, left(r.old_txt, 60), v_n;
      END IF;
      v_def := replace(v_def, r.old_txt, r.new_txt);
    END LOOP;

    IF position(c_marca IN v_def) = 0 THEN
      RAISE EXCEPTION '%: a troca não ficou. Parar e ler.', f.sig;
    END IF;
    IF f.muda_retorno THEN
      EXECUTE 'DROP FUNCTION ' || f.sig;
    END IF;
    EXECUTE v_def;
  END LOOP;
END $patch$;

REVOKE ALL ON FUNCTION public.list_tournament_entries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tournament_entries(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_tournament_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_tournament_invites() TO authenticated, service_role;
-- tournament_page_json: CREATE OR REPLACE mantém os acessos de hoje.

-- ── 6. Mudar a resposta ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_my_tournament_meal(p_entry_id UUID, p_meal BOOLEAN, p_for_guest BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_me    UUID := auth.uid();
  v_e     tournament_entries%ROWTYPE;
  v_t     tournaments%ROWTYPE;
  v_cat   TEXT;
  v_slot  INTEGER;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_meal IS NULL THEN RAISE EXCEPTION 'bad_meal'; END IF;
  SELECT * INTO v_e FROM tournament_entries
   WHERE id = p_entry_id AND status <> 'desistiu' AND v_me IN (player1_id, player2_id) FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'entry_not_found'; END IF;

  IF p_for_guest THEN
    -- O parceiro sem conta: é quem inscreveu que responde por ele.
    IF v_e.player1_id IS DISTINCT FROM v_me OR v_e.player2_id IS NOT NULL OR v_e.guest_name IS NULL THEN
      RAISE EXCEPTION 'entry_not_found';
    END IF;
    v_slot := 2;
  ELSE
    v_slot := CASE WHEN v_e.player1_id = v_me THEN 1 ELSE 2 END;
  END IF;

  SELECT c.status INTO v_cat FROM tournament_categories c WHERE c.id = v_e.category_id;
  SELECT t.* INTO v_t FROM tournaments t JOIN tournament_categories c ON c.tournament_id = t.id WHERE c.id = v_e.category_id;
  IF NOT tournament_meal_offer(v_t.id) THEN RAISE EXCEPTION 'no_meal'; END IF;
  IF v_t.status IN ('cancelado', 'terminado') OR v_cat <> 'inscricoes'
     OR (v_t.entries_deadline IS NOT NULL AND v_t.entries_deadline < NOW()) THEN
    RAISE EXCEPTION 'entries_closed';
  END IF;

  IF v_slot = 1 THEN
    UPDATE tournament_entries SET player1_meal = p_meal WHERE id = p_entry_id;
  ELSE
    UPDATE tournament_entries SET player2_meal = p_meal WHERE id = p_entry_id;
  END IF;
  RETURN p_meal;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_my_tournament_meal(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_tournament_meal(UUID, BOOLEAN, BOOLEAN) TO authenticated, service_role;

-- Quem organiza muda a resposta de qualquer um, mesmo depois do prazo
-- (SPEC, ponto 5).
CREATE OR REPLACE FUNCTION public.admin_set_tournament_meal(p_entry_id UUID, p_slot INTEGER, p_meal BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_e  tournament_entries%ROWTYPE;
  v_t  UUID;
BEGIN
  SELECT * INTO v_e FROM tournament_entries WHERE id = p_entry_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  SELECT tournament_id INTO v_t FROM tournament_categories WHERE id = v_e.category_id;
  IF NOT is_tournament_admin(v_t) THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF NOT tournament_meal_offer(v_t) THEN RAISE EXCEPTION 'no_meal'; END IF;
  IF p_meal IS NULL THEN RAISE EXCEPTION 'bad_meal'; END IF;
  IF p_slot = 1 THEN
    UPDATE tournament_entries SET player1_meal = p_meal WHERE id = p_entry_id;
  ELSIF p_slot = 2 AND (v_e.player2_id IS NOT NULL OR v_e.guest_name IS NOT NULL) THEN
    UPDATE tournament_entries SET player2_meal = p_meal WHERE id = p_entry_id;
  ELSE
    RAISE EXCEPTION 'no_player';
  END IF;
  RETURN p_meal;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_tournament_meal(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tournament_meal(UUID, INTEGER, BOOLEAN) TO authenticated, service_role;

-- ── 7. A contagem e a lista de quem organiza ────────────────────────────
-- As pessoas que contam: as das inscrições que ocupam lugar; o convidado
-- de um convite ainda por aceitar não conta (PO, 13 out).
CREATE OR REPLACE FUNCTION public.tournament_meal_rows(p_tournament_id UUID)
RETURNS TABLE(entry_id UUID, slot INTEGER, user_id UUID, name TEXT, category_code TEXT, category_position INTEGER, meal BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT e.id, 1, e.player1_id, COALESCE(p1.name, e.guest1_name), c.code, c.position, e.player1_meal
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    LEFT JOIN profiles p1 ON p1.id = e.player1_id
   WHERE c.tournament_id = p_tournament_id
     AND e.status IN ('convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada')
  UNION ALL
  SELECT e.id, 2, e.player2_id, COALESCE(p2.name, e.guest_name), c.code, c.position, e.player2_meal
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    LEFT JOIN profiles p2 ON p2.id = e.player2_id
   WHERE c.tournament_id = p_tournament_id
     AND e.status IN ('sem_parceiro', 'por_validar', 'validada', 'selecionada')
     AND (e.player2_id IS NOT NULL OR e.guest_name IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION public.tournament_meal_rows(UUID) FROM PUBLIC, anon, authenticated;

-- Uma linha por pessoa: com conta, junta as inscrições; sem conta, cada uma.
CREATE OR REPLACE FUNCTION public.tournament_meal_persons(p_tournament_id UUID)
RETURNS TABLE(user_id UUID, name TEXT, category_codes TEXT[], entry_ids UUID[], slots INTEGER[], meal BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT max(r.user_id::text)::uuid, min(r.name),
         array_agg(r.category_code ORDER BY r.category_position, r.category_code),
         array_agg(r.entry_id ORDER BY r.category_position, r.category_code),
         array_agg(r.slot ORDER BY r.category_position, r.category_code),
         -- Com o gatilho é igual em todas; se não for, vale um «sim».
         bool_or(r.meal)
    FROM tournament_meal_rows(p_tournament_id) r
   GROUP BY COALESCE(r.user_id::text, r.entry_id::text || ':' || r.slot);
$function$;
REVOKE ALL ON FUNCTION public.tournament_meal_persons(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tournament_meal_counts(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_m JSONB;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT rules->'meal' INTO v_m FROM tournaments WHERE id = p_tournament_id;
  RETURN (
    WITH people AS (SELECT * FROM tournament_meal_persons(p_tournament_id))
    SELECT jsonb_build_object(
      'mode', COALESCE(v_m->>'mode', 'none'),
      'price_cents', CASE WHEN v_m->>'mode' = 'sale' THEN (v_m->>'price_cents')::integer END,
      'description', NULLIF(trim(v_m->>'description'), ''),
      'yes',     (SELECT count(*) FROM people WHERE meal),
      'no',      (SELECT count(*) FROM people WHERE NOT meal),
      'pending', (SELECT count(*) FROM people WHERE meal IS NULL))
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_meal_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_meal_counts(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tournament_meal_people(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.name, 'category_codes', to_jsonb(p.category_codes),
                                        'entry_ids', to_jsonb(p.entry_ids), 'slots', to_jsonb(p.slots), 'meal', p.meal)
                     ORDER BY lower(p.name), p.category_codes[1])
      FROM tournament_meal_persons(p_tournament_id) p), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_meal_people(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_meal_people(UUID) TO authenticated, service_role;

-- Esta pessoa já respondeu à refeição neste torneio?
CREATE OR REPLACE FUNCTION public.tournament_player_meal(p_tournament_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_meal BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  v_meal := tournament_person_meal(p_tournament_id, p_user_id, NULL);
  RETURN jsonb_build_object(
    'chosen', v_meal IS NOT NULL,
    -- A resposta é da pessoa: só a vê ela própria ou quem organiza.
    'meal', CASE WHEN p_user_id = auth.uid() OR is_tournament_admin(p_tournament_id) THEN v_meal END);
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_player_meal(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_player_meal(UUID, UUID) TO authenticated, service_role;

-- ── 8. Verificar antes de gravar ────────────────────────────────────────
DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
      'public.tournament_signup(uuid,uuid,text,text,text,text,text,text,boolean,boolean)',
      'public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text,boolean,boolean,boolean)',
      'public.tournament_respond_invite(uuid,boolean,text,boolean)',
      'public.admin_remove_player_from_entry(uuid,uuid)',
      'public.list_tournament_entries(uuid)',
      'public.list_my_tournament_invites()',
      'public.set_my_tournament_meal(uuid,boolean,boolean)',
      'public.admin_set_tournament_meal(uuid,integer,boolean)',
      'public.tournament_meal_counts(uuid)',
      'public.tournament_meal_people(uuid)',
      'public.tournament_player_meal(uuid,uuid)']
  LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Acessos errados em %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
      'public.tournament_page_json(uuid,boolean)',
      'public.tournament_meal_offer(uuid)',
      'public.tournament_person_meal(uuid,uuid,uuid)',
      'public.tournament_meal_rows(uuid)',
      'public.tournament_meal_persons(uuid)',
      'public.tournaments_meal_check()',
      'public.tournament_entries_meal()',
      'public.tournament_entries_meal_sync()']
  LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Interna aberta: %', v_fn;
    END IF;
  END LOOP;
  IF to_regprocedure('public.tournament_signup(uuid,uuid,text,text,text,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.tournament_respond_invite(uuid,boolean,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Ficaram assinaturas antigas';
  END IF;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM information_schema.columns WHERE table_name = 'tournament_entries' AND column_name LIKE 'player%_meal';  -- 2
--   SELECT count(*) FROM pg_trigger WHERE tgname IN ('tournaments_meal_check', 'tournament_entries_meal', 'tournament_entries_meal_sync');  -- 3
--   SELECT has_function_privilege('anon', 'public.tournament_meal_counts(uuid)', 'EXECUTE');  -- false
