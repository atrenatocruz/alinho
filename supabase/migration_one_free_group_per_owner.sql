-- ════════════════════════════════════════════════════════════════════════
-- Migration: um grupo Free/Squad por DONO — ser admin de outros não conta.
--
-- Francisco, 18 set 2026:
-- "quero que toda a gente possa ter um grupo mesmo que seja convidado a ser
-- admin para outros grupos" e "fica então um grupo por pessoa mas pode ser
-- admin de outros grupos (...) podemos manter essa regra até ao nível
-- community e club. Aí permitimos mais um grupo até que suba esse tb.
-- Fazemos com que um utilizador possa ter vários grupos subscritos."
--
-- PROPOSTA — A VALIDAR PELO RENATO (muda a regra "um grupo self-serve por
-- pessoa" de migration_self_serve_groups.sql).
--
-- A REGRA
-- Só pode criar um grupo novo quem NÃO é dono de nenhum grupo em Free ou
-- Squad. Quem já tem o seu grupo em Community ou Club pode criar mais um;
-- esse começa em Free, e quando também subir pode criar outro. Uma pessoa
-- pode ter vários grupos pagos, mas nunca mais do que um barato de cada vez
-- — é isso que impede partir uma comunidade em vários grupos grátis de 30
-- para fugir ao Squad.
--
-- O QUE ERA E PORQUE ESTAVA ERRADO
-- A regra antiga contava os grupos self-serve em que a pessoa era ADMIN.
-- Ser convidado para admin do grupo de um amigo tirava o direito de criar o
-- próprio grupo. Agora conta-se o DONO (organizations.owner_id, preenchido
-- por trg_set_owner_on_first_admin — migration_organization_owner_and_
-- admin_invites.sql).
--
-- Conta qualquer grupo de topo de que a pessoa é dona, criado por ela ou
-- pelo admin da plataforma em nome dela. Grupos dentro de um clube não
-- contam (são do clube). O admin da plataforma cria por create_organization,
-- que não passa por aqui, e por isso não tem limite.
--
-- AO BAIXAR DE PLANO: um grupo pago que desce a Free/Squad não se apaga nem
-- muda de dono. A pessoa pode ficar com dois grupos baratos; só não cria um
-- terceiro até um deles voltar a Community ou Club.
--
-- A mensagem de erro começa por "Já tens um grupo" — o Gerir.jsx reconhece
-- esse início para mostrar o texto certo. Não mudar sem mudar os dois.
--
-- Corrida check-then-insert aceite, como na versão anterior (ver o
-- comentário original em migration_self_serve_groups.sql §2).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Testado em alinho-dev a 18 set 2026.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_self_serve_group(p_name TEXT, p_slug TEXT)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
  v_name TEXT := TRIM(COALESCE(p_name, ''));
  v_slug TEXT := TRIM(COALESCE(p_slug, ''));
  v_blocking_name TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN
    RAISE EXCEPTION 'Precisas de uma conta registada para criar um grupo';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'O nome do grupo não pode estar vazio';
  END IF;
  IF v_slug = '' THEN
    RAISE EXCEPTION 'O identificador do grupo não pode estar vazio';
  END IF;
  IF v_slug !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'O identificador só pode conter letras minúsculas, números e hífens';
  END IF;

  -- Um grupo Free/Squad por dono (ver cabeçalho). Era: "já és admin de um
  -- grupo self-serve".
  SELECT o.name INTO v_blocking_name
  FROM organizations o
  WHERE o.owner_id = auth.uid()
    AND o.parent_organization_id IS NULL
    AND COALESCE(o.plan_tier, 'free') IN ('free', 'plus')
  LIMIT 1;

  IF v_blocking_name IS NOT NULL THEN
    RAISE EXCEPTION 'Já tens um grupo no plano Free ou Squad (%). Para criares outro, esse grupo tem de estar no plano Community ou Club.', v_blocking_name;
  END IF;

  INSERT INTO organizations (name, slug, kind, parent_organization_id, self_serve, is_global, open_join)
  VALUES (v_name, v_slug, 'group', NULL, TRUE, FALSE, FALSE)
  RETURNING id INTO v_org_id;

  -- trg_set_owner_on_first_admin torna quem cria dono do grupo.
  INSERT INTO memberships (user_id, organization_id, is_admin)
  VALUES (auth.uid(), v_org_id, TRUE);

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION create_self_serve_group(TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION create_self_serve_group(TEXT, TEXT) TO authenticated;
