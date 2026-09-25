-- ═════════════════════════════════════════════════════════════════════════
-- #491 (2/2) — Desfazer uma falta ou desistência marcada por engano
-- (undo_walkover). Plano aprovado pelo Francisco a 25 set.
--
-- ⚖️ PROPOSTA, POR ACORDAR COM O RENATO: o passo 1 abre uma exceção à regra
-- #17 dele (tournament_entries_guard, migration_tournaments_integridade
-- .sql: «uma inscrição `desistiu` nunca volta»). Não correr antes do sim
-- dele no #dev-updates. A parte 1/2 (migration_tournament_walkover_guards
-- .sql) não depende disto e pode correr antes.
--
-- Num torneio de 3 dias, uma falta marcada no jogo errado não tinha volta.
-- A chamada já está no ecrã do Dev 1 (tournamentApi.js, undoWalkover).
--
-- QUEM: só o organizador do torneio (is_tournament_admin).
-- QUANDO: só num jogo `falta` ou `desistencia`, com a categoria ainda por
-- terminar, e só enquanto o que veio a seguir não tiver resultado:
--   · no quadro: o jogo seguinte (e, numa meia-final, o do 3.º lugar);
--   · nos grupos: o «Passar ao quadro» (#484) ainda não foi feito.
-- O QUE VOLTA COMO ESTAVA (tudo o que a mark_walkover fez):
--   · o jogo volta a `marcado`, sem resultado nem vencedor;
--   · no quadro, a dupla que tinha avançado sai do jogo seguinte, e quem
--     perdeu a meia-final sai do jogo do 3.º lugar;
--   · nos grupos, os jogos que a falta deu por perdidos a essa dupla (#459)
--     voltam a `marcado`. Reconhecem-se sem margem: foram gravados na mesma
--     transação, por isso têm o MESMO `ended_at` do jogo da falta, e são
--     da dupla que saiu;
--   · o registo de quem jogou (tournament_match_players) desses jogos
--     apaga-se: o jogo não aconteceu, e fica por congelar quando se jogar;
--   · a dupla que faltou volta ao torneio (`desistiu` → `selecionada`).
--     É aqui que entra a exceção à regra #17: vale só para essa inscrição,
--     só dentro desta função e desta transação (um marcador com o id dela).
-- Faltas e desistências não dão pontos de ranking, por isso não há pontos
-- a desfazer.
--
-- Parte do corpo vivo do tournament_entries_guard (troca só o fragmento,
-- recusa se não o encontrar exatamente uma vez, «já estava» se repetido).
-- REVOKE explícito de PUBLIC e anon; GRANT só a authenticated.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.tournament_entries_guard()') IS NULL THEN
    RAISE EXCEPTION 'Não existe o tournament_entries_guard (migration_tournaments_integridade.sql). Parar e ler.';
  END IF;
  IF to_regprocedure('public.is_tournament_admin(uuid)') IS NULL
     OR to_regprocedure('public.tournament_of_category(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam is_tournament_admin ou tournament_of_category. Parar e ler.';
  END IF;
  IF to_regclass('public.tournament_match_players') IS NULL THEN
    RAISE EXCEPTION 'Falta a tabela tournament_match_players (migration_tournaments_who_played.sql). Parar e ler.';
  END IF;
END $$;

-- ── 1. A exceção à regra #17 (PROPOSTA ao Renato) ───────────────────────
DO $$
DECLARE
  c_volta_mau CONSTANT TEXT :=
    '(IF TG_OP = ''UPDATE'' AND OLD\.status = ''desistiu'' AND NEW\.status <> ''desistiu'')(\s+THEN)';
  c_volta_bom CONSTANT TEXT := '\1
     -- #491: só o undo_walkover traz de volta quem a falta tirou, e só a
     -- inscrição que ele marcou (proposta ao Renato, 25 set).
     AND NEW.id::text IS DISTINCT FROM current_setting(''alinho.desfazer_falta'', true)\2';
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.tournament_entries_guard()'::regprocedure);
  IF position('alinho.desfazer_falta' IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_entries_guard: a exceção do #491 já estava.';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_volta_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'tournament_entries_guard mudou: a regra #17 não aparece exatamente uma vez. Ler o corpo vivo.';
  END IF;
  EXECUTE regexp_replace(v_def, c_volta_mau, c_volta_bom);
  IF position('alinho.desfazer_falta' IN pg_get_functiondef('public.tournament_entries_guard()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'tournament_entries_guard: a exceção do #491 não ficou. Parar e ler.';
  END IF;
  RAISE NOTICE 'tournament_entries_guard: undo_walkover pode trazer de volta a inscrição da falta.';
END $$;

-- ── 2. Desfazer ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.undo_walkover(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  nm           tournament_matches;
  v_tournament UUID;
  v_loser      UUID;
  v_next       TEXT;
  v_ids        UUID[];
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id FOR UPDATE;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  v_tournament := tournament_of_category(m.category_id);
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só o organizador pode desfazer uma falta'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF m.status NOT IN ('falta', 'desistencia') THEN
    RAISE EXCEPTION 'Este jogo não está marcado como falta nem como desistência';
  END IF;
  IF (SELECT status FROM tournament_categories WHERE id = m.category_id) = 'terminada' THEN
    RAISE EXCEPTION 'Esta categoria já terminou: a falta já não se desfaz';
  END IF;

  v_loser := CASE WHEN m.winner_entry_id = m.entry_a_id THEN m.entry_b_id ELSE m.entry_a_id END;
  v_ids := ARRAY[m.id];

  IF m.stage = 'grupo' THEN
    -- Com o quadro já preenchido a partir dos grupos, desfazer mudava quem
    -- se apurou por baixo dos pés de quem já lá está.
    IF EXISTS (SELECT 1 FROM tournament_matches
                WHERE category_id = m.category_id AND stage <> 'grupo'
                  AND (entry_a_id IS NOT NULL OR entry_b_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'O quadro já tem os apurados dos grupos. Desfaz primeiro o «Passar ao quadro»';
    END IF;
    -- Os jogos que a mesma falta deu por perdidos (#459): mesma transação,
    -- logo o mesmo ended_at, e da dupla que saiu.
    v_ids := v_ids || ARRAY(
      SELECT id FROM tournament_matches
       WHERE category_id = m.category_id AND stage = 'grupo' AND id <> m.id
         AND status = 'falta' AND ended_at = m.ended_at
         AND v_loser IN (entry_a_id, entry_b_id));
  ELSIF m.bracket_slot IS NOT NULL THEN
    v_next := CASE m.round WHEN 'R32' THEN 'R16' WHEN 'R16' THEN 'QF'
                           WHEN 'QF' THEN 'SF' WHEN 'SF' THEN 'F' ELSE NULL END;
    IF v_next IS NOT NULL THEN
      SELECT * INTO nm FROM tournament_matches
       WHERE category_id = m.category_id AND stage = m.stage
         AND round = v_next AND bracket_slot = ceil(m.bracket_slot / 2.0);
      IF nm.id IS NOT NULL
         AND (nm.status IN ('terminado', 'falta', 'desistencia')
              OR nm.score_a IS NOT NULL OR nm.score_b IS NOT NULL) THEN
        RAISE EXCEPTION 'O jogo seguinte já tem resultado. Desfaz primeiro esse';
      END IF;
      IF m.round = 'SF' AND EXISTS (
           SELECT 1 FROM tournament_matches
            WHERE category_id = m.category_id AND stage = '3lugar'
              AND (status IN ('terminado', 'falta', 'desistencia')
                   OR score_a IS NOT NULL OR score_b IS NOT NULL)) THEN
        RAISE EXCEPTION 'O jogo do 3.º e 4.º lugar já tem resultado. Desfaz primeiro esse';
      END IF;

      -- Quem avançou sai do jogo seguinte (o lado é o da tournament_advance
      -- _winner: lugar ímpar → A, par → B).
      IF nm.id IS NOT NULL THEN
        UPDATE tournament_matches SET
          entry_a_id = CASE WHEN m.bracket_slot % 2 = 1 AND entry_a_id = m.winner_entry_id THEN NULL ELSE entry_a_id END,
          entry_b_id = CASE WHEN m.bracket_slot % 2 = 0 AND entry_b_id = m.winner_entry_id THEN NULL ELSE entry_b_id END
         WHERE id = nm.id;
      END IF;
      -- E quem perdeu a meia-final sai do jogo do 3.º lugar.
      IF m.round = 'SF' THEN
        UPDATE tournament_matches SET
          entry_a_id = CASE WHEN m.bracket_slot % 2 = 1 AND entry_a_id = v_loser THEN NULL ELSE entry_a_id END,
          entry_b_id = CASE WHEN m.bracket_slot % 2 = 0 AND entry_b_id = v_loser THEN NULL ELSE entry_b_id END
         WHERE category_id = m.category_id AND stage = '3lugar';
      END IF;
    END IF;
  END IF;

  -- O jogo (e os da cadeia) não aconteceu: sem resultado, e quem jogou
  -- fica por congelar para quando se jogar.
  DELETE FROM tournament_match_players WHERE match_id = ANY (v_ids);
  UPDATE tournament_matches SET
    score_a = NULL, score_b = NULL, sets = NULL,
    status = 'marcado', winner_entry_id = NULL,
    walkover_justified = NULL, ended_at = NULL
   WHERE id = ANY (v_ids);

  -- A dupla que a falta tirou volta ao torneio. Exceção à regra #17, só
  -- para esta inscrição e só nesta transação.
  IF v_loser IS NOT NULL
     AND (SELECT status FROM tournament_entries WHERE id = v_loser) = 'desistiu' THEN
    PERFORM set_config('alinho.desfazer_falta', v_loser::text, true);
    UPDATE tournament_entries SET status = 'selecionada' WHERE id = v_loser;
    PERFORM set_config('alinho.desfazer_falta', '', true);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.undo_walkover(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_walkover(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.undo_walkover(UUID) TO authenticated;

-- ── 3. Confirmação ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.undo_walkover(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda pode chamar undo_walkover. Parar e ler.';
  END IF;
  RAISE NOTICE '#491: undo_walkover pronta.';
END $$;
