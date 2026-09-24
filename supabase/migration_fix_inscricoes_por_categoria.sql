-- ═════════════════════════════════════════════════════════════════════════
-- SORTEAR UMA CATEGORIA DEIXA DE FECHAR AS INSCRIÇÕES DAS OUTRAS
-- (Dev 3, 24 set 2026) — cartão «#521», P1. Apanhado pelo QA.
--
-- Pode-se correr outra vez sem estragar: o que já estiver corrigido fica.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O ERRO
-- ─────────────────────────────────────────────────────────────────────────
-- O `draw_category` põe o TORNEIO inteiro em `sorteado` quando se sorteia a
-- primeira categoria — e isso está certo, o torneio passou a ter quadro. O
-- erro é quem pergunta depois «as inscrições estão abertas?» olhar para o
-- torneio em vez da categoria:
--
--   · `tournament_signup` recusa com `entries_closed` se o torneio não
--     estiver em `inscricoes`. Depois do primeiro sorteio, ninguém se
--     inscreve em NENHUMA categoria, mesmo nas que dizem «inscrições
--     abertas». O organizador não dá por isso, porque inscrever à mão
--     (`tournament_admin_signup`) só olha à categoria.
--
--   · `list_open_tournaments` (#462, Dev 3 — o mesmo erro, encontrado ao
--     procurar este) só lista torneios em `inscricoes`. Depois do primeiro
--     sorteio, o torneio desaparecia da Comunidade com categorias ainda
--     abertas.
--
-- No Smash Cup não morde (prazo único a 5 out, sorteio a 7), mas morde
-- qualquer torneio com categorias sorteadas em dias diferentes.
--
-- ─────────────────────────────────────────────────────────────────────────
-- A REGRA NOVA
-- ─────────────────────────────────────────────────────────────────────────
-- Quem manda é a CATEGORIA. Do torneio só interessa que não esteja em
-- rascunho nem terminado — e isto não é pormenor: as categorias nascem em
-- `inscricoes`, mesmo num torneio ainda por publicar. Tirar a verificação ao
-- torneio de todo punha um rascunho a aceitar inscrições.
--
-- O prazo do torneio continua a valer, como antes.
--
-- ─────────────────────────────────────────────────────────────────────────
-- NÃO TRAZ OS CORPOS DAS FUNÇÕES ESCRITOS
-- ─────────────────────────────────────────────────────────────────────────
-- A `tournament_signup` foi redefinida por duas migrações (a última, do
-- Renato, com o género — #433) e produção muda à mão durante o dia. Por
-- isso lê o corpo VIVO, troca só a condição, e recusa se não a encontrar —
-- em vez de adivinhar.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- tournament_signup
  c_signup_mau CONSTANT TEXT := 'v_tournament\.status\s*<>\s*''inscricoes''';
  c_signup_bom CONSTANT TEXT := 'v_tournament.status IN (''rascunho'', ''terminado'')';
  -- list_open_tournaments
  c_lista_mau1 CONSTANT TEXT := '\(t\.status\s*=\s*''inscricoes''';
  c_lista_bom1 CONSTANT TEXT := '(t.status NOT IN (''rascunho'', ''terminado'')';
  c_lista_mau2 CONSTANT TEXT := 'WHERE a\.categories_open > 0\s+OR a\.status IN \(''sorteado'', ''a_decorrer''\)';
  c_lista_bom2 CONSTANT TEXT := 'WHERE a.categories_open > 0
          OR (p_include_running AND a.status IN (''sorteado'', ''a_decorrer''))';
  f       RECORD;
  v_def   TEXT;
  v_novo  TEXT;
BEGIN
  -- ── 1. tournament_signup ──────────────────────────────────────────────
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'tournament_signup' LOOP
    IF f.prosrc ~ c_signup_mau THEN
      v_def  := pg_get_functiondef(f.oid);
      v_novo := regexp_replace(v_def, c_signup_mau, c_signup_bom, 'g');
      IF v_novo = v_def THEN
        RAISE EXCEPTION 'tournament_signup(%): encontrei a condição mas não a consegui trocar. Ler o corpo vivo.', f.args;
      END IF;
      EXECUTE v_novo;
      RAISE NOTICE 'Corrigida: tournament_signup(%)', f.args;
    ELSIF position('v_tournament.status IN (''rascunho'', ''terminado'')' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'tournament_signup(%): já estava corrigida.', f.args;
    ELSE
      RAISE EXCEPTION 'tournament_signup(%) não tem a forma esperada — alguém a mudou. Ler o corpo vivo antes de correr isto.', f.args;
    END IF;
  END LOOP;

  -- ── 2. list_open_tournaments ──────────────────────────────────────────
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'list_open_tournaments' LOOP
    IF f.prosrc ~ c_lista_mau1 AND f.prosrc ~ c_lista_mau2 THEN
      v_def  := pg_get_functiondef(f.oid);
      v_novo := regexp_replace(v_def, c_lista_mau1, c_lista_bom1, 'g');
      v_novo := regexp_replace(v_novo, c_lista_mau2, c_lista_bom2, 'g');
      IF v_novo ~ c_lista_mau1 OR v_novo ~ c_lista_mau2 THEN
        RAISE EXCEPTION 'list_open_tournaments(%): não consegui trocar as duas condições. Ler o corpo vivo.', f.args;
      END IF;
      EXECUTE v_novo;
      RAISE NOTICE 'Corrigida: list_open_tournaments(%)', f.args;
    ELSIF position('t.status NOT IN (''rascunho'', ''terminado'')' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'list_open_tournaments(%): já estava corrigida.', f.args;
    ELSE
      RAISE EXCEPTION 'list_open_tournaments(%) não tem a forma esperada — alguém a mudou. Ler o corpo vivo antes de correr isto.', f.args;
    END IF;
  END LOOP;

  -- ── 3. Confirmar ──────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'tournament_signup'
                AND p.prosrc ~ c_signup_mau) THEN
    RAISE EXCEPTION 'A tournament_signup continua a olhar para o torneio inteiro.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'list_open_tournaments'
                AND (p.prosrc ~ c_lista_mau1 OR p.prosrc ~ c_lista_mau2)) THEN
    RAISE EXCEPTION 'A list_open_tournaments continua a esconder torneios com uma categoria sorteada.';
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- PARA VER ANTES, EM PRODUÇÃO (só leitura)
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid),
--          p.prosrc ~ 'v_tournament\.status\s*<>\s*''inscricoes''' AS signup_por_corrigir,
--          p.prosrc ~ '\(t\.status\s*=\s*''inscricoes''' AS lista_por_corrigir
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname IN ('tournament_signup', 'list_open_tournaments');
