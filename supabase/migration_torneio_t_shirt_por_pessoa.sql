-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: uma t-shirt por pessoa (não por inscrição) — #605, acerto 11 out
--
-- PORQUÊ. Francisco, 11 out: «é só uma por pessoa, normalmente pelo
-- menos». No mesmo torneio, cada pessoa tem UMA t-shirt (tamanho, ou não
-- quer), seja em quantas categorias for: a 1.ª inscrição escolhe, as outras
-- já a trazem, muda-se num sítio só, paga-se uma vez, e quem organiza conta
-- pessoas. Até aqui era uma por inscrição (o QA viu a t1 escolher e pagar
-- outra vez na M4). Vai com o resto das t-shirts no main de 16 (PO).
--
-- O QUE FAZ (corre DEPOIS da migration_torneio_t_shirts.sql)
--   1. O tamanho continua em tournament_entries.player1_tshirt/player2_tshirt
--      (os ecrãs não mudam de campo), mas fica igual em todas as inscrições
--      ativas (≠ desistiu) da mesma pessoa com conta no mesmo torneio:
--      · tournament_entries_tshirt (antes de gravar): um lugar com conta e
--        sem tamanho herda o que a pessoa já tem noutra inscrição do torneio
--        (também ao aceitar um convite sem dizer o tamanho);
--      · tournament_entries_tshirt_sync (depois de gravar): mudar o tamanho
--        de uma pessoa numa inscrição muda-o nas outras dela.
--      Convidados sem conta ficam por inscrição: não há como saber que são a
--      mesma pessoa.
--   2. tournament_tshirt_rows passa a trazer user_id (interna).
--   3. tournament_tshirt_counts conta pessoas.
--   4. tournament_tshirt_people → uma linha por pessoa: {user_id, name,
--      category_codes[], entry_ids[], slots[], size}; slots[i] é o lugar (1
--      ou 2) na inscrição entry_ids[i] (para o admin_set_tournament_tshirt).
--   5. tournament_player_tshirt(p_tournament_id, p_user_id) → {chosen, size}:
--      se essa pessoa já escolheu (tamanho ou «não quero») neste torneio; o
--      tamanho só o vê o próprio ou quem organiza.
--   6. list_my_tournament_invites ganha my_tshirt (o que eu já tenho neste
--      torneio; null se ainda não escolhi). DROP + CREATE do corpo VIVO.
--
-- Dev 3, 11 out 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.tournament_tshirt_offer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Correr primeiro a migration_torneio_t_shirts.sql.';
  END IF;
END $$;

-- ── 1a. Antes de gravar: validar, limpar e herdar ───────────────────────
CREATE OR REPLACE FUNCTION public.tournament_entries_tshirt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sizes TEXT[];
  v_tour  UUID;
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
  END IF;

  SELECT c.tournament_id, tournament_tshirt_offer(c.tournament_id) INTO v_tour, v_sizes
    FROM tournament_categories c WHERE c.id = NEW.category_id;
  IF v_sizes IS NULL THEN
    -- Torneio sem t-shirt: não se guarda nada.
    NEW.player1_tshirt := NULL;
    NEW.player2_tshirt := NULL;
    RETURN NEW;
  END IF;

  -- Uma t-shirt por pessoa no torneio (11 out): sem tamanho aqui, herda o
  -- que a pessoa já tem noutra inscrição ativa do mesmo torneio.
  IF NEW.status <> 'desistiu' AND NEW.player1_id IS NOT NULL AND NEW.player1_tshirt IS NULL THEN
    NEW.player1_tshirt := tournament_person_tshirt(v_tour, NEW.player1_id, NEW.id);
  END IF;
  IF NEW.status <> 'desistiu' AND NEW.player2_id IS NOT NULL AND NEW.player2_tshirt IS NULL THEN
    NEW.player2_tshirt := tournament_person_tshirt(v_tour, NEW.player2_id, NEW.id);
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

-- A t-shirt que a pessoa já tem neste torneio (fora da inscrição p_skip).
CREATE OR REPLACE FUNCTION public.tournament_person_tshirt(p_tournament_id UUID, p_user UUID, p_skip UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT x.size FROM (
    SELECT CASE WHEN e.player1_id = p_user THEN e.player1_tshirt ELSE e.player2_tshirt END AS size, e.created_at
      FROM tournament_entries e
      JOIN tournament_categories c ON c.id = e.category_id
     WHERE c.tournament_id = p_tournament_id AND e.status <> 'desistiu'
       AND e.id IS DISTINCT FROM p_skip AND p_user IN (e.player1_id, e.player2_id)) x
   WHERE x.size IS NOT NULL
   ORDER BY x.created_at
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.tournament_person_tshirt(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── 1b. Depois de gravar: o mesmo tamanho nas outras inscrições dela ────
CREATE OR REPLACE FUNCTION public.tournament_entries_tshirt_sync()
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
      (NEW.player1_id, NEW.player1_tshirt, CASE WHEN TG_OP = 'UPDATE' THEN OLD.player1_tshirt END),
      (NEW.player2_id, NEW.player2_tshirt, CASE WHEN TG_OP = 'UPDATE' THEN OLD.player2_tshirt END)) AS t(u, v, antes)
  LOOP
    -- Só um tamanho escolhido se espalha; um lugar que ficou vazio (mudou a
    -- pessoa) não apaga o que ela tem nas outras inscrições.
    CONTINUE WHEN s.u IS NULL OR s.v IS NULL OR s.v IS NOT DISTINCT FROM s.antes;
    UPDATE tournament_entries e SET player1_tshirt = s.v
     WHERE e.id <> NEW.id AND e.player1_id = s.u AND e.status <> 'desistiu'
       AND e.category_id IN (SELECT id FROM tournament_categories WHERE tournament_id = v_tour)
       AND e.player1_tshirt IS DISTINCT FROM s.v;
    UPDATE tournament_entries e SET player2_tshirt = s.v
     WHERE e.id <> NEW.id AND e.player2_id = s.u AND e.status <> 'desistiu'
       AND e.category_id IN (SELECT id FROM tournament_categories WHERE tournament_id = v_tour)
       AND e.player2_tshirt IS DISTINCT FROM s.v;
  END LOOP;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_entries_tshirt_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_entries_tshirt_sync ON tournament_entries;
CREATE TRIGGER tournament_entries_tshirt_sync
  AFTER INSERT OR UPDATE OF player1_tshirt, player2_tshirt ON tournament_entries
  FOR EACH ROW EXECUTE FUNCTION tournament_entries_tshirt_sync();

-- As inscrições que já existem com tamanhos diferentes da mesma pessoa:
-- fica o da inscrição mais antiga (só no alinho-dev; em produção ainda não
-- há t-shirts).
UPDATE tournament_entries e SET player1_tshirt = tournament_person_tshirt(c.tournament_id, e.player1_id, NULL)
  FROM tournament_categories c
 WHERE c.id = e.category_id AND e.player1_id IS NOT NULL AND e.status <> 'desistiu'
   AND tournament_person_tshirt(c.tournament_id, e.player1_id, NULL) IS DISTINCT FROM e.player1_tshirt
   AND tournament_person_tshirt(c.tournament_id, e.player1_id, NULL) IS NOT NULL;
UPDATE tournament_entries e SET player2_tshirt = tournament_person_tshirt(c.tournament_id, e.player2_id, NULL)
  FROM tournament_categories c
 WHERE c.id = e.category_id AND e.player2_id IS NOT NULL AND e.status <> 'desistiu'
   AND tournament_person_tshirt(c.tournament_id, e.player2_id, NULL) IS DISTINCT FROM e.player2_tshirt
   AND tournament_person_tshirt(c.tournament_id, e.player2_id, NULL) IS NOT NULL;

-- ── 2. As linhas (interna): com user_id ─────────────────────────────────
DROP FUNCTION IF EXISTS public.tournament_tshirt_rows(UUID) CASCADE;
CREATE FUNCTION public.tournament_tshirt_rows(p_tournament_id UUID)
RETURNS TABLE(entry_id UUID, slot INTEGER, user_id UUID, name TEXT, category_code TEXT, category_position INTEGER, size TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT e.id, 1, e.player1_id, COALESCE(p1.name, e.guest1_name), c.code, c.position, e.player1_tshirt
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    LEFT JOIN profiles p1 ON p1.id = e.player1_id
   WHERE c.tournament_id = p_tournament_id
     AND e.status IN ('convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada')
  UNION ALL
  SELECT e.id, 2, e.player2_id, COALESCE(p2.name, e.guest_name), c.code, c.position, e.player2_tshirt
    FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    LEFT JOIN profiles p2 ON p2.id = e.player2_id
   WHERE c.tournament_id = p_tournament_id
     AND e.status IN ('convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada')
     AND (e.player2_id IS NOT NULL OR e.guest_name IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION public.tournament_tshirt_rows(UUID) FROM PUBLIC, anon, authenticated;

-- Uma linha por pessoa: com conta, junta as inscrições; sem conta, cada uma.
CREATE OR REPLACE FUNCTION public.tournament_tshirt_persons(p_tournament_id UUID)
RETURNS TABLE(user_id UUID, name TEXT, category_codes TEXT[], entry_ids UUID[], slots INTEGER[], size TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT max(r.user_id::text)::uuid, min(r.name),
         array_agg(r.category_code ORDER BY r.category_position, r.category_code),
         array_agg(r.entry_id ORDER BY r.category_position, r.category_code),
         array_agg(r.slot ORDER BY r.category_position, r.category_code),
         -- Com o gatilho é igual em todas; se não for, vale um escolhido.
         COALESCE(max(r.size) FILTER (WHERE r.size <> 'none'), max(r.size))
    FROM tournament_tshirt_rows(p_tournament_id) r
   GROUP BY COALESCE(r.user_id::text, r.entry_id::text || ':' || r.slot);
$function$;
REVOKE ALL ON FUNCTION public.tournament_tshirt_persons(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. A contagem conta pessoas ─────────────────────────────────────────
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
    WITH people AS (SELECT * FROM tournament_tshirt_persons(p_tournament_id))
    SELECT jsonb_build_object(
      'mode', COALESCE(v_t->>'mode', 'none'),
      'price_cents', CASE WHEN v_t->>'mode' = 'sale' THEN (v_t->>'price_cents')::integer END,
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

-- ── 4. A lista de quem organiza: uma linha por pessoa ───────────────────
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
    SELECT jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', p.name, 'category_codes', to_jsonb(p.category_codes),
                                        'entry_ids', to_jsonb(p.entry_ids), 'slots', to_jsonb(p.slots), 'size', p.size)
                     ORDER BY lower(p.name), p.category_codes[1])
      FROM tournament_tshirt_persons(p_tournament_id) p), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_tshirt_people(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_tshirt_people(UUID) TO authenticated;

-- ── 5. Esta pessoa já escolheu a t-shirt neste torneio? ─────────────────
CREATE OR REPLACE FUNCTION public.tournament_player_tshirt(p_tournament_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_size TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  v_size := tournament_person_tshirt(p_tournament_id, p_user_id, NULL);
  RETURN jsonb_build_object(
    'chosen', v_size IS NOT NULL,
    -- O tamanho é da pessoa: só o vê ela própria ou quem organiza.
    'size', CASE WHEN p_user_id = auth.uid() OR is_tournament_admin(p_tournament_id) THEN v_size END);
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_player_tshirt(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tournament_player_tshirt(UUID, UUID) TO authenticated;

-- ── 6. O convite traz a t-shirt que eu já tenho (corpo VIVO) ────────────
DO $$
DECLARE
  c_ret CONSTANT TEXT := 'tshirt jsonb\)';
  c_sel CONSTANT TEXT := '(THEN t\.rules->''tshirt'' END)';
  v_def TEXT := pg_get_functiondef('public.list_my_tournament_invites()'::regprocedure);
BEGIN
  IF v_def LIKE '%my_tshirt%' THEN
    RAISE NOTICE 'list_my_tournament_invites: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_ret, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_sel, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_my_tournament_invites: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_ret, 'tshirt jsonb, my_tshirt text)');
  v_def := regexp_replace(v_def, c_sel, E'\\1,\n         tournament_person_tshirt(t.id, auth.uid(), e.id)');
  DROP FUNCTION public.list_my_tournament_invites();
  EXECUTE v_def;
END $$;
REVOKE ALL ON FUNCTION public.list_my_tournament_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_tournament_invites() TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'tournament_entries_tshirt_sync';                  -- 1
--   SELECT has_function_privilege('anon', 'public.tournament_player_tshirt(uuid,uuid)', 'EXECUTE');   -- false
