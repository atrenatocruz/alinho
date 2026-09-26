-- ═════════════════════════════════════════════════════════════════════════
-- Mix: o sexo do mix deixa de bloquear a inscrição.
-- Decisão do Francisco, 26 set, 02h: o sexo nunca bloqueia; pergunta-se no
-- ecrã («tens a certeza?», «Agora não»).
--
-- ⚖️ A policy é do Renato («Users can join games in their org», de
-- migration_mix_age_restriction.sql). Muda por decisão do Francisco; aviso
-- no #dev-updates.
--
-- O que se passava (Dev 2, lido em produção): a policy de INSERT em
-- participants exige profiles.gender = gender_restriction, para o jogador e
-- para o parceiro. Quem não tem sexo no perfil era recusado com um erro cru
-- (42501), mesmo com o trigger participants_gender_guard (cc4c706) a deixar
-- passar.
--
-- O que faz: tira a verificação do sexo da policy. Decisão final do
-- Francisco (26 set, 02h): o sexo NUNCA bloqueia, nem nos mixes nem nos
-- torneios — o admin tira a pessoa se vir que não é para ali, e a app só
-- pergunta «tens a certeza?» (ecrã, Dev 2). Por isso também não há trigger
-- a travar o sexo: se a trava de cc4c706 tiver sido corrida, este ficheiro
-- apaga-a.
-- O resto da policy fica igual: a própria pessoa, membro da organização do
-- mix, e o escalão etário (meets_age_restriction) para ela e para o
-- parceiro.
--
-- Parte da policy viva: antes de a trocar, compara-a com a versão esperada
-- (a de migration_mix_age_restriction.sql) criando uma cópia temporária na
-- mesma tabela e comparando as duas expressões normalizadas. Se forem
-- diferentes, pára — alguém a mudou e é preciso ler. Se já não tiver o sexo,
-- diz «já estava». Tudo numa transação.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_live     TEXT;
  v_expected TEXT;
BEGIN
  SELECT pg_get_expr(p.polwithcheck, p.polrelid) INTO v_live
    FROM pg_policy p
   WHERE p.polrelid = 'public.participants'::regclass
     AND p.polname = 'Users can join games in their org';
  IF v_live IS NULL THEN
    RAISE EXCEPTION 'Não existe a policy «Users can join games in their org» em participants. Parar e ler.';
  END IF;
  IF position('gender' IN v_live) = 0 THEN
    RAISE NOTICE 'A policy já não verifica o sexo: já estava.';
    RETURN;
  END IF;

  -- A versão esperada, criada ao lado só para comparar.
  EXECUTE $p$
    CREATE POLICY "tmp_esperada_join_games" ON public.participants FOR INSERT
    WITH CHECK (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
        WHERE games.id = participants.game_id AND memberships.user_id = auth.uid()
      )
      AND (
        (SELECT gender_restriction FROM games WHERE games.id = participants.game_id) IN ('indiferente', 'misto')
        OR (
          (SELECT gender FROM profiles WHERE id = participants.user_id)
            = (SELECT gender_restriction FROM games WHERE games.id = participants.game_id)
          AND (
            participants.partner_id IS NULL
            OR (SELECT gender FROM profiles WHERE id = participants.partner_id)
                 = (SELECT gender_restriction FROM games WHERE games.id = participants.game_id)
          )
        )
      )
      AND meets_age_restriction(
            participants.user_id,
            (SELECT age_restriction FROM games WHERE games.id = participants.game_id))
      AND (
        participants.partner_id IS NULL
        OR meets_age_restriction(
             participants.partner_id,
             (SELECT age_restriction FROM games WHERE games.id = participants.game_id))
      )
    )$p$;
  SELECT pg_get_expr(p.polwithcheck, p.polrelid) INTO v_expected
    FROM pg_policy p
   WHERE p.polrelid = 'public.participants'::regclass AND p.polname = 'tmp_esperada_join_games';
  EXECUTE 'DROP POLICY "tmp_esperada_join_games" ON public.participants';

  IF v_live IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'A policy «Users can join games in their org» não é a esperada (migration_mix_age_restriction.sql). Ler a viva antes de correr.';
  END IF;

  EXECUTE 'DROP POLICY "Users can join games in their org" ON public.participants';
  EXECUTE $p$
    CREATE POLICY "Users can join games in their org" ON public.participants FOR INSERT
    WITH CHECK (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
        WHERE games.id = participants.game_id AND memberships.user_id = auth.uid()
      )
      -- O sexo já não se verifica (decisão do Francisco, 26 set, 02h: nunca
      -- bloqueia; o admin tira quem não for para ali).
      AND meets_age_restriction(
            participants.user_id,
            (SELECT age_restriction FROM games WHERE games.id = participants.game_id))
      AND (
        participants.partner_id IS NULL
        OR meets_age_restriction(
             participants.partner_id,
             (SELECT age_restriction FROM games WHERE games.id = participants.game_id))
      )
    )$p$;
  RAISE NOTICE 'Policy de inscrição em mixes: o sexo deixa de ser verificado (decisão do Francisco, 26 set).';
END $$;

-- A trava do sexo de cc4c706 também não fica (se alguém a correu).
DROP TRIGGER IF EXISTS participants_gender_guard_trigger ON public.participants;
DROP FUNCTION IF EXISTS public.participants_gender_guard();

COMMIT;
