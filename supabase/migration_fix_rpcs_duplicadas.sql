-- ═════════════════════════════════════════════════════════════════════════
-- APAGAR AS VERSÕES ANTIGAS DE DUAS FUNÇÕES QUE FICARAM DUPLICADAS
-- (Dev 3, 23 set 2026) — cartão «#465».
--
-- Pode-se correr outra vez sem estragar. Não muda o comportamento de nada:
-- só apaga versões velhas que ficaram para trás.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE ESTÁ PARTIDO, E EXACTAMENTE QUANDO
-- ─────────────────────────────────────────────────────────────────────────
-- Há duas `mark_walkover` em produção, uma de 4 argumentos e outra de 6 em
-- que os dois últimos são opcionais. Quando a app chama com 4, as DUAS
-- servem, e o PostgREST recusa-se a escolher: HTTP 300, PGRST203. Falha
-- antes sequer de verificar permissões.
--
-- E isso diz QUANDO falha, o que interessa a quem for testar:
--   · marcar uma FALTA .......................... PARTIDO (manda 4)
--   · desistência SEM resultado até ali ......... PARTIDO (manda 4)
--   · desistência COM resultado até ali ......... funciona (manda 6)
-- (ver `markWalkover` em src/lib/tournamentApi.js: os dois últimos só vão
-- quando há resultado parcial.)
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUAL SAI, E PORQUÊ É A DE 4 E NÃO A DE 6
-- ─────────────────────────────────────────────────────────────────────────
-- SAI A DE 4 ARGUMENTOS. Contra a primeira impressão, que era a minha
-- também: em produção o `oid` da de 4 é MAIOR, o que parece dizer que é a
-- mais recente. Não é — quer dizer que foi CRIADA mais tarde, e a razão é
-- outra.
--
-- A de 6 argumentos vem da `migration_tournaments_walkover_rest.sql`
-- (Renato, 23 set, cartões #458 e #459) e esse ficheiro **já apaga a de 4**
-- antes de criar a dele. Depois de o correr, só devia existir uma. A de 4
-- voltou porque, a seguir, se correu outra vez um dos ficheiros antigos que
-- a define — a `migration_tournaments_rpcs.sql`, a
-- `migration_tournaments_who_played.sql` ou a
-- `migration_tournaments_recalc.sql`. Todos a criam com CREATE OR REPLACE,
-- e como a assinatura é diferente da de 6, não substitui: acrescenta.
--
-- ⚠️ E O MAIS IMPORTANTE: a de 6 argumentos NÃO é «a de 4 mais os
--    resultados parciais». Tem lá dentro o **#459** — quem falta ou desiste
--    perde por falta os jogos de grupo que ainda tinha por jogar. Sem isso
--    esses jogos ficam pendurados na lista do marcador e **o grupo nunca
--    fecha**. A de 4 argumentos não tem essa parte.
--
--    Apagar a de 6 resolvia a ambiguidade e desfazia o #459 em silêncio. É
--    por isso que sai a de 4.
--
-- ─────────────────────────────────────────────────────────────────────────
-- A SEGUNDA: `submit_private_match_score`
-- ─────────────────────────────────────────────────────────────────────────
-- Mesmo tropeço, e ainda não partiu por sorte: há uma de 3 argumentos e uma
-- de 4 (com `p_sets`). A app manda sempre o `p_sets`
-- (src/lib/privateMatches.js), por isso só uma serve e não há ambiguidade.
-- Passa a haver no dia em que alguém deixe de o mandar.
--
-- SAI A DE 3 ARGUMENTOS. A de 4 é a mais recente (`migration_private_match_draw.sql`,
-- Renato, 23 set, #420 — o empate) e é a única que sabe dos sets e do
-- empate. A de 3 vem de ficheiros de julho e de setembro que já foram
-- ultrapassados.
--
-- Confirmado que mais ninguém as chama: na app só os dois sítios acima, e o
-- bot de WhatsApp não chama nenhuma das duas.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ISTO VOLTA A ACONTECER, E A CAUSA NÃO SE RESOLVE AQUI
-- ─────────────────────────────────────────────────────────────────────────
-- A `mark_walkover` está definida em QUATRO ficheiros do repositório e a
-- `submit_private_match_score` noutros quatro. Correr outra vez um dos
-- antigos ressuscita a versão velha e parte isto de novo, exactamente como
-- aconteceu hoje.
--
-- O remédio de fundo é as migrações passarem a ser corridas com registo
-- (hoje a `supabase_migrations.schema_migrations` tem UMA linha para 156
-- ficheiros). Isso é conversa à parte, com o Renato. Até lá, a regra
-- prática: **nunca correr outra vez um ficheiro de migração antigo.**
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_mw_4    BOOLEAN;
  v_mw_6    BOOLEAN;
  v_sp_3    BOOLEAN;
  v_sp_4    BOOLEAN;
  v_sobram  INTEGER;
BEGIN
  -- ── 1. Ver o que lá está, antes de apagar ─────────────────────────────
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'mark_walkover'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_match_id uuid, p_kind text, p_loser text, p_justified boolean')
    INTO v_mw_4;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'mark_walkover'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_match_id uuid, p_kind text, p_loser text, p_justified boolean, p_score_a integer, p_score_b integer')
    INTO v_mw_6;

  -- A de 6 é a que fica. Se não existir, alguma coisa está diferente do que
  -- eu vi — e apagar a de 4 deixava a app sem função nenhuma para marcar
  -- faltas. Mais vale parar e olhar.
  IF NOT v_mw_6 THEN
    IF v_mw_4 THEN
      RAISE EXCEPTION E'Parado, e de propósito.\n\nSó existe a mark_walkover de 4 argumentos; a de 6 (a que fica) não está aqui. Isso quer dizer que a migration_tournaments_walkover_rest.sql ainda não correu nesta base de dados.\n\nCorre-a primeiro. Ela própria apaga a de 4, e depois isto já não é preciso.';
    ELSE
      RAISE EXCEPTION 'Não existe nenhuma mark_walkover nesta base de dados. Corre a migration_tournaments_walkover_rest.sql.';
    END IF;
  END IF;

  -- ── 2. Apagar a antiga ────────────────────────────────────────────────
  IF v_mw_4 THEN
    DROP FUNCTION public.mark_walkover(UUID, TEXT, TEXT, BOOLEAN);
    RAISE NOTICE 'mark_walkover de 4 argumentos: apagada.';
  ELSE
    RAISE NOTICE 'mark_walkover de 4 argumentos: já não existia, nada a fazer.';
  END IF;

  -- ── 3. O mesmo para a dos jogos entre amigos ──────────────────────────
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'submit_private_match_score'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_match_id uuid, p_score_a integer, p_score_b integer')
    INTO v_sp_3;
  SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'submit_private_match_score'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_match_id uuid, p_score_a integer, p_score_b integer, p_sets jsonb')
    INTO v_sp_4;

  IF v_sp_3 AND NOT v_sp_4 THEN
    RAISE EXCEPTION E'Parado, e de propósito.\n\nSó existe a submit_private_match_score de 3 argumentos; a de 4 (com p_sets, a que fica) não está aqui. Apagar a de 3 deixava os jogos entre amigos sem forma de gravar resultado.\n\nCorre primeiro a migration_private_match_draw.sql.';
  END IF;

  IF v_sp_3 AND v_sp_4 THEN
    DROP FUNCTION public.submit_private_match_score(UUID, INTEGER, INTEGER);
    RAISE NOTICE 'submit_private_match_score de 3 argumentos: apagada.';
  ELSE
    RAISE NOTICE 'submit_private_match_score: já só havia uma, nada a fazer.';
  END IF;

  -- ── 4. Confirmar que ficou mesmo uma de cada ──────────────────────────
  -- Se ficasse mais do que uma, a app continuava partida e nós a pensar que
  -- estava resolvido — que é a pior forma de fechar isto.
  SELECT count(*) INTO v_sobram
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'mark_walkover';
  IF v_sobram <> 1 THEN
    RAISE EXCEPTION 'Ficaram % versões de mark_walkover, devia ser 1.', v_sobram;
  END IF;

  SELECT count(*) INTO v_sobram
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_private_match_score';
  IF v_sobram <> 1 THEN
    RAISE EXCEPTION 'Ficaram % versões de submit_private_match_score, devia ser 1.', v_sobram;
  END IF;

  RAISE NOTICE 'Ficou uma versão de cada. Marcar faltas e desistências volta a funcionar.';
END
$$;

-- ── 5. Os direitos, outra vez ─────────────────────────────────────────────
-- Apagar uma versão não mexe nos direitos da outra, mas repetir isto não
-- custa nada e garante que a que fica está aberta a quem tem sessão e
-- fechada a quem não tem.
REVOKE ALL ON FUNCTION mark_walkover(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM public, anon;
GRANT EXECUTE ON FUNCTION mark_walkover(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER, JSONB) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- COMO CONFIRMAR QUE FICOU BEM (correr a seguir)
-- ═════════════════════════════════════════════════════════════════════════
-- Tem de devolver exactamente duas linhas, uma de cada:
--
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('mark_walkover', 'submit_private_match_score')
--    ORDER BY p.proname;
--
-- E depois, na app: marcar uma FALTA num jogo de grupo. Era o caso partido.
-- Confirmar também que os outros jogos por jogar dessa dupla passaram a
-- falta a favor dos adversários — é o #459, e é o que se perderia se se
-- tivesse apagado a função errada.
