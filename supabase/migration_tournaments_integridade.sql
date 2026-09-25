-- ═════════════════════════════════════════════════════════════════════════
-- TORNEIOS: AS REGRAS QUE O SERVIDOR TEM DE FAZER CUMPRIR SOZINHO
-- (Renato, 24 set 2026) — do teste de ponta a ponta em produção e da revisão
-- de código do mesmo dia (lista no fio do #dev-updates: #12, #14, #16, #17,
-- #19, #20).
--
-- Pode-se correr outra vez sem estragar: os triggers são recriados, e o
-- remendo da página só acrescenta o campo se ainda lá não estiver.
--
-- REVISTO a 24 set à noite (correr outra vez): o trigger dos resultados
-- também disparava quando apagar uma inscrição punha o `winner_entry_id` a
-- NULL em cascata, e assim um torneio com jogos inválidos ou de outro dia
-- não se deixava apagar.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PORQUÊ TRIGGERS E NÃO MEXER NAS FUNÇÕES
-- ─────────────────────────────────────────────────────────────────────────
-- As funções de inscrição e de resultado foram redefinidas por várias
-- migrações e produção muda-as à mão durante o dia (ver o cabeçalho de
-- `migration_fix_inscricoes_por_categoria.sql`). Reescrevê-las a partir dos
-- ficheiros trazia de volta versões antigas (#465, #496). Um trigger na
-- tabela apanha TODOS os caminhos — os de hoje, os que vierem, e quem chama
-- a API diretamente — sem tocar no corpo de nenhuma função.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE PASSA A SER RECUSADO
-- ─────────────────────────────────────────────────────────────────────────
-- Inscrições (`tournament_entries`):
--   #16  Duas inscrições ao mesmo tempo passavam ambas a última vaga: a
--        função conta as vagas e só depois insere, sem trancar nada. O
--        trigger tranca a linha da categoria e volta a contar; a segunda
--        recebe `category_full` (o ecrã diz que encheu, e ao tentar outra
--        vez fica suplente). A ordem dos suplentes inseridos é contada com
--        a categoria trancada, para não haver dois «1.º suplente».
--        Fica de fora a passagem para `selecionada`: é o «Fechar
--        inscrições», que escolhe quem entra antes de passar os outros a
--        suplente, e nesse meio tempo a conta passa das vagas de propósito.
--   #17  Uma inscrição `desistiu` voltava à vida por `change_partner`, pela
--        saída do parceiro ou por `validate_entry` — por cima da lista de
--        suplentes e das vagas. Passa a `entry_withdrawn`. Voltar a jogar é
--        uma inscrição nova (#withdraw_resignup).
--   #19  O género da categoria nunca era comparado com o das pessoas.
--        Masculinos/Femininos: ninguém do outro género. Mistos: com as duas
--        pessoas conhecidas, uma de cada. Quem não tem género (ou é
--        convidado sem conta) não é bloqueado — não se sabe.
--
-- Resultados (`tournament_matches`):
--   #20  Um marcador que também joga podia marcar o próprio jogo (e dar
--        falta ao adversário). Passa a só um admin do clube o poder fazer.
--   #14  O servidor gravava 12-3 num pro set a 9, e resultados de jogos
--        marcados para outro dia. Passa a recusar: pro set a N acaba N a
--        N-2 ou menos, ou N-(N-1) depois do tie-break; «melhor de 2/3 sets»
--        guarda sets ganhos, 2-0 ou 2-1. Só vale para jogos acabados
--        normalmente (`terminado`) — faltas e desistências têm as contas
--        delas.
--
-- Página do torneio (`tournament_page_json`):
--   #12  As vagas da página contavam só as duplas validadas; o servidor conta
--        também as pendentes (convite, sem parceiro, por validar). A página
--        dizia «4 vagas» e a pessoa entrava como suplente. Cada categoria
--        ganha `taken_count`, a MESMA conta da `tournament_taken_slots`. O
--        `entry_count` fica como estava (é o «N duplas inscritas»).
--
-- NÃO MUDA: o #21 (inscrever à mão). O admin só preenche o género de quem
-- ainda não o tem, e passar por cima do máximo de categorias é uma decisão
-- de quem organiza — fica como está.
--
-- Os erros de inscrição saem com código (`category_full`, `entry_withdrawn`,
-- `gender_mismatch`) e o ecrã traduz em `tsignup.error_*`. Os de resultado
-- saem já em frase, como os outros do ecrã de marcar.
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor.
-- ═════════════════════════════════════════════════════════════════════════


-- ── 1. Inscrições ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tournament_entries_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_ocupa CONSTANT TEXT[] := ARRAY['convite','sem_parceiro','por_validar','validada','selecionada'];
  -- Os estados a que se chega por inscrição: o «Fechar inscrições» é o único
  -- que põe `selecionada`, e esse não é contado (ver o cabeçalho).
  c_entra CONSTANT TEXT[] := ARRAY['convite','sem_parceiro','por_validar','validada'];
  v_slots  INTEGER;
  v_status TEXT;
  v_gender TEXT;
  v_taken  INTEGER;
  v_g1     TEXT;
  v_g2     TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'desistiu' AND NEW.status <> 'desistiu' THEN
    RAISE EXCEPTION 'entry_withdrawn';
  END IF;

  -- Tranca a categoria: quem vier a seguir espera, e conta já com esta.
  SELECT slots, status, gender INTO v_slots, v_status, v_gender
    FROM tournament_categories WHERE id = NEW.category_id FOR UPDATE;

  IF v_status = 'inscricoes' AND v_slots IS NOT NULL
     AND NEW.status = ANY (c_entra)
     AND (TG_OP = 'INSERT' OR NOT (OLD.status = ANY (c_ocupa))) THEN
    SELECT count(*) INTO v_taken FROM tournament_entries
     WHERE category_id = NEW.category_id AND status = ANY (c_ocupa)
       AND id IS DISTINCT FROM NEW.id;
    IF v_taken >= v_slots THEN
      RAISE EXCEPTION 'category_full';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'suplente' THEN
    SELECT COALESCE(MAX(waitlist_order), 0) + 1 INTO NEW.waitlist_order
      FROM tournament_entries WHERE category_id = NEW.category_id AND status = 'suplente';
  END IF;

  IF NEW.status <> 'desistiu' AND v_gender IN ('masculino', 'feminino', 'misto')
     AND (TG_OP = 'INSERT'
          OR NEW.player1_id IS DISTINCT FROM OLD.player1_id
          OR NEW.player2_id IS DISTINCT FROM OLD.player2_id
          OR NEW.category_id IS DISTINCT FROM OLD.category_id) THEN
    SELECT NULLIF(gender, '') INTO v_g1 FROM profiles WHERE id = NEW.player1_id;
    SELECT NULLIF(gender, '') INTO v_g2 FROM profiles WHERE id = NEW.player2_id;
    IF v_gender = 'masculino' AND 'feminino' IN (v_g1, v_g2)
       OR v_gender = 'feminino' AND 'masculino' IN (v_g1, v_g2)
       OR v_gender = 'misto' AND v_g1 IN ('masculino', 'feminino') AND v_g1 = v_g2 THEN
      RAISE EXCEPTION 'gender_mismatch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tournament_entries_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_entries_guard ON tournament_entries;
CREATE TRIGGER tournament_entries_guard
  BEFORE INSERT OR UPDATE ON tournament_entries
  FOR EACH ROW EXECUTE FUNCTION tournament_entries_guard();


-- ── 2. Resultados ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tournament_matches_result_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me         UUID := auth.uid();
  v_tournament UUID;
  v_scoring    TEXT;
  v_n          INTEGER;
  v_hi         INTEGER;
  v_lo         INTEGER;
BEGIN
  -- Só interessa quando o jogo passa a ter resultado, ou o resultado muda.
  -- O `winner_entry_id` sozinho NÃO conta: apagar uma inscrição põe-no a
  -- NULL em cascata (ON DELETE SET NULL), e isso não é um resultado novo —
  -- validá-lo aí impedia de apagar um torneio com jogos (24 set, à noite).
  IF NEW.status NOT IN ('terminado', 'falta', 'desistencia')
     OR (NEW.status IS NOT DISTINCT FROM OLD.status
         AND NEW.score_a IS NOT DISTINCT FROM OLD.score_a
         AND NEW.score_b IS NOT DISTINCT FROM OLD.score_b) THEN
    RETURN NEW;
  END IF;

  SELECT c.tournament_id, t.rules->>'scoring' INTO v_tournament, v_scoring
    FROM tournament_categories c JOIN tournaments t ON t.id = c.tournament_id
   WHERE c.id = NEW.category_id;

  -- #20 — sem sessão (cron, SQL à mão) não se verifica: não há «quem».
  IF v_me IS NOT NULL AND NOT is_tournament_admin(v_tournament)
     AND EXISTS (SELECT 1 FROM tournament_entries e
                  WHERE e.id IN (NEW.entry_a_id, NEW.entry_b_id)
                    AND v_me IN (e.player1_id, e.player2_id)) THEN
    RAISE EXCEPTION 'Não podes marcar o resultado de um jogo em que jogas. Pede a um admin do clube.';
  END IF;

  IF NEW.status <> 'terminado' THEN RETURN NEW; END IF;

  -- #14 — jogo marcado para outro dia (hora de Portugal).
  IF NEW.scheduled_at IS NOT NULL
     AND (NEW.scheduled_at AT TIME ZONE 'Europe/Lisbon')::date
         > (now() AT TIME ZONE 'Europe/Lisbon')::date THEN
    RAISE EXCEPTION 'Este jogo está marcado para %. O resultado só se grava no dia do jogo.',
      to_char(NEW.scheduled_at AT TIME ZONE 'Europe/Lisbon', 'DD/MM "às" HH24:MI');
  END IF;

  -- #14 — resultado que o formato não permite.
  IF NEW.score_a IS NULL OR NEW.score_b IS NULL THEN RETURN NEW; END IF;
  v_hi := GREATEST(NEW.score_a, NEW.score_b);
  v_lo := LEAST(NEW.score_a, NEW.score_b);
  IF COALESCE(v_scoring, 'pro_set_9') LIKE 'pro_set_%' THEN
    v_n := COALESCE(NULLIF(regexp_replace(COALESCE(v_scoring, ''), '[^0-9]', '', 'g'), '')::int, 9);
    IF v_hi <> v_n OR v_lo > v_n - 1 THEN
      RAISE EXCEPTION 'Resultado impossível num pro set a %: %-%.', v_n, NEW.score_a, NEW.score_b;
    END IF;
  ELSIF v_scoring IN ('melhor_2_sets', 'melhor_3_sets') THEN
    IF v_hi <> 2 OR v_lo > 1 THEN
      RAISE EXCEPTION 'Em sets, o resultado é 2-0 ou 2-1 (recebido %-%).', NEW.score_a, NEW.score_b;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tournament_matches_result_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS tournament_matches_result_guard ON tournament_matches;
CREATE TRIGGER tournament_matches_result_guard
  BEFORE UPDATE ON tournament_matches
  FOR EACH ROW EXECUTE FUNCTION tournament_matches_result_guard();


-- ── 3. Página do torneio: `taken_count` em cada categoria ────────────────
-- Lê o corpo VIVO (já remendado pelo #521 e pelo «quem inscreveu»), junta o
-- campo a seguir ao `entry_count` da categoria, e recusa se não encontrar.
DO $$
DECLARE
  c_ancora CONSTANT TEXT :=
    '(WHERE e\.category_id = c\.id AND e\.status IN \(''validada'',\s*''selecionada''\)\) AS entry_count)';
  c_novo   CONSTANT TEXT :=
    E'\\1,\n               (SELECT count(*) FROM tournament_entries e\n                 WHERE e.category_id = c.id AND e.status IN (''convite'',''sem_parceiro'',''por_validar'',''validada'',''selecionada'')) AS taken_count';
  f      RECORD;
  v_def  TEXT;
  v_novo TEXT;
BEGIN
  FOR f IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'tournament_page_json' LOOP
    IF position('AS taken_count' IN f.prosrc) > 0 THEN
      RAISE NOTICE 'tournament_page_json(%): já tinha o taken_count.', f.args;
    ELSIF f.prosrc ~ c_ancora THEN
      v_def  := pg_get_functiondef(f.oid);
      v_novo := regexp_replace(v_def, c_ancora, c_novo);
      IF position('AS taken_count' IN v_novo) = 0 THEN
        RAISE EXCEPTION 'tournament_page_json(%): encontrei o entry_count mas não consegui juntar o campo. Ler o corpo vivo.', f.args;
      END IF;
      EXECUTE v_novo;
      RAISE NOTICE 'Corrigida: tournament_page_json(%)', f.args;
    ELSE
      RAISE EXCEPTION 'tournament_page_json(%) não tem a forma esperada — alguém a mudou. Ler o corpo vivo antes de correr isto.', f.args;
    END IF;
  END LOOP;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não existe tournament_page_json. Parar e ler.';
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- PARA VER DEPOIS (só leitura)
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT tgname FROM pg_trigger
--    WHERE tgname IN ('tournament_entries_guard', 'tournament_matches_result_guard');
--   SELECT p.prosrc LIKE '%AS taken_count%' FROM pg_proc p WHERE p.proname = 'tournament_page_json';
--
-- Inscrições que já estão hoje fora das regras novas (os triggers não as
-- mexem — só recusam mudanças daqui para a frente):
--   SELECT c.code, e.id, p1.gender, p2.gender
--     FROM tournament_entries e
--     JOIN tournament_categories c ON c.id = e.category_id
--     LEFT JOIN profiles p1 ON p1.id = e.player1_id
--     LEFT JOIN profiles p2 ON p2.id = e.player2_id
--    WHERE e.status <> 'desistiu'
--      AND (c.gender = 'masculino' AND 'feminino' IN (p1.gender, p2.gender)
--        OR c.gender = 'feminino' AND 'masculino' IN (p1.gender, p2.gender)
--        OR c.gender = 'misto' AND p1.gender = p2.gender);
