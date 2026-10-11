-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: t-shirts (#605)
--
-- PORQUÊ. SPEC design-handoff/2026-10-08-torneio-t-shirts (Francisco, 8 out:
-- «sim aprovo, manda implementar»). O torneio pode ter t-shirt (oferta ou à
-- venda); cada jogador escolhe o tamanho ou «Não quero»; quem organiza vê a
-- contagem por tamanho e muda qualquer tamanho, mesmo depois do prazo.
-- Ecrãs: Dev 1. Nomes combinados com ele a 8 out.
--
-- O QUE FAZ
--   1. tournaments.rules.tshirt = { mode: 'none'|'gift'|'sale', price_cents,
--      sizes: [...] }. Grava-se pelo create_tournament / update_tournament
--      de hoje (já juntam rules). Um gatilho valida: mode é um dos três;
--      com 'gift'/'sale' há pelo menos um tamanho, só de XS S M L XL XXL;
--      com 'sale' há price_cents >= 0.
--   2. tournament_entries.player1_tshirt / player2_tshirt (text):
--      NULL = ainda não escolheu · 'none' = não quer · um dos tamanhos.
--      Um gatilho valida o tamanho contra os do torneio (torneio sem
--      t-shirt: fica NULL, sem erro) e apaga o tamanho quando a pessoa
--      daquele lugar muda (trocar de parceiro, recusar, o organizador
--      trocar alguém). Ficar com o lugar pelo link mantém o tamanho, porque
--      é a mesma pessoa.
--   3. Parâmetros novos, no fim e opcionais (DROP + CREATE do corpo VIVO):
--      tournament_signup(…, p_player1_tshirt, p_player2_tshirt) — o 2.º só
--        conta para o parceiro sem conta (quem tem conta escolhe ao aceitar);
--      tournament_admin_signup(…, p_player1_tshirt, p_player2_tshirt);
--      tournament_respond_invite(…, p_tshirt) — grava ao aceitar.
--   4. Novas:
--      set_my_tournament_tshirt(p_entry_id, p_size, p_for_guest DEFAULT false)
--        → o tamanho gravado. O próprio, até as inscrições fecharem
--        (entries_deadline ou categoria fora de 'inscricoes'). Com
--        p_for_guest, quem inscreveu muda o do parceiro sem conta.
--        Erros: entry_not_found, no_tshirt, entries_closed, bad_tshirt_size.
--      admin_set_tournament_tshirt(p_entry_id, p_slot 1|2, p_size) → o
--        tamanho. Só quem organiza, sem prazo. Erros: not_admin, no_player.
--      tournament_tshirt_counts(p_tournament_id) → { mode, price_cents,
--        sizes: [{size, count}], requested, declined, pending }, e
--      tournament_tshirt_people(p_tournament_id) → [{entry_id, slot, name,
--        category_code, size}] por ordem de nome. Só quem organiza. Contam
--        as inscrições que ocupam lugar (sem suplentes nem desistências),
--        em todas as categorias.
--   5. Leituras: list_tournament_entries traz player1_tshirt e
--      player2_tshirt; list_my_tournament_invites traz tshirt (a do
--      torneio); a página do torneio traz tournament.tshirt (a do torneio)
--      e, em my e my_entries, tshirt (o tamanho do próprio nessa inscrição)
--      e, para quem inscreveu um convidado sem conta, guest_name e
--      guest_tshirt (o nome e o tamanho dele; null sem convidado).
--
-- Dev 3, 8 out 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Colunas ──────────────────────────────────────────────────────────
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS player1_tshirt TEXT;
ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS player2_tshirt TEXT;

-- ── 2. A t-shirt do torneio ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_tshirt_sizes_all()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT ARRAY['XS', 'S', 'M', 'L', 'XL', 'XXL'];
$function$;
REVOKE ALL ON FUNCTION public.tournament_tshirt_sizes_all() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tournaments_tshirt_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_t JSONB := NEW.rules->'tshirt';
BEGIN
  IF v_t IS NULL OR jsonb_typeof(v_t) = 'null' THEN RETURN NEW; END IF;
  IF jsonb_typeof(v_t) <> 'object' OR COALESCE(v_t->>'mode', '') NOT IN ('none', 'gift', 'sale') THEN
    RAISE EXCEPTION 'bad_tshirt';
  END IF;
  IF v_t->>'mode' <> 'none' THEN
    -- Cada passo à parte: com um campo em falta, um «OR» dava NULL e deixava
    -- passar (apanhado no teste).
    IF COALESCE(jsonb_typeof(v_t->'sizes'), '') <> 'array' THEN RAISE EXCEPTION 'bad_tshirt'; END IF;
    IF jsonb_array_length(v_t->'sizes') = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_t->'sizes') s
                   WHERE jsonb_typeof(s) <> 'string' OR s #>> '{}' <> ALL (tournament_tshirt_sizes_all())) THEN
      RAISE EXCEPTION 'bad_tshirt';
    END IF;
  END IF;
  IF v_t->>'mode' = 'sale' THEN
    IF COALESCE(jsonb_typeof(v_t->'price_cents'), '') <> 'number' THEN RAISE EXCEPTION 'bad_tshirt'; END IF;
    IF (v_t->>'price_cents')::numeric < 0 OR (v_t->>'price_cents')::numeric <> trunc((v_t->>'price_cents')::numeric) THEN
      RAISE EXCEPTION 'bad_tshirt';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournaments_tshirt_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tournaments_tshirt_check ON tournaments;
CREATE TRIGGER tournaments_tshirt_check
  BEFORE INSERT OR UPDATE OF rules ON tournaments
  FOR EACH ROW EXECUTE FUNCTION tournaments_tshirt_check();

-- Os tamanhos que o torneio tem (NULL = torneio sem t-shirt).
CREATE OR REPLACE FUNCTION public.tournament_tshirt_offer(p_tournament_id UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT ARRAY(SELECT jsonb_array_elements_text(t.rules->'tshirt'->'sizes'))
    FROM tournaments t
   WHERE t.id = p_tournament_id
     AND t.rules->'tshirt'->>'mode' IN ('gift', 'sale')
     AND jsonb_typeof(t.rules->'tshirt'->'sizes') = 'array';
$function$;
REVOKE ALL ON FUNCTION public.tournament_tshirt_offer(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. O tamanho de cada um ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_entries_tshirt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sizes TEXT[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Mudou a pessoa daquele lugar: o tamanho era da outra. Quem fica com o
    -- lugar pelo link (sem conta → com conta) é a mesma pessoa e mantém-no.
    IF NEW.player1_tshirt IS NOT DISTINCT FROM OLD.player1_tshirt
       AND ((OLD.player1_id IS NOT NULL AND NEW.player1_id IS DISTINCT FROM OLD.player1_id)
         OR (OLD.player1_id IS NULL AND NEW.player1_id IS NULL AND NEW.guest1_name IS DISTINCT FROM OLD.guest1_name)) THEN
      NEW.player1_tshirt := NULL;
    END IF;
    IF NEW.player2_tshirt IS NOT DISTINCT FROM OLD.player2_tshirt
       AND ((OLD.player2_id IS NOT NULL AND NEW.player2_id IS DISTINCT FROM OLD.player2_id)
         OR (OLD.player2_id IS NULL AND NEW.player2_id IS NULL AND NEW.guest_name IS DISTINCT FROM OLD.guest_name)) THEN
      NEW.player2_tshirt := NULL;
    END IF;
    IF NEW.player1_tshirt IS NOT DISTINCT FROM OLD.player1_tshirt
       AND NEW.player2_tshirt IS NOT DISTINCT FROM OLD.player2_tshirt THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.player1_tshirt IS NULL AND NEW.player2_tshirt IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tournament_tshirt_offer(c.tournament_id) INTO v_sizes
    FROM tournament_categories c WHERE c.id = NEW.category_id;
  IF v_sizes IS NULL THEN
    -- Torneio sem t-shirt: não se guarda nada.
    NEW.player1_tshirt := NULL;
    NEW.player2_tshirt := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.player1_tshirt IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.player1_tshirt END
        AND NEW.player1_tshirt IS NOT NULL AND NEW.player1_tshirt <> 'none' AND NEW.player1_tshirt <> ALL (v_sizes))
     OR (NEW.player2_tshirt IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.player2_tshirt END
        AND NEW.player2_tshirt IS NOT NULL AND NEW.player2_tshirt <> 'none' AND NEW.player2_tshirt <> ALL (v_sizes)) THEN
    RAISE EXCEPTION 'bad_tshirt_size';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_entries_tshirt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_entries_tshirt ON tournament_entries;
CREATE TRIGGER tournament_entries_tshirt
  BEFORE INSERT OR UPDATE ON tournament_entries
  FOR EACH ROW EXECUTE FUNCTION tournament_entries_tshirt();

-- ── 4. Inscrever e aceitar com o tamanho (corpo VIVO, DROP + CREATE) ────
DO $$
DECLARE
  f      RECORD;
  v_def  TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.tournament_signup(uuid,uuid,text,text,text)',
       ', p_player1_tshirt text DEFAULT NULL::text, p_player2_tshirt text DEFAULT NULL::text',
       'RETURNING id INTO v_id;',
       E'RETURNING id INTO v_id;\n\n  -- T-shirts (#605): a minha, e a do parceiro sem conta (quem tem conta\n  -- escolhe ao aceitar).\n  IF p_player1_tshirt IS NOT NULL OR (p_partner_id IS NULL AND p_player2_tshirt IS NOT NULL) THEN\n    UPDATE tournament_entries\n       SET player1_tshirt = p_player1_tshirt,\n           player2_tshirt = CASE WHEN p_partner_id IS NULL AND guest_name IS NOT NULL THEN p_player2_tshirt END\n     WHERE id = v_id;\n  END IF;',
       'p_player1_tshirt'),
      ('public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text)',
       ', p_player1_tshirt text DEFAULT NULL::text, p_player2_tshirt text DEFAULT NULL::text',
       'RETURNING id INTO v_id;',
       E'RETURNING id INTO v_id;\n\n  -- T-shirts (#605): quem organiza escolhe pelos dois.\n  IF p_player1_tshirt IS NOT NULL OR p_player2_tshirt IS NOT NULL THEN\n    UPDATE tournament_entries\n       SET player1_tshirt = p_player1_tshirt,\n           player2_tshirt = CASE WHEN player2_id IS NOT NULL OR guest_name IS NOT NULL THEN p_player2_tshirt END\n     WHERE id = v_id;\n  END IF;',
       'p_player1_tshirt'),
      ('public.tournament_respond_invite(uuid,boolean)',
       ', p_tshirt text DEFAULT NULL::text',
       'partner_accepted_at = NOW\(\)',
       'partner_accepted_at = NOW(), player2_tshirt = p_tshirt',
       'p_tshirt')
    ) AS t(sig, novos, mau, bom, marca) LOOP
    IF to_regprocedure(f.sig) IS NULL THEN
      RAISE NOTICE '%: já estava (assinatura antiga não existe)', f.sig;
      CONTINUE;
    END IF;
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%' || f.marca || '%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, E'\\)\\n RETURNS ', 'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    v_def := regexp_replace(v_def, E'\\)\\n RETURNS ', f.novos || E')\n RETURNS ');
    v_def := regexp_replace(v_def, f.mau, f.bom);
    EXECUTE 'DROP FUNCTION ' || f.sig;
    EXECUTE v_def;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.tournament_signup(uuid,uuid,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_signup(uuid,uuid,text,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.tournament_respond_invite(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_respond_invite(uuid,boolean,text) TO authenticated;

-- ── 5. Leituras (corpo VIVO) ────────────────────────────────────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  -- list_tournament_entries: muda o que devolve → DROP + CREATE.
  v_def := pg_get_functiondef('public.list_tournament_entries(uuid)'::regprocedure);
  IF v_def LIKE '%player1_tshirt%' THEN
    RAISE NOTICE 'list_tournament_entries: já estava';
  ELSE
    IF (SELECT count(*) FROM regexp_matches(v_def, 'respond_by timestamp with time zone\)', 'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, 'e\.respond_by(\s+)FROM', 'g')) <> 1 THEN
      RAISE EXCEPTION 'list_tournament_entries: o pedaço a trocar não aparece 1 vez. Parar e ler.';
    END IF;
    v_def := regexp_replace(v_def, 'respond_by timestamp with time zone\)',
                            'respond_by timestamp with time zone, player1_tshirt text, player2_tshirt text)');
    v_def := regexp_replace(v_def, 'e\.respond_by(\s+)FROM', 'e.respond_by, e.player1_tshirt, e.player2_tshirt\1FROM');
    DROP FUNCTION public.list_tournament_entries(uuid);
    EXECUTE v_def;
  END IF;

  -- list_my_tournament_invites: a t-shirt do torneio, para o cartão do pedido.
  v_def := pg_get_functiondef('public.list_my_tournament_invites()'::regprocedure);
  IF v_def LIKE '%tshirt%' THEN
    RAISE NOTICE 'list_my_tournament_invites: já estava';
  ELSE
    IF (SELECT count(*) FROM regexp_matches(v_def, 'respond_by timestamp with time zone\)', 'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, 'e\.respond_by(\s+)FROM', 'g')) <> 1 THEN
      RAISE EXCEPTION 'list_my_tournament_invites: o pedaço a trocar não aparece 1 vez. Parar e ler.';
    END IF;
    v_def := regexp_replace(v_def, 'respond_by timestamp with time zone\)',
                            'respond_by timestamp with time zone, tshirt jsonb)');
    v_def := regexp_replace(v_def, 'e\.respond_by(\s+)FROM',
                            E'e.respond_by,\n         CASE WHEN t.rules->''tshirt''->>''mode'' IN (''gift'', ''sale'') THEN t.rules->''tshirt'' END\\1FROM');
    DROP FUNCTION public.list_my_tournament_invites();
    EXECUTE v_def;
  END IF;

  -- tournament_page_json: devolve jsonb na mesma → CREATE OR REPLACE.
  v_def := pg_get_functiondef('public.tournament_page_json(uuid,boolean)'::regprocedure);
  IF v_def LIKE '%e.player1_tshirt ELSE e.player2_tshirt%' THEN
    RAISE NOTICE 'tournament_page_json: já estava';
  ELSE
    IF (SELECT count(*) FROM regexp_matches(v_def, 't\.organizer_text, t\.status,', 'g')) <> 1
       OR (SELECT count(*) FROM regexp_matches(v_def, '\(e\.player1_id = auth\.uid\(\)\) AS registered_by_me', 'g')) <> 2 THEN
      RAISE EXCEPTION 'tournament_page_json: o pedaço a trocar não aparece. Parar e ler.';
    END IF;
    v_def := regexp_replace(v_def, 't\.organizer_text, t\.status,',
                            E't.organizer_text, t.status,\n               CASE WHEN t.rules->''tshirt''->>''mode'' IN (''gift'', ''sale'') THEN t.rules->''tshirt'' END AS tshirt,');
    v_def := regexp_replace(v_def, '\(e\.player1_id = auth\.uid\(\)\) AS registered_by_me',
                            '(e.player1_id = auth.uid()) AS registered_by_me, CASE WHEN e.player1_id = auth.uid() THEN e.player1_tshirt ELSE e.player2_tshirt END AS tshirt, '
                            || 'CASE WHEN e.player1_id = auth.uid() AND e.player2_id IS NULL THEN e.guest_name END AS guest_name, '
                            || 'CASE WHEN e.player1_id = auth.uid() AND e.player2_id IS NULL AND e.guest_name IS NOT NULL THEN e.player2_tshirt END AS guest_tshirt', 'g');
    EXECUTE v_def;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.list_tournament_entries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tournament_entries(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.list_my_tournament_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_tournament_invites() TO authenticated;

-- ── 6. Mudar o tamanho ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_my_tournament_tshirt(p_entry_id UUID, p_size TEXT, p_for_guest BOOLEAN DEFAULT FALSE)
RETURNS TEXT
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
  SELECT * INTO v_e FROM tournament_entries
   WHERE id = p_entry_id AND status <> 'desistiu' AND v_me IN (player1_id, player2_id) FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'entry_not_found'; END IF;

  IF p_for_guest THEN
    -- O parceiro sem conta: é quem inscreveu que escolhe por ele.
    IF v_e.player1_id IS DISTINCT FROM v_me OR v_e.player2_id IS NOT NULL OR v_e.guest_name IS NULL THEN
      RAISE EXCEPTION 'entry_not_found';
    END IF;
    v_slot := 2;
  ELSE
    v_slot := CASE WHEN v_e.player1_id = v_me THEN 1 ELSE 2 END;
  END IF;

  SELECT c.status INTO v_cat FROM tournament_categories c WHERE c.id = v_e.category_id;
  SELECT t.* INTO v_t FROM tournaments t JOIN tournament_categories c ON c.tournament_id = t.id WHERE c.id = v_e.category_id;
  IF tournament_tshirt_offer(v_t.id) IS NULL THEN RAISE EXCEPTION 'no_tshirt'; END IF;
  IF v_t.status IN ('cancelado', 'terminado') OR v_cat <> 'inscricoes'
     OR (v_t.entries_deadline IS NOT NULL AND v_t.entries_deadline < NOW()) THEN
    RAISE EXCEPTION 'entries_closed';
  END IF;

  IF v_slot = 1 THEN
    UPDATE tournament_entries SET player1_tshirt = p_size WHERE id = p_entry_id;
  ELSE
    UPDATE tournament_entries SET player2_tshirt = p_size WHERE id = p_entry_id;
  END IF;
  RETURN p_size;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_my_tournament_tshirt(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_tournament_tshirt(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_tournament_tshirt(p_entry_id UUID, p_slot INTEGER, p_size TEXT)
RETURNS TEXT
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
  IF tournament_tshirt_offer(v_t) IS NULL THEN RAISE EXCEPTION 'no_tshirt'; END IF;
  IF p_slot = 1 THEN
    UPDATE tournament_entries SET player1_tshirt = p_size WHERE id = p_entry_id;
  ELSIF p_slot = 2 AND (v_e.player2_id IS NOT NULL OR v_e.guest_name IS NOT NULL) THEN
    UPDATE tournament_entries SET player2_tshirt = p_size WHERE id = p_entry_id;
  ELSE
    RAISE EXCEPTION 'no_player';
  END IF;
  RETURN p_size;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_tournament_tshirt(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tournament_tshirt(UUID, INTEGER, TEXT) TO authenticated;

-- ── 7. A contagem e a lista de quem organiza ────────────────────────────
-- As pessoas que contam: as das inscrições que ocupam lugar.
CREATE OR REPLACE FUNCTION public.tournament_tshirt_rows(p_tournament_id UUID)
RETURNS TABLE(entry_id UUID, slot INTEGER, name TEXT, category_code TEXT, size TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT e.id, 1, COALESCE(p1.name, e.guest1_name), c.code, e.player1_tshirt
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    LEFT JOIN profiles p1 ON p1.id = e.player1_id
   WHERE c.tournament_id = p_tournament_id
     AND e.status IN ('convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada')
  UNION ALL
  SELECT e.id, 2, COALESCE(p2.name, e.guest_name), c.code, e.player2_tshirt
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    LEFT JOIN profiles p2 ON p2.id = e.player2_id
   WHERE c.tournament_id = p_tournament_id
     AND e.status IN ('convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada')
     AND (e.player2_id IS NOT NULL OR e.guest_name IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION public.tournament_tshirt_rows(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tournament_tshirt_counts(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_t      JSONB;
  v_sizes  TEXT[];
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT rules->'tshirt' INTO v_t FROM tournaments WHERE id = p_tournament_id;
  v_sizes := COALESCE(tournament_tshirt_offer(p_tournament_id), '{}');

  RETURN (
    WITH people AS (SELECT * FROM tournament_tshirt_rows(p_tournament_id))
    SELECT jsonb_build_object(
      'mode', COALESCE(v_t->>'mode', 'none'),
      'price_cents', CASE WHEN v_t->>'mode' = 'sale' THEN (v_t->>'price_cents')::integer END,
      -- Os tamanhos que há, por ordem, mesmo a zero; e algum que já não
      -- esteja à escolha mas alguém tenha pedido.
      'sizes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('size', s.size, 'count', s.n) ORDER BY s.ord)
          FROM (SELECT z.size, z.ord, (SELECT count(*) FROM people p WHERE p.size = z.size) AS n
                  FROM unnest(tournament_tshirt_sizes_all()) WITH ORDINALITY AS z(size, ord)
                 WHERE z.size = ANY (v_sizes) OR EXISTS (SELECT 1 FROM people p WHERE p.size = z.size)) s), '[]'::jsonb),
      'requested', (SELECT count(*) FROM people WHERE size IS NOT NULL AND size <> 'none'),
      'declined',  (SELECT count(*) FROM people WHERE size = 'none'),
      'pending',   (SELECT count(*) FROM people WHERE size IS NULL))
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_tshirt_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_tshirt_counts(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.tournament_tshirt_people(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN RAISE EXCEPTION 'not_admin'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('entry_id', r.entry_id, 'slot', r.slot, 'name', r.name,
                                        'category_code', r.category_code, 'size', r.size)
                     ORDER BY lower(r.name), r.category_code, r.slot)
      FROM tournament_tshirt_rows(p_tournament_id) r), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_tshirt_people(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_tshirt_people(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM information_schema.columns WHERE table_name = 'tournament_entries' AND column_name LIKE 'player%_tshirt';  -- 2
--   SELECT to_regprocedure('public.tournament_signup(uuid,uuid,text,text,text,text,text)') IS NOT NULL,
--          to_regprocedure('public.tournament_signup(uuid,uuid,text,text,text)') IS NULL;               -- true, true
--   SELECT has_function_privilege('anon', 'public.tournament_tshirt_counts(uuid)', 'EXECUTE');          -- false
