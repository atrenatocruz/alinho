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
--   1. A categoria volta a `inscricoes`.
--   2. As `selecionada` voltam ao estado de inscritas. O fecho juntou num
--      só estado as validadas e as por validar; a diferença fica em
--      `validated_at`: com validação → `validada`, sem → `por_validar`.
--   3. Os suplentes ficam suplentes, com a MESMA ordem — ninguém perde o
--      lugar na fila. Se houver vagas livres (o organizador escolheu menos
--      duplas do que as vagas), sobem pela ordem, como numa desistência
--      (`tournament_promote_waitlist`). Quem já tinha sido validado volta a
--      `validada`, e não a `por_validar`.
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
  v_promoted   INTEGER := 0;
  v_next       UUID;
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

  -- 1. A categoria volta a receber inscrições.
  UPDATE tournament_categories SET status = 'inscricoes' WHERE id = p_category_id;

  -- 2. As escolhidas voltam a inscritas, com a validação que tinham.
  UPDATE tournament_entries
     SET status = CASE WHEN validated_at IS NOT NULL THEN 'validada' ELSE 'por_validar' END,
         waitlist_order = NULL
   WHERE category_id = p_category_id AND status = 'selecionada';
  GET DIAGNOSTICS v_back = ROW_COUNT;

  -- 3. Vagas livres: sobem os suplentes, pela ordem da fila.
  LOOP
    v_next := tournament_promote_waitlist(p_category_id);
    EXIT WHEN v_next IS NULL;
    v_promoted := v_promoted + 1;
    UPDATE tournament_entries SET status = 'validada'
     WHERE id = v_next AND status = 'por_validar' AND validated_at IS NOT NULL;
  END LOOP;

  -- 4. O torneio volta a receber inscrições se estava só fechado.
  UPDATE tournaments SET status = 'inscricoes'
   WHERE id = v_tournament AND status = 'fechado';

  SELECT entries_deadline INTO v_deadline FROM tournaments WHERE id = v_tournament;

  RETURN jsonb_build_object(
    'back_in',         v_back,
    'promoted',        v_promoted,
    'waitlist',        (SELECT count(*) FROM tournament_entries
                         WHERE category_id = p_category_id AND status = 'suplente'),
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
--                      'tournament_promote_waitlist', 'reopen_category_entries');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'tournament_entries'
--      AND column_name IN ('validated_at', 'partner_accepted_at', 'waitlist_order');
-- Esperado: as três primeiras funções existem, a última ainda não; as três colunas existem.
