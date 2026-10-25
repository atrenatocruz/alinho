-- ═════════════════════════════════════════════════════════════════════════
-- «Aos 40-40»: ponto de ouro, Star Point ou vantagens, guardado em cada evento
--
-- PORQUÊ. Desenho aprovado pelo Francisco a 22 out
-- (design-handoff/2026-10-22-aos-40-40-criar/SPEC.md; regras da BA em
-- design-handoff/2026-10-22-relogio/MODOS-40-40-BA.md, ponto 5). Plano
-- aprovado a 23 out. A escolha só se guarda e se mostra: nenhuma conta muda
-- (nível, ranking, vencedor). Os eventos que já existem ficam com ponto de
-- ouro.
--
-- O QUE FAZ. Valores: 'ponto_de_ouro' (por omissão), 'star_point',
-- 'vantagens'.
--   · Mix: games.deuce_mode e game_recurrences.deuce_mode. A app grava-os
--     como grava o resto do mix; a repetição semanal copia-o
--     (recurrence_insert_pending).
--   · Torneio: rules.deuce, junto das outras regras (o create_tournament e o
--     update_tournament já juntam as regras; a página já devolve rules).
--     Uma regra na tabela recusa valores que não sejam os três.
--   · Jogo entre amigos: private_matches.deuce_mode, na sessão inteira. Grava-
--     se com set_deuce_mode('friend_match', id, modo) a seguir ao criar ou no
--     editar; o get_friend_match devolve-o em match.deuce_mode.
--   · Liga: leagues.deuce_mode, uma escolha para a liga inteira. Grava-se
--     com set_deuce_mode('league', id, modo); o get_league_page devolve-o em
--     league.deuce_mode.
-- O cadeado depois de haver resultados fica no ecrã, como o da pontuação
-- (mudar o modo não mexe em contas).
--
-- COMPATIBILIDADE. Só acrescenta. Colunas com valor por omissão; nenhuma
-- assinatura muda (a app antiga continua a chamar as mesmas funções). As
-- três funções vivas são remendadas por texto, com contagem exata; correr
-- duas vezes não faz mal («já estava»).
--
-- Dev 3, 23 out 2026 · ecrãs: Dev 1 (torneio e liga), donos do mix e dos
-- jogos entre amigos
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. As colunas ──────────────────────────────────────────────────────
ALTER TABLE public.games            ADD COLUMN IF NOT EXISTS deuce_mode TEXT NOT NULL DEFAULT 'ponto_de_ouro';
ALTER TABLE public.game_recurrences ADD COLUMN IF NOT EXISTS deuce_mode TEXT NOT NULL DEFAULT 'ponto_de_ouro';
ALTER TABLE public.private_matches  ADD COLUMN IF NOT EXISTS deuce_mode TEXT NOT NULL DEFAULT 'ponto_de_ouro';
ALTER TABLE public.leagues          ADD COLUMN IF NOT EXISTS deuce_mode TEXT NOT NULL DEFAULT 'ponto_de_ouro';

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['games', 'game_recurrences', 'private_matches', 'leagues'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_deuce_mode_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (deuce_mode IN (''ponto_de_ouro'', ''star_point'', ''vantagens''))',
                     t, t || '_deuce_mode_check');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_rules_deuce_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_rules_deuce_check
      CHECK (rules->>'deuce' IS NULL OR rules->>'deuce' IN ('ponto_de_ouro', 'star_point', 'vantagens'));
  END IF;
END $$;

-- ── 2. Remendos às funções vivas (texto exato, uma vez) ─────────────────
DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.recurrence_insert_pending(uuid,timestamp with time zone)',
       'pool_size, tiebreak_8_8, seed_reverse',
       'pool_size, tiebreak_8_8, deuce_mode, seed_reverse'),
      ('public.recurrence_insert_pending(uuid,timestamp with time zone)',
       'rec.pool_size, rec.tiebreak_8_8, COALESCE(rec.seed_reverse',
       'rec.pool_size, rec.tiebreak_8_8, COALESCE(rec.deuce_mode, ''ponto_de_ouro''), COALESCE(rec.seed_reverse'),
      ('public.get_friend_match(uuid)',
       '''scoring_format'', m.scoring_format, ''num_sets'', m.num_sets,',
       '''scoring_format'', m.scoring_format, ''num_sets'', m.num_sets, ''deuce_mode'', m.deuce_mode,'),
      ('public.get_league_page(text)',
       '''max_teams_per_category'', v_l.max_teams_per_category,',
       '''max_teams_per_category'', v_l.max_teams_per_category, ''deuce_mode'', v_l.deuce_mode,')
    ) AS x(fn, old_txt, new_txt)
  LOOP
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    IF position(r.new_txt IN v_def) > 0 THEN
      RAISE NOTICE '% já estava', r.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', r.fn, r.old_txt, v_n;
    END IF;
    EXECUTE replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
END $$;

-- ── 3. Gravar o modo num jogo entre amigos ou numa liga ─────────────────
-- Uma função à parte para não mudar a assinatura do create_friend_match,
-- do update_friend_match nem do create_league/update_league (a app antiga
-- continua a chamá-las como sempre).
CREATE OR REPLACE FUNCTION public.set_deuce_mode(p_kind TEXT, p_id UUID, p_mode TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root   UUID;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('ponto_de_ouro', 'star_point', 'vantagens') THEN
    RAISE EXCEPTION 'bad_deuce_mode';
  END IF;

  IF p_kind = 'friend_match' THEN
    -- A sessão inteira: a raiz e os jogos dela.
    SELECT COALESCE(session_id, id) INTO v_root FROM private_matches WHERE id = p_id;
    IF v_root IS NULL OR NOT EXISTS (SELECT 1 FROM private_matches WHERE id = v_root AND is_friend_session)
       OR NOT friend_match_is_organizer(v_root) THEN
      RAISE EXCEPTION 'not_allowed';
    END IF;
    UPDATE private_matches SET deuce_mode = p_mode WHERE id = v_root OR session_id = v_root;

  ELSIF p_kind = 'league' THEN
    SELECT status INTO v_status FROM leagues WHERE id = p_id;
    IF v_status IS NULL THEN RAISE EXCEPTION 'league_not_found'; END IF;
    IF NOT can_manage_league(p_id) THEN RAISE EXCEPTION 'not_league_manager'; END IF;
    IF v_status IN ('terminada', 'cancelada') THEN RAISE EXCEPTION 'league_closed'; END IF;
    UPDATE leagues SET deuce_mode = p_mode WHERE id = p_id;

  ELSE
    RAISE EXCEPTION 'bad_kind';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_deuce_mode(TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_deuce_mode(TEXT, UUID, TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT table_name FROM information_schema.columns WHERE column_name = 'deuce_mode' ORDER BY 1;
--     → game_recurrences, games, leagues, private_matches
--   SELECT proname, position('deuce_mode' IN prosrc) > 0 FROM pg_proc
--    WHERE proname IN ('recurrence_insert_pending', 'get_friend_match', 'get_league_page');   → três true
--   SELECT has_function_privilege('anon', 'public.set_deuce_mode(text,uuid,text)', 'EXECUTE');   → false
