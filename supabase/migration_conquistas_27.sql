-- ═════════════════════════════════════════════════════════════════════════
-- As 27 conquistas novas do Marketing (Trello #625; design-handoff/2026-10-
-- 11-medalhas-conquistas/SPEC-27-NOVAS.md, aprovado pelo Francisco a 11 out;
-- regras exatas da BA em REGRAS-BA.md; plano com o «Tudo ok» do Francisco a
-- 12 out). Dev 2, dados e ecrã (decisão do PO).
--
-- O QUE FAZ
--   1. As 27 entram na tabela achievements (ativas), com a raridade do json.
--   2. check_and_award_achievements_27(p_user_id, p_awarded_at): conta as 27
--      para uma pessoa, à parte do sistema do Ruben (520a48b0). As 100 de
--      sempre não mudam: nem regras, nem nomes.
--   3. O check_and_award_achievements (corpo VIVO, 1 linha juntada, «já
--      estava») passa a chamar a nova no fim — todos os ganchos de sempre
--      (fim do mix, torneio, amigos, kudos…) contam também as 27.
--   4. O passado conta, sem animação nem aviso (decisão do PO): uma passagem
--      por toda a gente, com a conquista datada do último «visto» de cada um
--      (celebrations_seen_at) — não entra no «Novidades para ti» nem no
--      «Ganhas há pouco». Quem nunca abriu as novidades fica com -infinity.
--
-- REGRAS GERAIS (BA): «jogo» = jogo com resultado num mix ou jogo em aberto,
-- num torneio (sem os de falta), num jogo de grupo ou num jogo entre amigos
-- confirmado (um por dupla, regra de 8 out). Aulas não. «Noite» = o mesmo
-- mix. Datas e horas: a hora de início, na hora de Portugal. Contas de teste
-- não contam como pessoa; torneios de teste não contam. Uma vez ganha, fica.
--
-- Fora, até haver dados: Em Direto, Chuva no Vidro e Maratona.
-- Aproximação aceite pela BA (Esgotado e Fecha-Campo): a ordem das
-- inscrições é a dos participantes que ficaram, por created_at (quem saiu
-- não conta para encher).
--
-- Dev 2, 12 out 2026. Run this whole file in Supabase → SQL Editor → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. As 27 na tabela ──────────────────────────────────────────────────
INSERT INTO achievements (key, category, rarity, sort, active) VALUES
  ('desforra',            'jogo',        'raro',   1001, TRUE),
  ('ida_e_volta',         'jogo',        'epico',  1002, TRUE),
  ('golias_abaixo',       'elo',         'epico',  1003, TRUE),
  ('outra_vez_voces',     'jogo',        'raro',   1004, TRUE),
  ('a_primeira',          'jogo',        'raro',   1005, TRUE),
  ('equilibrista',        'jogo',        'comum',  1006, TRUE),
  ('padel_ao_almoco',     'jogo',        'comum',  1007, TRUE),
  ('domingo_as_8',        'jogo',        'raro',   1008, TRUE),
  ('sexta_13_da_sorte',   'jogo',        'raro',   1009, TRUE),
  ('aplauso_geral',       'kudos',       'epico',  1010, TRUE),
  ('padel_de_natal',      'jogo',        'comum',  1011, TRUE),
  ('fecho_de_ano',        'jogo',        'raro',   1012, TRUE),
  ('ano_novo_padel_novo', 'jogo',        'comum',  1013, TRUE),
  ('par_perfeito',        'jogo',        'raro',   1014, TRUE),
  ('noite_de_santos',     'jogo',        'raro',   1015, TRUE),
  ('bronzeado_de_padel',  'jogo',        'raro',   1016, TRUE),
  ('esgotado',            'jogo',        'raro',   1017, TRUE),
  ('fecha_campo',         'jogo',        'comum',  1018, TRUE),
  ('a_malta_toda',        'jogo',        'raro',   1019, TRUE),
  ('casa_cheia',          'jogo',        'epico',  1020, TRUE),
  ('alma_do_grupo',       'antiguidade', 'epico',  1021, TRUE),
  ('fiel_ao_clube',       'torneio',     'raro',   1022, TRUE),
  ('sobrevivente',        'torneio',     'raro',   1023, TRUE),
  ('classico',            'jogo',        'epico',  1024, TRUE),
  ('batismo_de_campo',    'antiguidade', 'raro',   1025, TRUE),
  ('boca_a_boca',         'antiguidade', 'raro',   1026, TRUE),
  ('embaixador_da_bola',  'antiguidade', 'epico',  1027, TRUE)
ON CONFLICT (key) DO NOTHING;

-- ── 2. A conta das 27 ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_and_award_achievements_27(p_user_id UUID, p_awarded_at TIMESTAMPTZ DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_test BOOLEAN;
  e TEXT[] := '{}';   -- as chaves ganhas nesta passagem
BEGIN
  -- Blindagem, como no check_and_award_achievements: as conquistas são um
  -- extra — um erro aqui nunca desfaz o que nos chamou.
  BEGIN
  SELECT COALESCE(is_test, FALSE) INTO v_test FROM profiles WHERE id = p_user_id;
  IF NOT FOUND OR v_test THEN RETURN; END IF;

  -- Todos os meus jogos com resultado, numa tabela: o tipo, a «noite» (o mix,
  -- ou a categoria do torneio), a hora de início em Portugal, ronda e campo,
  -- ganhei/perdi, o parceiro e os adversários, as médias antes do jogo.
  CREATE TEMP TABLE IF NOT EXISTS _a27 (
    kind TEXT, src UUID, night UUID, extra UUID, org UUID, starts TIMESTAMP,
    rnd INTEGER, court INTEGER, num_courts INTEGER, fmt TEXT,
    won BOOLEAN, lost BOOLEAN, partner UUID, opp1 UUID, opp2 UUID, my_r NUMERIC, opp_r NUMERIC
  ) ON COMMIT DROP;
  TRUNCATE _a27;

  -- Mixes e jogos em aberto: cada jogo com resultado.
  INSERT INTO _a27
  SELECT 'mix', m.id, g.id, NULL, g.organization_id, g.date AT TIME ZONE 'Europe/Lisbon',
         m.round_number, m.court_number, g.num_courts, g.format,
         m.winner_team_id = tm.id, m.winner_team_id <> tm.id,
         CASE WHEN tm.player1_id = p_user_id THEN tm.player2_id ELSE tm.player1_id END,
         op.player1_id, op.player2_id,
         (SELECT AVG(s.rating_after - s.rating_delta) FROM mix_player_stats s
           WHERE s.game_id = g.id AND s.user_id IN (tm.player1_id, tm.player2_id)),
         (SELECT AVG(s.rating_after - s.rating_delta) FROM mix_player_stats s
           WHERE s.game_id = g.id AND s.user_id IN (op.player1_id, op.player2_id))
    FROM teams tm
    JOIN games g ON g.id = tm.game_id AND g.status <> 'cancelled'
    JOIN matches m ON m.game_id = g.id AND tm.id IN (m.team_a_id, m.team_b_id) AND m.winner_team_id IS NOT NULL
    JOIN teams op ON op.id = CASE WHEN m.team_a_id = tm.id THEN m.team_b_id ELSE m.team_a_id END
   WHERE p_user_id IN (tm.player1_id, tm.player2_id);

  -- Torneios: só os jogos acabados (os de falta — «falta» — não contam).
  INSERT INTO _a27
  SELECT 'torneio', tmx.id, tmx.category_id, t.id, t.organization_id,
         COALESCE(tmx.started_at, tmx.scheduled_at) AT TIME ZONE 'Europe/Lisbon',
         NULL, NULL, NULL, tmx.stage,
         tmx.winner_entry_id = me.id, tmx.winner_entry_id <> me.id,
         CASE WHEN me.player1_id = p_user_id THEN me.player2_id ELSE me.player1_id END,
         op.player1_id, op.player2_id, NULL, NULL
    FROM tournament_entries me
    JOIN tournament_matches tmx ON me.id IN (tmx.entry_a_id, tmx.entry_b_id)
         AND tmx.status = 'terminado' AND tmx.winner_entry_id IS NOT NULL
    JOIN tournament_categories c ON c.id = tmx.category_id
    JOIN tournaments t ON t.id = c.tournament_id AND NOT COALESCE(t.is_test, FALSE)
    LEFT JOIN tournament_entries op ON op.id = CASE WHEN tmx.entry_a_id = me.id THEN tmx.entry_b_id ELSE tmx.entry_a_id END
   WHERE p_user_id IN (me.player1_id, me.player2_id);

  -- Jogos de grupo com resultado.
  INSERT INTO _a27
  SELECT 'grupo', gm.id, NULL, NULL, gm.organization_id,
         gm.scheduled_date + COALESCE(gm.scheduled_time, TIME '12:00'), NULL, NULL, NULL, NULL,
         gm.winner_team = x.side, gm.winner_team IN ('a', 'b') AND gm.winner_team <> x.side,
         x.partner, x.o1, x.o2, NULL, NULL
    FROM group_matches gm,
         LATERAL (SELECT CASE WHEN p_user_id IN (gm.team_a_player1_id, gm.team_a_player2_id) THEN 'a' ELSE 'b' END AS side,
                         CASE WHEN p_user_id = gm.team_a_player1_id THEN gm.team_a_player2_id
                              WHEN p_user_id = gm.team_a_player2_id THEN gm.team_a_player1_id
                              WHEN p_user_id = gm.team_b_player1_id THEN gm.team_b_player2_id
                              ELSE gm.team_b_player1_id END AS partner,
                         CASE WHEN p_user_id IN (gm.team_a_player1_id, gm.team_a_player2_id) THEN gm.team_b_player1_id ELSE gm.team_a_player1_id END AS o1,
                         CASE WHEN p_user_id IN (gm.team_a_player1_id, gm.team_a_player2_id) THEN gm.team_b_player2_id ELSE gm.team_a_player2_id END AS o2) x
   WHERE gm.winner_team IS NOT NULL AND gm.scheduled_date IS NOT NULL
     AND p_user_id IN (gm.team_a_player1_id, gm.team_a_player2_id, gm.team_b_player1_id, gm.team_b_player2_id);

  -- Jogos entre amigos confirmados (um por dupla; nunca a raiz da sessão).
  -- «night»: a sessão — a das rondas antigas (session_id) ou a das duplas
  -- de agora (friend_pair_of). O Clássico conta sessões, no passado e no
  -- presente (BA, 12 out); as outras veem cada jogo.
  INSERT INTO _a27
  SELECT 'amigos', pm.id, COALESCE(pm.session_id, pm.friend_pair_of, pm.id), NULL, pm.organization_id,
         COALESCE(pm.played_at AT TIME ZONE 'Europe/Lisbon', pm.scheduled_date + COALESCE(pm.scheduled_time, TIME '12:00')),
         NULL, NULL, NULL, NULL,
         pm.winner_team = x.side, pm.winner_team IN ('a', 'b') AND pm.winner_team <> x.side,
         x.partner, x.o1, x.o2,
         (SELECT AVG(s.rating_after - s.rating_delta) FROM private_match_stats s WHERE s.private_match_id = pm.id AND s.user_id IN (p_user_id, x.partner)),
         (SELECT AVG(s.rating_after - s.rating_delta) FROM private_match_stats s WHERE s.private_match_id = pm.id AND s.user_id IN (x.o1, x.o2))
    FROM private_matches pm,
         LATERAL (SELECT CASE WHEN p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN 'a' ELSE 'b' END AS side,
                         CASE WHEN p_user_id = pm.team_a_player1_id THEN pm.team_a_player2_id
                              WHEN p_user_id = pm.team_a_player2_id THEN pm.team_a_player1_id
                              WHEN p_user_id = pm.team_b_player1_id THEN pm.team_b_player2_id
                              ELSE pm.team_b_player1_id END AS partner,
                         CASE WHEN p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN pm.team_b_player1_id ELSE pm.team_a_player1_id END AS o1,
                         CASE WHEN p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN pm.team_b_player2_id ELSE pm.team_a_player2_id END AS o2) x
   WHERE pm.status = 'confirmed' AND NOT COALESCE(pm.is_friend_session, FALSE) AND pm.winner_team IS NOT NULL
     AND p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id);

  -- ── Dentro do mix ──
  -- Desforra: perdes contra os mesmos dois (com conta) e, mais tarde nesse mix, ganhas-lhes.
  IF EXISTS (SELECT 1 FROM _a27 l JOIN _a27 w ON w.kind = 'mix' AND w.night = l.night AND w.won
                AND w.rnd > l.rnd AND LEAST(w.opp1, w.opp2) = LEAST(l.opp1, l.opp2) AND GREATEST(w.opp1, w.opp2) = GREATEST(l.opp1, l.opp2)
              WHERE l.kind = 'mix' AND l.lost AND l.opp1 IS NOT NULL AND l.opp2 IS NOT NULL) THEN e := array_append(e, 'desforra'); END IF;
  -- Ida e Volta: só no sobe e desce — campo 1, depois o último, depois o 1 outra vez, por esta ordem.
  IF EXISTS (SELECT 1 FROM _a27 a JOIN _a27 b ON b.night = a.night AND b.kind = 'mix' AND b.rnd > a.rnd AND b.court = a.num_courts
                JOIN _a27 c ON c.night = a.night AND c.kind = 'mix' AND c.rnd > b.rnd AND c.court = 1
              WHERE a.kind = 'mix' AND a.fmt = 'sobe_desce' AND a.num_courts >= 2 AND a.court = 1) THEN e := array_append(e, 'ida_e_volta'); END IF;
  -- Outra Vez Vocês?: 3 vezes contra os mesmos dois (com conta) no mesmo mix.
  IF EXISTS (SELECT 1 FROM _a27 WHERE kind = 'mix' AND opp1 IS NOT NULL AND opp2 IS NOT NULL
              GROUP BY night, LEAST(opp1, opp2), GREATEST(opp1, opp2) HAVING count(*) >= 3) THEN e := array_append(e, 'outra_vez_voces'); END IF;
  -- Equilibrista: num mix, tantas vitórias como derrotas, pelo menos 4.
  IF EXISTS (SELECT 1 FROM _a27 WHERE kind = 'mix' GROUP BY night
              HAVING count(*) FILTER (WHERE won) = count(*) FILTER (WHERE lost) AND count(*) FILTER (WHERE won OR lost) >= 4) THEN e := array_append(e, 'equilibrista'); END IF;

  -- Golias Abaixo: ganhar a uma dupla 250+ acima da tua (média antes do jogo).
  IF EXISTS (SELECT 1 FROM _a27 WHERE won AND my_r IS NOT NULL AND opp_r IS NOT NULL AND opp_r - my_r >= 250) THEN e := array_append(e, 'golias_abaixo'); END IF;

  -- À Primeira: ganhar um mix (dupla vencedora) com um parceiro (com conta)
  -- com quem nunca tinhas feito dupla antes desse mix. Não no americano.
  IF EXISTS (SELECT 1 FROM games g JOIN teams tm ON tm.id = g.winner_team_id AND p_user_id IN (tm.player1_id, tm.player2_id)
              CROSS JOIN LATERAL (SELECT CASE WHEN tm.player1_id = p_user_id THEN tm.player2_id ELSE tm.player1_id END AS pid) x
              WHERE g.format <> 'americano' AND g.status = 'finished' AND x.pid IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM _a27 b WHERE b.partner = x.pid AND b.starts < g.date AT TIME ZONE 'Europe/Lisbon'
                                  AND (b.night IS DISTINCT FROM g.id))) THEN e := array_append(e, 'a_primeira'); END IF;

  -- ── Datas e horas (hora de início, em Portugal) ──
  IF EXISTS (SELECT 1 FROM _a27 WHERE EXTRACT(ISODOW FROM starts) BETWEEN 1 AND 5 AND EXTRACT(HOUR FROM starts) IN (12, 13)) THEN e := array_append(e, 'padel_ao_almoco'); END IF;
  IF EXISTS (SELECT 1 FROM _a27 WHERE EXTRACT(ISODOW FROM starts) = 7 AND EXTRACT(HOUR FROM starts) < 9) THEN e := array_append(e, 'domingo_as_8'); END IF;
  IF EXISTS (SELECT 1 FROM _a27 WHERE won AND EXTRACT(ISODOW FROM starts) = 5 AND EXTRACT(DAY FROM starts) = 13) THEN e := array_append(e, 'sexta_13_da_sorte'); END IF;
  IF EXISTS (SELECT 1 FROM _a27 WHERE EXTRACT(MONTH FROM starts) = 12 AND EXTRACT(DAY FROM starts) BETWEEN 20 AND 26) THEN e := array_append(e, 'padel_de_natal'); END IF;
  IF EXISTS (SELECT 1 FROM _a27 WHERE EXTRACT(MONTH FROM starts) = 12 AND EXTRACT(DAY FROM starts) = 31) THEN e := array_append(e, 'fecho_de_ano'); END IF;
  IF EXISTS (SELECT 1 FROM _a27 WHERE EXTRACT(MONTH FROM starts) = 1 AND EXTRACT(DAY FROM starts) BETWEEN 1 AND 7) THEN e := array_append(e, 'ano_novo_padel_novo'); END IF;
  IF EXISTS (SELECT 1 FROM _a27 WHERE EXTRACT(MONTH FROM starts) = 6 AND EXTRACT(DAY FROM starts) IN (12, 23, 28)) THEN e := array_append(e, 'noite_de_santos'); END IF;
  IF EXISTS (SELECT 1 FROM _a27 WHERE EXTRACT(MONTH FROM starts) IN (7, 8)
              GROUP BY EXTRACT(YEAR FROM starts) HAVING count(*) >= 10) THEN e := array_append(e, 'bronzeado_de_padel'); END IF;
  -- Par Perfeito: a 14 de fevereiro, com o parceiro com quem mais fizeste
  -- dupla até esse dia (com empate, qualquer um deles serve).
  IF EXISTS (SELECT 1 FROM _a27 v
              WHERE EXTRACT(MONTH FROM v.starts) = 2 AND EXTRACT(DAY FROM v.starts) = 14 AND v.partner IS NOT NULL
                AND (SELECT count(*) FROM _a27 b WHERE b.partner = v.partner AND b.starts < date_trunc('day', v.starts))
                    >= COALESCE((SELECT max(n) FROM (SELECT count(*) AS n FROM _a27 b WHERE b.partner IS NOT NULL
                                    AND b.starts < date_trunc('day', v.starts) GROUP BY b.partner) q), 0)
                AND EXISTS (SELECT 1 FROM _a27 b WHERE b.partner = v.partner AND b.starts < date_trunc('day', v.starts)))
  THEN e := array_append(e, 'par_perfeito'); END IF;

  -- ── Gente ──
  -- Aplauso Geral: num mix com 8+ jogadores, kudos de todos os outros com conta.
  IF EXISTS (SELECT 1 FROM mix_player_stats me JOIN games g ON g.id = me.game_id
              WHERE me.user_id = p_user_id
                AND (SELECT count(*) FROM mix_player_stats s JOIN profiles p ON p.id = s.user_id
                      WHERE s.game_id = me.game_id AND NOT COALESCE(p.is_test, FALSE)) >= 8
                AND NOT EXISTS (SELECT 1 FROM mix_player_stats s JOIN profiles p ON p.id = s.user_id
                                 WHERE s.game_id = me.game_id AND s.user_id <> p_user_id AND NOT COALESCE(p.is_test, FALSE)
                                   AND NOT EXISTS (SELECT 1 FROM mix_kudos k WHERE k.game_id = me.game_id
                                                     AND k.recipient_id = p_user_id AND k.voter_id = s.user_id)))
  THEN e := array_append(e, 'aplauso_geral'); END IF;
  -- A Malta Toda: num mix que jogaste, 5+ outros jogadores que segues.
  IF EXISTS (SELECT 1 FROM mix_player_stats me
              WHERE me.user_id = p_user_id
                AND (SELECT count(*) FROM mix_player_stats s
                      JOIN follows f ON f.follower_id = p_user_id AND f.followed_id = s.user_id AND f.status = 'accepted'
                     WHERE s.game_id = me.game_id AND s.user_id <> p_user_id) >= 5)
  THEN e := array_append(e, 'a_malta_toda'); END IF;
  -- Casa Cheia: num mês, o clube/grupo fez 10+ mixes jogados e tu jogaste 5+.
  IF EXISTS (SELECT 1 FROM (SELECT g.organization_id AS org, date_trunc('month', g.date AT TIME ZONE 'Europe/Lisbon') AS mo, count(DISTINCT g.id) AS n
                              FROM mix_player_stats me JOIN games g ON g.id = me.game_id
                             WHERE me.user_id = p_user_id GROUP BY 1, 2) x
              WHERE x.n >= 5
                AND (SELECT count(*) FROM games g2 WHERE g2.organization_id = x.org AND g2.status = 'finished'
                      AND date_trunc('month', g2.date AT TIME ZONE 'Europe/Lisbon') = x.mo) >= 10)
  THEN e := array_append(e, 'casa_cheia'); END IF;
  -- Alma do Grupo: criaste um grupo que chegou a 20 membros com conta.
  IF EXISTS (SELECT 1 FROM organizations o
              WHERE o.kind = 'group' AND o.owner_id = p_user_id
                AND (SELECT count(*) FROM memberships ms JOIN profiles p ON p.id = ms.user_id
                      WHERE ms.organization_id = o.id AND NOT COALESCE(ms.is_guest, FALSE)
                        AND NOT COALESCE(ms.is_test, FALSE) AND NOT COALESCE(p.is_test, FALSE)) >= 20)
  THEN e := array_append(e, 'alma_do_grupo'); END IF;
  -- Clássico: 10 jogos entre amigos sempre com as mesmas quatro pessoas com conta.
  IF EXISTS (SELECT 1 FROM (SELECT night, (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[p_user_id, partner, opp1, opp2]) x) AS four
                              FROM _a27 WHERE kind = 'amigos' AND partner IS NOT NULL AND opp1 IS NOT NULL AND opp2 IS NOT NULL) q
              GROUP BY four HAVING count(DISTINCT night) >= 10)
  THEN e := array_append(e, 'classico'); END IF;

  -- ── Inscrições (aproximação aceite pela BA: os que ficaram, por created_at) ──
  -- Esgotado: tiveste lugar num mix que encheu menos de 1 h depois de abrir, e jogaste-o.
  -- Fecha-Campo: a tua inscrição foi a que encheu o mix, e jogaste-o.
  WITH mine AS (
    SELECT g.id, g.max_players, COALESCE(g.launch_at, g.created_at) AS opened
      FROM mix_player_stats me JOIN games g ON g.id = me.game_id
     WHERE me.user_id = p_user_id AND g.max_players IS NOT NULL
  ), runs AS (
    SELECT mi.id AS game_id, mi.max_players, mi.opened, pa.user_id, pa.created_at,
           sum(1 + CASE WHEN pa.partner_id IS NOT NULL OR pa.partner_guest_id IS NOT NULL THEN 1 ELSE 0 END)
             OVER (PARTITION BY mi.id ORDER BY pa.created_at, pa.id) AS people
      FROM mine mi JOIN participants pa ON pa.game_id = mi.id AND pa.status = 'confirmed'
  ), fill AS (
    SELECT DISTINCT ON (game_id) game_id, opened, user_id, created_at
      FROM runs WHERE people >= max_players ORDER BY game_id, created_at
  )
  SELECT e
         || CASE WHEN EXISTS (SELECT 1 FROM fill WHERE created_at - opened < INTERVAL '1 hour') THEN ARRAY['esgotado'] ELSE '{}' END
         || CASE WHEN EXISTS (SELECT 1 FROM fill WHERE user_id = p_user_id) THEN ARRAY['fecha_campo'] ELSE '{}' END
    INTO e;

  -- ── Torneios ──
  -- Fiel ao Clube: jogaste em 3 torneios do mesmo clube ou grupo.
  IF EXISTS (SELECT 1 FROM _a27 WHERE kind = 'torneio' GROUP BY org HAVING count(DISTINCT extra) >= 3) THEN e := array_append(e, 'fiel_ao_clube'); END IF;
  -- Sobrevivente: perdes o primeiro jogo do grupo (jogado, não por falta) e passas ao quadro.
  IF EXISTS (SELECT 1 FROM (SELECT DISTINCT ON (night) night, lost FROM _a27
                              WHERE kind = 'torneio' AND fmt = 'grupo' ORDER BY night, starts) f
              WHERE f.lost AND EXISTS (SELECT 1 FROM tournament_matches k JOIN tournament_entries me ON me.id IN (k.entry_a_id, k.entry_b_id)
                                        WHERE k.category_id = f.night AND k.stage = 'principal' AND p_user_id IN (me.player1_id, me.player2_id)))
  THEN e := array_append(e, 'sobrevivente'); END IF;

  -- ── Convites (como o Recrutador: convite de grupo/clube aceite, ou convite
  -- de parceiro reclamado). Cada pessoa conta uma vez; contas de teste não.
  WITH invited AS (
    SELECT DISTINCT x.pid FROM (
      SELECT oi.invited_user_id AS pid FROM organization_invites oi WHERE oi.invited_by = p_user_id AND oi.status = 'accepted'
      UNION
      SELECT pi.claimed_by FROM partner_invites pi WHERE pi.invited_by = p_user_id AND pi.claimed_by IS NOT NULL
    ) x JOIN profiles p ON p.id = x.pid AND NOT COALESCE(p.is_test, FALSE)
    WHERE x.pid <> p_user_id
  ), played AS (
    SELECT i.pid FROM invited i WHERE EXISTS (SELECT 1 FROM mix_player_stats s WHERE s.user_id = i.pid)
  ), first_mix AS (
    SELECT i.pid, (SELECT s.game_id FROM mix_player_stats s JOIN games g ON g.id = s.game_id
                    WHERE s.user_id = i.pid ORDER BY g.date LIMIT 1) AS game_id
      FROM invited i
  )
  SELECT e
         || CASE WHEN (SELECT count(*) FROM played) >= 3 THEN ARRAY['boca_a_boca'] ELSE '{}' END
         || CASE WHEN (SELECT count(*) FROM played) >= 10 THEN ARRAY['embaixador_da_bola'] ELSE '{}' END
         -- Batismo de Campo: o primeiro mix dele, contigo como parceiro em pelo menos um jogo.
         || CASE WHEN EXISTS (SELECT 1 FROM first_mix fm JOIN _a27 a ON a.kind = 'mix' AND a.night = fm.game_id AND a.partner = fm.pid)
                 THEN ARRAY['batismo_de_campo'] ELSE '{}' END
    INTO e;

  INSERT INTO player_achievements (user_id, achievement_key, awarded_at)
  SELECT p_user_id, k, COALESCE(p_awarded_at, NOW())
    FROM unnest(e) AS k
    JOIN achievements a ON a.key = k AND a.active
  ON CONFLICT (user_id, achievement_key) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'check_and_award_achievements_27 falhou para %: %', p_user_id, SQLERRM;
  END;
END;
$function$;

-- Interna: só a chamam as funções da base de dados.
REVOKE ALL ON FUNCTION public.check_and_award_achievements_27(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ── 3. O verificador de sempre chama a nova no fim (corpo VIVO) ─────────
DO $$
DECLARE
  c_anchor CONSTANT TEXT := E'  ON CONFLICT (user_id, achievement_key) DO NOTHING;\n\n  EXCEPTION WHEN OTHERS THEN';
  v_def TEXT := pg_get_functiondef('public.check_and_award_achievements(uuid)'::regprocedure);
BEGIN
  IF position('check_and_award_achievements_27' IN v_def) > 0 THEN
    RAISE NOTICE 'check_and_award_achievements: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 THEN
    RAISE EXCEPTION 'check_and_award_achievements: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_anchor,
    E'  ON CONFLICT (user_id, achievement_key) DO NOTHING;\n\n'
    || E'  -- As 27 do Marketing (#625, Dev 2, 12 out), à parte.\n'
    || E'  PERFORM check_and_award_achievements_27(p_user_id);\n\n'
    || E'  EXCEPTION WHEN OTHERS THEN');
END $$;

-- ── 4. O passado conta, sem animação nem aviso ──────────────────────────
-- Datadas do último «visto» de cada pessoa: não aparecem no «Novidades para
-- ti» (awarded_at > celebrations_seen_at) nem como «Nova».
SELECT check_and_award_achievements_27(p.id,
         CASE WHEN p.celebrations_seen_at IS NULL THEN '-infinity'::timestamptz
              ELSE LEAST(p.celebrations_seen_at, NOW()) END)
  FROM profiles p
 WHERE NOT COALESCE(p.is_test, FALSE);

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM achievements WHERE sort BETWEEN 1001 AND 1027 AND active;              -- 27
--   SELECT position('check_and_award_achievements_27' IN pg_get_functiondef('public.check_and_award_achievements(uuid)'::regprocedure)) > 0;  -- true
--   SELECT has_function_privilege('authenticated', 'public.check_and_award_achievements_27(uuid,timestamptz)', 'EXECUTE');            -- false
--   SELECT achievement_key, count(*) FROM player_achievements WHERE achievement_key IN (SELECT key FROM achievements WHERE sort > 1000) GROUP BY 1;
