-- ═════════════════════════════════════════════════════════════════════════
-- PÁGINA DO TORNEIO: DIZER SE FUI EU QUE INSCREVI A DUPLA OU SE FUI CONVIDADO
-- (Dev 3, 24 set 2026) — pedido do Dev 1, pelo PO.
--
-- Pode-se correr outra vez sem estragar.
--
-- PORQUÊ: desistir tem efeitos diferentes. Quem inscreveu a dupla
-- (`player1_id`) tira a dupla toda; quem foi convidado (`player2_id`) sai só
-- ele. Hoje a página não diz qual dos dois sou, e a janela de desistir tem
-- de escrever os dois casos na mesma frase.
--
-- O QUE MUDA: `my_entries` e `my` (em `tournament_page_json`, que serve a
-- `get_tournament_page` e a pré-visualização) ganham um campo:
--
--   registered_by_me  BOOLEAN — TRUE: fui eu que inscrevi a dupla.
--                               FALSE: fui convidado por quem a inscreveu.
--
-- Nada mais muda: as mesmas linhas, os mesmos campos, a mesma ordem.
--
-- NÃO TRAZ O CORPO DA FUNÇÃO ESCRITO: a `tournament_page_json` foi
-- redefinida por várias migrações e já perdeu correções a meio do dia. Por
-- isso lê o corpo VIVO, acrescenta só o campo nos dois sítios, e recusa se
-- não encontrar o fragmento esperado — em vez de adivinhar.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- my_entries: a lista das minhas inscrições ativas.
  c_lista_mau CONSTANT TEXT :=
    '(SELECT\s+e\.category_id,\s*e\.status,\s*e\.status\s+AS\s+state,\s*e\.id\s+AS\s+entry_id,\s*e\.created_at)(\s+FROM)';
  -- (Um espaço e não '\n': numa string normal, '\n' fica escrito como dois
  -- carateres e a função deixava de compilar — apanhado no teste.)
  c_lista_bom CONSTANT TEXT :=
    '\1, (e.player1_id = auth.uid()) AS registered_by_me\2';
  -- my: a mais antiga (fica igual à lista, para o ecrã ler o mesmo nos dois).
  c_uma_mau CONSTANT TEXT :=
    '(SELECT\s+e\.category_id,\s*e\.status\s+AS\s+state,\s*e\.id\s+AS\s+entry_id)(\s+FROM)';
  c_uma_bom CONSTANT TEXT :=
    '\1, (e.player1_id = auth.uid()) AS registered_by_me\2';
  f      RECORD;
  v_def  TEXT;
  v_novo TEXT;
  v_n    INTEGER := 0;
BEGIN
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'tournament_page_json' LOOP
    v_n := v_n + 1;
    IF position('registered_by_me' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'tournament_page_json(%): já tinha o campo.', f.args;
      CONTINUE;
    END IF;
    IF NOT (f.prosrc ~ c_lista_mau AND f.prosrc ~ c_uma_mau) THEN
      RAISE EXCEPTION 'tournament_page_json(%) não tem a forma esperada (my / my_entries) — alguém a mudou. Ler o corpo vivo antes de correr isto.', f.args;
    END IF;
    v_def  := pg_get_functiondef(f.oid);
    v_novo := regexp_replace(v_def,  c_lista_mau, c_lista_bom);
    v_novo := regexp_replace(v_novo, c_uma_mau,   c_uma_bom);
    IF (length(v_novo) - length(replace(v_novo, 'registered_by_me', ''))) / length('registered_by_me') <> 2 THEN
      RAISE EXCEPTION 'tournament_page_json(%): não consegui acrescentar o campo nos dois sítios. Ler o corpo vivo.', f.args;
    END IF;
    EXECUTE v_novo;
    RAISE NOTICE 'Corrigida: tournament_page_json(%)', f.args;
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Não existe tournament_page_json. Parar e ler.';
  END IF;

  -- Confirmar.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'tournament_page_json'
                AND position('registered_by_me' IN p.prosrc) = 0) THEN
    RAISE EXCEPTION 'A tournament_page_json continua sem o campo registered_by_me.';
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- PARA VER ANTES, EM PRODUÇÃO (só leitura): a forma que o ficheiro espera
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT pg_get_function_identity_arguments(p.oid),
--          p.prosrc ~ 'SELECT\s+e\.category_id,\s*e\.status,\s*e\.status\s+AS\s+state,\s*e\.id\s+AS\s+entry_id,\s*e\.created_at\s+FROM' AS lista_ok,
--          p.prosrc ~ 'SELECT\s+e\.category_id,\s*e\.status\s+AS\s+state,\s*e\.id\s+AS\s+entry_id\s+FROM' AS uma_ok,
--          position('registered_by_me' IN p.prosrc) > 0 AS ja_tem
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'tournament_page_json';
-- Esperado: lista_ok e uma_ok verdadeiros, ja_tem falso.
