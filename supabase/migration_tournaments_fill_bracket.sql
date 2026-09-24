-- ═════════════════════════════════════════════════════════════════════════
-- PASSAR OS APURADOS DOS GRUPOS PARA O QUADRO
-- (Dev 3, 24 set 2026) — cartão «#484», a parte da base de dados.
--
-- Pode-se correr outra vez sem estragar: só cria duas funções novas, não
-- redefine nenhuma que já exista.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE FALTAVA
-- ─────────────────────────────────────────────────────────────────────────
-- O sorteio grava o quadro com TEXTO nos lugares («1.º do Grupo A»), porque
-- quando se sorteia ainda ninguém jogou. O `tournament_advance_winner` passa
-- os vencedores de ronda em ronda — mas diz, e bem, que quem passa DOS GRUPOS
-- precisa do desempate, e isso ficou por fazer. Hoje, quando os grupos
-- acabam, o quadro fica com o texto e sem duplas: ninguém consegue marcar o
-- resultado da 1.ª ronda.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO FUNCIONA
-- ─────────────────────────────────────────────────────────────────────────
-- O desempate vive nas contas da app (`tournamentFormat.js`: vitórias,
-- confronto direto, diferença de jogos, jogos ganhos — o do plano). O ecrã
-- faz a tabela de cada grupo, MOSTRA ao organizador quem passa e para onde,
-- e só quando ele confirma é que manda para aqui a lista:
--
--   p_qualified = [{ "label": "1.º do Grupo A", "entry_id": "…" }, …]
--
-- Aqui não se volta a fazer o desempate (duas contas em dois sítios
-- divergem ao primeiro acerto). Aqui verifica-se o que a base de dados
-- consegue garantir sozinha:
--   · quem chama é admin do torneio;
--   · os jogos de grupo acabaram todos;
--   · o quadro ainda não começou (nenhum jogo de eliminatória acabado);
--   · cada dupla está MESMO no grupo que o lugar diz («2.º do Grupo B» tem
--     de ser uma dupla do Grupo B), e aparece uma vez só;
--   · todos os lugares do quadro ficam preenchidos, e não há lugares a mais.
--
-- Pode-se refazer (outra vez esta função) ou desfazer
-- (`clear_bracket_from_groups`) até ao primeiro resultado do quadro. Depois
-- disso, troca-se à mão, jogo a jogo, como no resto do torneio.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fill_bracket_from_groups(p_category_id UUID, p_qualified JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_lugar     CONSTANT TEXT := '^[0-9]+\.º do (.+)$';
  v_tournament UUID;
  v_labels    TEXT[];
  v_missing   TEXT;
  v_extra     TEXT;
  v_bad       TEXT;
  v_filled    INTEGER := 0;
  v_n         INTEGER;
  q           RECORD;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode passar os apurados para o quadro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tournament_matches
                  WHERE category_id = p_category_id AND stage = 'grupo') THEN
    RAISE EXCEPTION 'Esta categoria não tem fase de grupos';
  END IF;
  IF EXISTS (SELECT 1 FROM tournament_matches
              WHERE category_id = p_category_id AND stage = 'grupo'
                AND status NOT IN ('terminado','falta','desistencia')) THEN
    RAISE EXCEPTION 'Ainda há jogos de grupo por acabar';
  END IF;
  IF EXISTS (SELECT 1 FROM tournament_matches
              WHERE category_id = p_category_id AND stage IN ('principal','secundario','3lugar')
                AND status IN ('terminado','falta','desistencia')) THEN
    RAISE EXCEPTION 'O quadro já começou: troca-se à mão, jogo a jogo';
  END IF;

  -- A lista que veio do ecrã: lugares e duplas, cada um uma vez.
  IF jsonb_typeof(p_qualified) IS DISTINCT FROM 'array' OR jsonb_array_length(p_qualified) = 0 THEN
    RAISE EXCEPTION 'Faltam os apurados';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_qualified) x
              WHERE NULLIF(trim(x->>'label'), '') IS NULL OR NULLIF(x->>'entry_id', '') IS NULL) THEN
    RAISE EXCEPTION 'Há um lugar sem dupla, ou uma dupla sem lugar';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT trim(x->>'label')) FROM jsonb_array_elements(p_qualified) x) THEN
    RAISE EXCEPTION 'Há um lugar repetido';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT x->>'entry_id') FROM jsonb_array_elements(p_qualified) x) THEN
    RAISE EXCEPTION 'Há uma dupla em dois lugares';
  END IF;

  -- Cada dupla tem de estar no grupo que o lugar diz. É isto que impede
  -- pôr como «1.º do Grupo A» uma dupla do Grupo B, por engano ou não.
  SELECT string_agg(trim(x->>'label'), ', ') INTO v_bad
    FROM jsonb_array_elements(p_qualified) x
   WHERE trim(x->>'label') !~ c_lugar
      OR NOT EXISTS (
        SELECT 1 FROM tournament_group_teams gt
          JOIN tournament_groups g ON g.id = gt.group_id
         WHERE g.category_id = p_category_id
           AND gt.entry_id = (x->>'entry_id')::uuid
           AND g.name = substring(trim(x->>'label') FROM c_lugar));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A dupla não é do grupo que o lugar diz: %', v_bad;
  END IF;

  -- Os lugares que o quadro espera — nem um a menos, nem um a mais.
  SELECT array_agg(DISTINCT s) INTO v_labels
    FROM tournament_matches m,
         LATERAL (VALUES (m.source_a), (m.source_b)) v(s)
   WHERE m.category_id = p_category_id
     AND m.stage IN ('principal','secundario')
     AND s ~ c_lugar;
  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'O quadro desta categoria não tem lugares que venham dos grupos';
  END IF;

  SELECT string_agg(l, ', ') INTO v_missing
    FROM unnest(v_labels) l
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_qualified) x WHERE trim(x->>'label') = l);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Faltam lugares do quadro: %', v_missing;
  END IF;
  SELECT string_agg(trim(x->>'label'), ', ') INTO v_extra
    FROM jsonb_array_elements(p_qualified) x
   WHERE trim(x->>'label') <> ALL (v_labels);
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'Estes lugares não existem no quadro: %', v_extra;
  END IF;

  -- Preencher. Refazer escreve por cima do que lá estava (ainda não houve
  -- resultados no quadro, já se viu).
  FOR q IN SELECT trim(x->>'label') AS label, (x->>'entry_id')::uuid AS entry_id
             FROM jsonb_array_elements(p_qualified) x LOOP
    UPDATE tournament_matches SET entry_a_id = q.entry_id
     WHERE category_id = p_category_id AND stage IN ('principal','secundario')
       AND source_a = q.label;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_filled := v_filled + v_n;
    UPDATE tournament_matches SET entry_b_id = q.entry_id
     WHERE category_id = p_category_id AND stage IN ('principal','secundario')
       AND source_b = q.label;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_filled := v_filled + v_n;
  END LOOP;

  RETURN jsonb_build_object('places', jsonb_array_length(p_qualified), 'filled', v_filled);
END;
$$;

-- ── Desfazer ─────────────────────────────────────────────────────────────
-- Tira as duplas dos lugares que vêm dos grupos (o texto fica). Só até ao
-- primeiro resultado do quadro.
CREATE OR REPLACE FUNCTION clear_bracket_from_groups(p_category_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_lugar      CONSTANT TEXT := '^[0-9]+\.º do (.+)$';
  v_tournament UUID;
  v_n          INTEGER;
  v_total      INTEGER := 0;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode mexer no quadro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM tournament_matches
              WHERE category_id = p_category_id AND stage IN ('principal','secundario','3lugar')
                AND status IN ('terminado','falta','desistencia')) THEN
    RAISE EXCEPTION 'O quadro já começou: troca-se à mão, jogo a jogo';
  END IF;

  UPDATE tournament_matches SET entry_a_id = NULL
   WHERE category_id = p_category_id AND stage IN ('principal','secundario')
     AND source_a ~ c_lugar AND entry_a_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;
  UPDATE tournament_matches SET entry_b_id = NULL
   WHERE category_id = p_category_id AND stage IN ('principal','secundario')
     AND source_b ~ c_lugar AND entry_b_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_total + v_n;
END;
$$;

REVOKE ALL ON FUNCTION fill_bracket_from_groups(UUID, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION clear_bracket_from_groups(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION fill_bracket_from_groups(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_bracket_from_groups(UUID) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- ANTES DE CORRER, EM PRODUÇÃO (só leitura): as funções de que esta depende
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('tournament_of_category', 'is_tournament_admin',
--                      'fill_bracket_from_groups', 'clear_bracket_from_groups');
-- Esperado: as duas primeiras existem; as duas últimas ainda não.
