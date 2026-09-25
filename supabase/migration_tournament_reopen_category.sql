-- ═════════════════════════════════════════════════════════════════════════
-- REABRIR AS INSCRIÇÕES DE UMA CATEGORIA (SÓ ANTES DO SORTEIO)
-- (Dev 3, 24 set 2026) — cartão «#517», pedido do Francisco («sim às duas»).
-- Tem de estar em produção antes de 5 out (fecho das inscrições do Smash Cup).
--
-- Pode-se correr outra vez sem estragar: só cria uma função nova.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE FALTAVA
-- ─────────────────────────────────────────────────────────────────────────
-- Havia «Fechar inscrições» (`close_category_entries`) e não havia o
-- caminho de volta: um organizador que fechasse cedo de mais, ou que
-- quisesse deixar entrar mais uma dupla antes do sorteio, ficava preso. A
-- `set_tournament_status` só mexe no torneio.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE FAZ — o contrário do fecho, até onde o fecho se pode desfazer
-- ─────────────────────────────────────────────────────────────────────────
-- Desenho aprovado pelo Francisco a 25 set
-- (design-handoff/2026-09-25-torneio-reabrir-e-cabecas/SPEC.md, §1): «As N
-- escolhidas e os N suplentes voltam a ficar só inscritos — escolhes outra
-- vez quando fechares.»
--   1. As `selecionada` E os `suplente` voltam ao estado de inscritas. O
--      fecho juntou validadas e por validar num só estado; a diferença fica
--      em `validated_at`: com validação → `validada`, sem → `por_validar`.
--      Um suplente cujo parceiro nunca disse que sim (entrou em suplente
--      logo na inscrição) volta a `convite`, com 3 dias para responder — como
--      quando sobe da lista de espera; sem parceiro nenhum, `sem_parceiro`.
--   2. A ordem que os suplentes tinham FICA guardada (`waitlist_order`): se
--      o organizador fechar outra vez sem dar ordem, é essa a que vale
--      primeiro. As escolhidas ficam sem ordem.
--   3. SÓ DEPOIS a categoria volta a `inscricoes`. A ordem importa: com a
--      categoria ainda fechada, a tranca das vagas do Renato
--      (`tournament_entries_guard`, #16) não conta estas mudanças — as
--      duplas já lá estavam, não estão a entrar agora. Pode ficar com mais
--      inscritas do que vagas; quem chegar a seguir fica suplente.
--   4. O torneio volta a `inscricoes` se estava `fechado`. Se já estiver
--      `sorteado` (outra categoria sorteada), fica — quem manda é a
--      categoria (#521).
--
-- O que NÃO se desfaz: quem estava à espera do sim do parceiro ou sem
-- parceiro saiu no fecho (`desistiu`), e uma desistência não volta atrás
-- (regra do Renato, #17, em migration_tournaments_integridade.sql). Essas
-- pessoas inscrevem-se outra vez. (Não se contam: um `desistiu` do fecho é
-- igual a um de quem desistiu por vontade própria.)
--
-- Recusa:
--   · se quem chama não é admin do torneio;
--   · se a categoria já foi sorteada (ou tem jogos) — depois do sorteio as
--     inscrições não reabrem;
--   · se as inscrições já estão abertas.
-- Devolve também se o prazo do torneio já passou: nesse caso ninguém se
-- consegue inscrever até o organizador mudar o prazo, e o ecrã tem de o
-- dizer.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION reopen_category_entries(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament UUID;
  v_status     TEXT;
  v_back       INTEGER;
  v_subs       INTEGER;
  v_deadline   TIMESTAMPTZ;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode reabrir as inscrições'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status INTO v_status FROM tournament_categories WHERE id = p_category_id FOR UPDATE;
  IF v_status = 'inscricoes' THEN
    RAISE EXCEPTION 'As inscrições desta categoria já estão abertas';
  END IF;
  IF v_status <> 'fechada'
     OR EXISTS (SELECT 1 FROM tournament_matches WHERE category_id = p_category_id) THEN
    RAISE EXCEPTION 'Esta categoria já foi sorteada: as inscrições não reabrem';
  END IF;

  -- 1. As escolhidas voltam a inscritas, com a validação que tinham.
  --    (Ainda com a categoria fechada — ver o cabeçalho, ponto 3.)
  UPDATE tournament_entries
     SET status = CASE WHEN validated_at IS NOT NULL THEN 'validada' ELSE 'por_validar' END,
         waitlist_order = NULL
   WHERE category_id = p_category_id AND status = 'selecionada';
  GET DIAGNOSTICS v_back = ROW_COUNT;

  -- 2. Os suplentes também, guardando a ordem que tinham.
  UPDATE tournament_entries
     SET status = CASE
           WHEN player2_id IS NOT NULL AND partner_accepted_at IS NULL THEN 'convite'
           WHEN player2_id IS NULL AND guest_name IS NULL THEN 'sem_parceiro'
           WHEN validated_at IS NOT NULL THEN 'validada'
           ELSE 'por_validar' END,
         respond_by = CASE WHEN player2_id IS NOT NULL AND partner_accepted_at IS NULL
                           THEN NOW() + INTERVAL '3 days' ELSE respond_by END
   WHERE category_id = p_category_id AND status = 'suplente';
  GET DIAGNOSTICS v_subs = ROW_COUNT;

  -- 3. Só agora a categoria volta a receber inscrições.
  UPDATE tournament_categories SET status = 'inscricoes' WHERE id = p_category_id;

  -- 4. O torneio volta a receber inscrições se estava só fechado.
  UPDATE tournaments SET status = 'inscricoes'
   WHERE id = v_tournament AND status = 'fechado';

  SELECT entries_deadline INTO v_deadline FROM tournaments WHERE id = v_tournament;

  RETURN jsonb_build_object(
    'chosen_back',     v_back,
    'waitlist_back',   v_subs,
    'deadline_passed', v_deadline IS NOT NULL AND v_deadline < NOW());
END;
$$;

REVOKE ALL ON FUNCTION reopen_category_entries(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION reopen_category_entries(UUID) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- ANTES DE CORRER, EM PRODUÇÃO (só leitura): as peças de que depende
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('tournament_of_category', 'is_tournament_admin',
--                      'reopen_category_entries');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'tournament_entries'
--      AND column_name IN ('validated_at', 'partner_accepted_at', 'waitlist_order');
-- Esperado: as duas primeiras funções existem, a última ainda não; as três colunas existem.
