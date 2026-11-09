-- ═════════════════════════════════════════════════════════════════════════
-- Torneios: o sexo volta a contar (#788) e «Em dupla» pede parceiro (#790)
--
-- PORQUÊ. Francisco, 8 nov: «Um homem não pode se inscrever numa categoria
-- feminina.» Desfaz, só nos torneios, a decisão de 26 set
-- (migration_tournament_sexo_nao_bloqueia.sql). Nos mixes não muda nada.
-- Desenho: design-handoff/2026-11-08-torneio-sexo-bloqueia/SPEC.md
--
-- A REGRA. Masculinos: os dois homens. Femininos: as duas mulheres. Mistos: um
-- de cada. Só se recusa o que se sabe que não bate: sexo por saber não recusa
-- a dupla.
--
-- O QUE MUDA
--   · tournament_signup: sem sexo no perfil recusa (player_gender_required);
--     categoria ou dupla que não batem recusa (gender_mismatch); torneio
--     «Em dupla» sem parceiro recusa (partner_required, #790). Parâmetro novo
--     p_partner_gender: o que quem inscreve respondeu sobre o parceiro sem
--     conta ou sem sexo no perfil. Vale só para esta inscrição: nunca se grava
--     no perfil de ninguém (decisão de 2 out).
--   · tournament_change_partner: gender_mismatch ao trocar de parceiro.
--     Parâmetro novo p_partner_gender. O #790 não se aplica aqui.
--   · tournament_respond_invite (ao aceitar) e tournament_claim_entry: recusam
--     com player_gender_required ou gender_mismatch. O ecrã pergunta o sexo e
--     tenta outra vez.
--   · tournament_admin_signup, tournament_admin_set_partner e
--     tournament_admin_replace_player: gender_mismatch, a não ser que venha
--     p_force_gender = true («Inscrever na mesma?»).
--
-- O QUE NÃO MUDA. As inscrições que já existem. O tournament_entries_guard
-- continua sem esta regra: é nas funções que o organizador tem a sua saída, e
-- os jogadores não têm acesso direto à tabela.
--
-- A APP ANTIGA. Os parâmetros novos são opcionais. As recusas novas já têm
-- texto nas versões que estão nas lojas.
--
-- UM CASO A SABER. Quem o organizador inscreveu sem conta numa categoria que
-- não é para essa pessoa fica lá, mas ao abrir o link recebe a recusa e a
-- conta não fica ligada. O organizador troca o jogador, se for o caso.
--
-- ORDEM. Não depende de outras. Tem de correr ANTES de o ecrã novo do #788
-- chegar a cada ambiente: o ecrã envia os parâmetros novos.
--
-- Para desfazer (só em emergência): repor os corpos anteriores (md5 sem \r):
--   tournament_signup 90ebabe2…, tournament_admin_signup a1200d15…,
--   tournament_admin_set_partner 91fbe135…, tournament_admin_replace_player
--   6c46f47e…, tournament_change_partner bccf371f…, tournament_respond_invite
--   e9b3a95f…, tournament_claim_entry d27e9ec8…
--
-- Dev 3, 9 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- O sexo conhecido de uma pessoa: o do perfil e, se não houver, o que foi
-- respondido na altura. Sem nenhum dos dois: NULL.
CREATE OR REPLACE FUNCTION public.tournament_person_gender(p_user uuid, p_answered text DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT COALESCE(
    (SELECT gender FROM profiles WHERE id = p_user AND gender IN ('masculino', 'feminino')),
    CASE WHEN p_answered IN ('masculino', 'feminino') THEN p_answered END
  );
$function$;

-- A dupla bate com a categoria? Só é falso quando se sabe que não bate.
CREATE OR REPLACE FUNCTION public.tournament_gender_fits(p_category_gender text, p_g1 text, p_g2 text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE p_category_gender
    WHEN 'masculino' THEN COALESCE(p_g1, 'masculino') = 'masculino' AND COALESCE(p_g2, 'masculino') = 'masculino'
    WHEN 'feminino'  THEN COALESCE(p_g1, 'feminino') = 'feminino' AND COALESCE(p_g2, 'feminino') = 'feminino'
    WHEN 'misto'     THEN p_g1 IS NULL OR p_g2 IS NULL OR p_g1 <> p_g2
    ELSE true
  END;
$function$;

REVOKE ALL ON FUNCTION public.tournament_person_gender(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tournament_gender_fits(text, text, text) FROM PUBLIC, anon, authenticated;

-- Aplica as trocas ao corpo vivo. Cada excerto tem de aparecer exatamente uma
-- vez, senão para tudo. p_trocas alterna: antigo, novo, antigo, novo…
CREATE FUNCTION pg_temp.aplicar(p_sig TEXT, p_recriar BOOLEAN, p_trocas TEXT[])
RETURNS VOID
LANGUAGE plpgsql
AS $f$
DECLARE
  v_def TEXT;
  v_old TEXT;
  v_new TEXT;
  v_n   INT;
  i     INT;
BEGIN
  IF to_regprocedure(p_sig) IS NULL THEN
    RAISE NOTICE '%: já estava', p_sig;
    RETURN;
  END IF;
  v_def := replace(pg_get_functiondef(p_sig::regprocedure), E'\r', '');
  IF position('#788' IN v_def) > 0 THEN
    RAISE NOTICE '%: já estava', p_sig;
    RETURN;
  END IF;
  FOR i IN 1 .. array_length(p_trocas, 1) BY 2 LOOP
    v_old := replace(p_trocas[i], E'\r', '');
    v_new := replace(p_trocas[i + 1], E'\r', '');
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar e ler.', p_sig, v_old, v_n;
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END LOOP;
  IF p_recriar THEN
    EXECUTE 'DROP FUNCTION public.' || p_sig;
  END IF;
  EXECUTE v_def;
END;
$f$;

-- ── Quem joga ─────────────────────────────────────────────────────────────

SELECT pg_temp.aplicar('tournament_signup(uuid,uuid,text,text,text,text,text)', true, ARRAY[
$a$p_player2_tshirt text DEFAULT NULL::text)
 RETURNS jsonb$a$,
$a$p_player2_tshirt text DEFAULT NULL::text, p_partner_gender text DEFAULT NULL::text)
 RETURNS jsonb$a$,

$a$  v_id UUID;
BEGIN$a$,
$a$  v_id UUID;
  v_gender TEXT;
BEGIN$a$,

$a$  -- O sexo já não bloqueia a inscrição (Francisco, 26 set): o ecrã pergunta.$a$,
$a$  -- Voltou a contar nos torneios (#788, Francisco, 8 nov): ver abaixo.$a$,

$a$  -- Máximo de categorias por pessoa (2 por defeito, o admin muda ao criar).$a$,
$a$  v_gender := tournament_person_gender(v_me);
  IF v_gender IS NULL THEN RAISE EXCEPTION 'player_gender_required'; END IF;

  -- #790: num torneio «Em dupla» não há inscrição sem parceiro.
  IF v_tournament.rules->>'entry_mode' = 'dupla'
     AND p_partner_id IS NULL AND NULLIF(TRIM(p_guest_name), '') IS NULL THEN
    RAISE EXCEPTION 'partner_required';
  END IF;

  -- Máximo de categorias por pessoa (2 por defeito, o admin muda ao criar).$a$,

$a$  -- Quem chega depois de cheia fica suplente, por ordem de chegada.$a$,
$a$  -- #788: a pessoa e a dupla têm de bater com a categoria. O que quem inscreve
  -- respondeu sobre o parceiro vale só aqui, nunca vai para o perfil dele.
  IF NOT tournament_gender_fits(v_cat.gender, v_gender,
                                tournament_person_gender(p_partner_id, p_partner_gender)) THEN
    RAISE EXCEPTION 'gender_mismatch';
  END IF;

  -- Quem chega depois de cheia fica suplente, por ordem de chegada.$a$
]);

SELECT pg_temp.aplicar('tournament_change_partner(uuid,uuid,text,text)', true, ARRAY[
$a$p_guest_email text DEFAULT NULL::text)
 RETURNS jsonb$a$,
$a$p_guest_email text DEFAULT NULL::text, p_partner_gender text DEFAULT NULL::text)
 RETURNS jsonb$a$,

$a$  v_token TEXT;
BEGIN$a$,
$a$  v_token TEXT;
  v_cat_gender TEXT;
BEGIN$a$,

$a$  SELECT status INTO v_cat_status FROM tournament_categories WHERE id = v_entry.category_id;$a$,
$a$  SELECT status, gender INTO v_cat_status, v_cat_gender FROM tournament_categories WHERE id = v_entry.category_id;$a$,

$a$  IF p_guest_name IS NOT NULL THEN v_token := tournament_new_invite_token(); END IF;$a$,
$a$  -- #788: o novo parceiro tem de bater com a categoria.
  IF (p_partner_id IS NOT NULL OR NULLIF(TRIM(p_guest_name), '') IS NOT NULL)
     AND NOT tournament_gender_fits(v_cat_gender, tournament_person_gender(v_me),
                                    tournament_person_gender(p_partner_id, p_partner_gender)) THEN
    RAISE EXCEPTION 'gender_mismatch';
  END IF;

  IF p_guest_name IS NOT NULL THEN v_token := tournament_new_invite_token(); END IF;$a$
]);

SELECT pg_temp.aplicar('tournament_respond_invite(uuid,boolean,text)', false, ARRAY[
$a$  v_cat_status TEXT;
BEGIN$a$,
$a$  v_cat_status TEXT;
  v_cat_gender TEXT;
  v_gender TEXT;
BEGIN$a$,

$a$  SELECT c.tournament_id, c.status INTO v_tournament, v_cat_status
    FROM tournament_categories c WHERE c.id = v_entry.category_id;$a$,
$a$  SELECT c.tournament_id, c.status, c.gender INTO v_tournament, v_cat_status, v_cat_gender
    FROM tournament_categories c WHERE c.id = v_entry.category_id;$a$,

$a$    -- Aceite: fica à espera de o clube confirmar o pagamento.$a$,
$a$    -- #788: aceitar é entrar, vale a regra do sexo.
    v_gender := tournament_person_gender(v_me);
    IF v_gender IS NULL THEN RAISE EXCEPTION 'player_gender_required'; END IF;
    IF NOT tournament_gender_fits(v_cat_gender, tournament_person_gender(v_entry.player1_id), v_gender) THEN
      RAISE EXCEPTION 'gender_mismatch';
    END IF;

    -- Aceite: fica à espera de o clube confirmar o pagamento.$a$
]);

SELECT pg_temp.aplicar('tournament_claim_entry(text)', false, ARRAY[
$a$  v_cat_status TEXT;   -- >>> NOVO: para a trava abaixo$a$,
$a$  v_cat_status TEXT;   -- >>> NOVO: para a trava abaixo
  v_cat_gender TEXT;
  v_gender TEXT;$a$,

$a$    SELECT c.tournament_id, c.status INTO v_tournament, v_cat_status
      FROM tournament_categories c WHERE c.id = v_entry.category_id;$a$,
$a$    SELECT c.tournament_id, c.status, c.gender INTO v_tournament, v_cat_status, v_cat_gender
      FROM tournament_categories c WHERE c.id = v_entry.category_id;$a$,

$a$    UPDATE tournament_entries
       SET player1_id = v_me, guest1_name = NULL, guest1_email = NULL,$a$,
$a$    -- #788: ficar com o lugar é entrar, vale a regra do sexo.
    v_gender := tournament_person_gender(v_me);
    IF v_gender IS NULL THEN RAISE EXCEPTION 'player_gender_required'; END IF;
    IF NOT tournament_gender_fits(v_cat_gender, v_gender, tournament_person_gender(v_entry.player2_id)) THEN
      RAISE EXCEPTION 'gender_mismatch';
    END IF;

    UPDATE tournament_entries
       SET player1_id = v_me, guest1_name = NULL, guest1_email = NULL,$a$,

$a$  SELECT c.tournament_id, c.status INTO v_tournament, v_cat_status
    FROM tournament_categories c WHERE c.id = v_entry.category_id;$a$,
$a$  SELECT c.tournament_id, c.status, c.gender INTO v_tournament, v_cat_status, v_cat_gender
    FROM tournament_categories c WHERE c.id = v_entry.category_id;$a$,

$a$  UPDATE tournament_entries
     SET player2_id = v_me, guest_name = NULL, guest_email = NULL,$a$,
$a$  v_gender := tournament_person_gender(v_me);
  IF v_gender IS NULL THEN RAISE EXCEPTION 'player_gender_required'; END IF;
  IF NOT tournament_gender_fits(v_cat_gender, tournament_person_gender(v_entry.player1_id), v_gender) THEN
    RAISE EXCEPTION 'gender_mismatch';
  END IF;

  UPDATE tournament_entries
     SET player2_id = v_me, guest_name = NULL, guest_email = NULL,$a$
]);

-- ── Quem organiza: a mesma regra, com a saída «Inscrever na mesma?» ───────

SELECT pg_temp.aplicar('tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text)', true, ARRAY[
$a$p_player2_tshirt text DEFAULT NULL::text)
 RETURNS jsonb$a$,
$a$p_player2_tshirt text DEFAULT NULL::text, p_force_gender boolean DEFAULT false)
 RETURNS jsonb$a$,

$a$  IF EXISTS (SELECT 1 FROM tournament_entries
              WHERE category_id = p_category_id AND status <> 'desistiu'$a$,
$a$  -- #788: só recusa o que se sabe que não bate; o organizador pode confirmar.
  IF NOT COALESCE(p_force_gender, false)
     AND NOT tournament_gender_fits(v_cat.gender,
                                    tournament_person_gender(p_player1_id, p_player1_gender),
                                    tournament_person_gender(p_partner_id, p_partner_gender)) THEN
    RAISE EXCEPTION 'gender_mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM tournament_entries
              WHERE category_id = p_category_id AND status <> 'desistiu'$a$
]);

SELECT pg_temp.aplicar('tournament_admin_set_partner(uuid,uuid,text,text,text)', true, ARRAY[
$a$p_partner_gender text DEFAULT NULL::text)
 RETURNS jsonb$a$,
$a$p_partner_gender text DEFAULT NULL::text, p_force_gender boolean DEFAULT false)
 RETURNS jsonb$a$,

$a$  IF p_partner_id IS NULL THEN v_token := tournament_new_invite_token(); END IF;$a$,
$a$  -- #788: só recusa o que se sabe que não bate; o organizador pode confirmar.
  IF NOT COALESCE(p_force_gender, false)
     AND NOT tournament_gender_fits(v_cat.gender,
                                    tournament_person_gender(v_entry.player1_id),
                                    tournament_person_gender(p_partner_id, p_partner_gender)) THEN
    RAISE EXCEPTION 'gender_mismatch';
  END IF;

  IF p_partner_id IS NULL THEN v_token := tournament_new_invite_token(); END IF;$a$
]);

SELECT pg_temp.aplicar('tournament_admin_replace_player(uuid,integer,uuid,text,text,text)', true, ARRAY[
$a$p_player_gender text DEFAULT NULL::text)
 RETURNS jsonb$a$,
$a$p_player_gender text DEFAULT NULL::text, p_force_gender boolean DEFAULT false)
 RETURNS jsonb$a$,

$a$  IF p_slot = 1 THEN
    UPDATE tournament_entries$a$,
$a$  -- #788: só recusa o que se sabe que não bate; o organizador pode confirmar.
  IF NOT COALESCE(p_force_gender, false)
     AND NOT tournament_gender_fits(v_cat.gender,
                                    tournament_person_gender(p_player_id, p_player_gender),
                                    tournament_person_gender(v_other)) THEN
    RAISE EXCEPTION 'gender_mismatch';
  END IF;

  IF p_slot = 1 THEN
    UPDATE tournament_entries$a$
]);

-- ── Acessos: recriar uma função volta a abri-la a toda a gente ────────────

REVOKE ALL ON FUNCTION public.tournament_signup(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_change_partner(uuid,uuid,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_respond_invite(uuid,boolean,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_claim_entry(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_admin_set_partner(uuid,uuid,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_admin_replace_player(uuid,integer,uuid,text,text,text,boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tournament_signup(uuid,uuid,text,text,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tournament_change_partner(uuid,uuid,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tournament_respond_invite(uuid,boolean,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tournament_claim_entry(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tournament_admin_set_partner(uuid,uuid,text,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tournament_admin_replace_player(uuid,integer,uuid,text,text,text,boolean) TO authenticated, service_role;

DO $$
DECLARE
  v_sig TEXT;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.tournament_signup(uuid,uuid,text,text,text,text,text,text)',
    'public.tournament_change_partner(uuid,uuid,text,text,text)',
    'public.tournament_respond_invite(uuid,boolean,text)',
    'public.tournament_claim_entry(text)',
    'public.tournament_admin_signup(uuid,uuid,uuid,text,text,text,boolean,text,text,text,text,text,text,boolean)',
    'public.tournament_admin_set_partner(uuid,uuid,text,text,text,boolean)',
    'public.tournament_admin_replace_player(uuid,integer,uuid,text,text,text,boolean)'
  ] LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'Acessos errados em %', v_sig;
    END IF;
    IF position('#788' IN pg_get_functiondef(v_sig::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'Sem a regra nova em %', v_sig;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.tournament_person_gender(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tournament_person_gender(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tournament_gender_fits(text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tournament_gender_fits(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'As funções de apoio ficaram abertas';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
