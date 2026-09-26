-- ═════════════════════════════════════════════════════════════════════════
-- Convite de parceiro sem conta: quem o criou, ou quem já está no mix,
-- deixa de poder ficar com o lugar.
--
-- PORQUÊ (visto em produção pelo SI, 26 set): a claim_partner_invite só
-- recusava a própria conta por reclamar.
--   · M4 de terça do A2N: o Nuno Rodrigues inscreveu-se com o parceiro sem
--     conta «João Rodrigues» e, 23 s depois, abriu ele próprio o link — ficou
--     parceiro de si mesmo, e a conta do João passou a «Jogador removido».
--   · M5: o João Silva Santos Rodrigues, já inscrito, abriu o link do
--     «José Metello» e ficou com o lugar dele.
-- O Francisco pediu a correção em produção hoje. Versão mínima (PO):
--   1. quem criou o convite não o reclama   → erro 'invite_is_yours'
--   2. quem já está nesse mix não o reclama → erro 'already_in_game'
-- O «Este convite é para X. És tu?» antes de aceitar fica no ecrã (Dev 2);
-- daqui vai só a leitura do convite sem o aceitar (get_partner_invite).
-- A reparação dos dois casos vai num ficheiro à parte.
--
-- COMO: parte do corpo VIVO da função e acrescenta as duas travas logo a
-- seguir à que já existe (a da própria conta por reclamar). Pára se não
-- encontrar esse bloco exatamente uma vez; diz «já estava» se já correu.
-- Não muda a assinatura nem mais nada da função.
--
-- Dev 3, 26 set 2026 · a seguir a migration_partner_without_account.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT :=
    '(IF v_me = v_invite\.placeholder_id THEN\s+RAISE EXCEPTION ''invite_is_your_own_placeholder'';\s+END IF;)';
  c_bom CONSTANT TEXT := '\1

  -- Quem criou o convite não fica com o lugar do parceiro (26 set).
  IF v_me = v_invite.invited_by THEN
    RAISE EXCEPTION ''invite_is_yours'';
  END IF;

  -- Quem já está inscrito neste mix também não (26 set).
  IF EXISTS (SELECT 1 FROM participants
              WHERE game_id = v_invite.game_id AND (user_id = v_me OR partner_id = v_me))
     OR EXISTS (SELECT 1 FROM teams
                 WHERE game_id = v_invite.game_id AND (player1_id = v_me OR player2_id = v_me)) THEN
    RAISE EXCEPTION ''already_in_game'';
  END IF;';
  v_def TEXT;
  v_n   INTEGER;
BEGIN
  IF to_regprocedure('public.claim_partner_invite(text)') IS NULL THEN
    RAISE EXCEPTION 'Falta claim_partner_invite(text). Parar e ler.';
  END IF;
  v_def := pg_get_functiondef('public.claim_partner_invite(text)'::regprocedure);
  IF v_def LIKE '%invite_is_yours%' AND v_def LIKE '%already_in_game%' THEN
    RAISE NOTICE 'claim_partner_invite: já estava';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_mau, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'claim_partner_invite: esperava a trava da conta por reclamar 1 vez, encontrei %. Parar e ler.', v_n;
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE ALL ON FUNCTION public.claim_partner_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_partner_invite(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_partner_invite(text) TO authenticated;

-- Ler o convite sem o aceitar, para o ecrã perguntar «Este convite é para
-- José Metello. És tu?» antes de ficar com o lugar (Dev 2). Só com o token,
-- como o link; não devolve o email.
CREATE OR REPLACE FUNCTION public.get_partner_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'guest_name', i.name,
           'game_id', i.game_id,
           'game_title', g.title,
           'inviter_name', p.name,
           'status', CASE WHEN i.status = 'pending' AND i.expires_at < TIMEZONE('utc', NOW())
                          THEN 'expired' ELSE i.status END)
    FROM partner_invites i
    LEFT JOIN games g ON g.id = i.game_id
    LEFT JOIN profiles p ON p.id = i.invited_by
   WHERE i.token = p_token AND auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_partner_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_invite(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_invite(text) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.claim_partner_invite(text)'::regprocedure) LIKE '%invite_is_yours%';  -- true
--   SELECT has_function_privilege('anon', 'public.claim_partner_invite(text)', 'EXECUTE');                  -- false
--   SELECT has_function_privilege('anon', 'public.get_partner_invite(text)', 'EXECUTE');                    -- false
