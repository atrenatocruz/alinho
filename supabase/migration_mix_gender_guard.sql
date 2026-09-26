-- ═════════════════════════════════════════════════════════════════════════
-- Mix: o sexo do mix (gender_restriction) passa a ser travado na base de
-- dados, venha a inscrição de onde vier. Regra do Francisco, 26 set:
-- «Os mistos têm de ser uma dupla mulher e homem ou homem e mulher em todos
-- os lados a não ser que o admin dê permissão. Em tudo pode haver exceção.»
--
-- O que se passava: só a policy de INSERT «Users can join games in their
-- org» verifica o sexo, e só quando a pessoa se inscreve a si própria. A
-- troca de parceiro e o robô do WhatsApp (service role, sem RLS) passavam
-- sem verificação, e o misto não era verificado em lado nenhum.
--
-- O que faz: um trigger BEFORE INSERT OR UPDATE em participants, só quando
-- alguém entra, muda de mix ou muda de parceiro:
--   · mix «masculino» ou «feminino»: recusa quem (pessoa ou parceiro) tem
--     sexo no perfil e não bate com o do mix;
--   · mix «misto»: uma dupla que se inscreve junta (com partner_id) tem de
--     ser um homem e uma mulher — recusa quando os dois têm sexo no perfil
--     e é o mesmo;
--   · «indiferente»: não trava;
--   · sem sexo no perfil: deixa passar — os convidados do robô não o têm,
--     e o ecrã do Dev 2 pede-o a quem tem conta;
--   · A EXCEÇÃO É O ADMIN: quando quem faz a inscrição é admin do grupo ou
--     clube do mix (is_org_admin), passa sempre — é a permissão dele.
-- Não mexe em quem já está inscrito: só olha para quem entra ou muda.
-- Nos torneios a regra dos mistos já existe (#19, do Renato); a exceção
-- dada pelo admin nos torneios fica para outra tarefa, como proposta.
--
-- Função nova do trigger: REVOKE explícito de PUBLIC, anon e authenticated
-- (só o trigger a chama).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'games'
                    AND column_name = 'gender_restriction') THEN
    RAISE EXCEPTION 'Falta games.gender_restriction. Parar e ler.';
  END IF;
  IF to_regprocedure('public.is_org_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta is_org_admin(uuid). Parar e ler.';
  END IF;
END $$;

-- ── 1. A trava ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.participants_gender_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule   TEXT;
  v_org    UUID;
  v_person UUID;
  v_gender TEXT;
  v_name   TEXT;
  v_g1     TEXT;
  v_g2     TEXT;
BEGIN
  -- Um UPDATE que regrava as mesmas pessoas no mesmo mix não é uma entrada
  -- nova: não se volta a julgar quem já lá estava.
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.partner_id IS NOT DISTINCT FROM OLD.partner_id
     AND NEW.game_id IS NOT DISTINCT FROM OLD.game_id THEN
    RETURN NEW;
  END IF;

  SELECT gender_restriction, organization_id INTO v_rule, v_org FROM games WHERE id = NEW.game_id;
  IF v_rule IS NULL OR v_rule NOT IN ('masculino', 'feminino', 'misto') THEN
    RETURN NEW;
  END IF;
  -- A exceção: o admin do grupo ou clube pode pôr quem quiser.
  IF is_org_admin(v_org) THEN
    RETURN NEW;
  END IF;

  IF v_rule = 'misto' THEN
    IF NEW.partner_id IS NULL THEN RETURN NEW; END IF;
    SELECT NULLIF(gender, '') INTO v_g1 FROM profiles WHERE id = NEW.user_id;
    SELECT NULLIF(gender, '') INTO v_g2 FROM profiles WHERE id = NEW.partner_id;
    IF v_g1 IS NOT NULL AND v_g1 = v_g2 THEN
      RAISE EXCEPTION 'Este mix é misto: a dupla tem de ser um homem e uma mulher'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  FOREACH v_person IN ARRAY array_remove(ARRAY[NEW.user_id, NEW.partner_id], NULL) LOOP
    SELECT NULLIF(gender, ''), name INTO v_gender, v_name FROM profiles WHERE id = v_person;
    IF v_gender IS NOT NULL AND v_gender <> v_rule THEN
      RAISE EXCEPTION 'Este mix é só para %: % não pode entrar',
        CASE v_rule WHEN 'masculino' THEN 'homens' ELSE 'mulheres' END,
        COALESCE(v_name, 'esta pessoa')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.participants_gender_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.participants_gender_guard() FROM anon;
REVOKE ALL ON FUNCTION public.participants_gender_guard() FROM authenticated;

DROP TRIGGER IF EXISTS participants_gender_guard_trigger ON public.participants;
CREATE TRIGGER participants_gender_guard_trigger
  BEFORE INSERT OR UPDATE OF user_id, partner_id, game_id ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.participants_gender_guard();

-- ── 2. Confirmação ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'participants_gender_guard_trigger'
                    AND tgrelid = 'public.participants'::regclass) THEN
    RAISE EXCEPTION 'A trava do sexo não ficou ligada. Parar e ler.';
  END IF;
  RAISE NOTICE 'Mix: o sexo do mix passa a ser travado; o admin pode abrir exceção.';
END $$;
