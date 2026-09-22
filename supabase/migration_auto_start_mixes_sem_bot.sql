-- ════════════════════════════════════════════════════════════════════════
-- «Começar automaticamente» passa a funcionar com ou sem bot (Trello #399).
--
-- Regra do Francisco (22 set 2026, depois do «Terças @ IPC»): «não pode ser
-- por não ter bot que não começa o mix». Hoje o arranque automático só
-- existe no bot de WhatsApp (whatsapp-bot/src/autostart.js, poll de 5 em 5
-- min): num grupo sem bot — «Aquele padel maroto» — o mix nunca arranca, a
-- nenhuma hora. Confirmado em produção a 22 set: esse grupo tem 2 mixes
-- futuros com arranque automático que não arrancariam.
--
-- Mesmo padrão de process_due_game_recurrences (cron de 5 em 5 min) e de
-- cancel_stale_open_mixes: corre na base de dados, sem depender do bot
-- estar ligado nem de alguém ter a app aberta.
--
-- COMO CONVIVE COM O BOT (sem arrancarem os dois ao mesmo tempo)
--   - o bot só pega em mixes com status 'open'/'closed'; assim que esta
--     função os põe 'in_progress', ele ignora-os;
--   - num grupo COM bot, esta função espera 15 minutos além da hora do
--     arranque antes de agir, para o bot ter a sua vez e anunciar as duplas
--     no grupo. Passados esses 15 minutos (bot em baixo, sem internet, por
--     reinstalar), a base de dados arranca à mesma — o mix começa, só não
--     há aviso no WhatsApp;
--   - num grupo SEM bot, arranca à hora, sem esperar.
--
-- FORMATOS: só os que o bot também sabe conduzir — «Sobe e desce» e «Todos
-- contra todos», duplas fixas, emparelhamento por nível. Americano, Grupos
-- + Eliminatórias, «Trocam a cada ronda» e os modos Equilibrado/Aleatório
-- continuam a esperar pelo admin, que os começa na app (mesma trava que o
-- bot leva no pacote de 22 set). Suportá-los aqui é trabalho à parte.
--
-- DUPLAS: mesma regra da app — duplas escolhidas pelos jogadores ficam
-- intactas; os que se inscreveram sozinhos são ordenados por pontos e
-- emparelhados evitando repetir par dos ÚLTIMOS 4 MIXES do grupo. É a
-- terceira implementação desta regra (app, bot, aqui) — o cartão #399
-- regista a dívida, para o Renato decidir se un dia se unificam.
--
-- PROPOSTA — precisa do sim do Renato antes de correr em produção.
-- É seguro re-correr.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION start_due_mixes()
RETURNS INTEGER AS $$
DECLARE
  v_game RECORD;
  v_tem_bot BOOLEAN;
  v_capacidade INT;
  v_pessoas INT;
  v_pares_recentes TEXT[];
  v_solos UUID[];
  v_duplas INT := 0;
  v_arrancados INT := 0;
  a UUID;
  b UUID;
  i INT;
  escolhido INT;
BEGIN
  FOR v_game IN
    SELECT g.*
    FROM games g
    WHERE g.auto_start_hours_before IS NOT NULL
      AND g.status IN ('open', 'closed')
      AND g.date > now()
      AND g.date <= now() + (g.auto_start_hours_before || ' hours')::interval
      AND COALESCE(g.format, 'sobe_desce') IN ('sobe_desce', 'todos_contra_todos')
      AND NOT COALESCE(g.rotate_partners, FALSE)
      AND COALESCE(g.pairing_mode, 'por_nivel') = 'por_nivel'
      AND COALESCE(g.origin, 'admin') <> 'open_slot'
  LOOP
    -- Só quando todos os campos estão cheios (mesma regra do bot).
    v_capacidade := COALESCE(v_game.max_players, COALESCE(v_game.num_courts, 1) * 4);
    SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL THEN 1 ELSE 0 END), 0)
      INTO v_pessoas
      FROM participants WHERE game_id = v_game.id AND status = 'confirmed';
    CONTINUE WHEN v_pessoas < v_capacidade;

    -- Grupo com bot: dar-lhe 15 minutos de avanço.
    SELECT EXISTS (SELECT 1 FROM whatsapp_groups w WHERE w.organization_id = v_game.organization_id)
      INTO v_tem_bot;
    CONTINUE WHEN v_tem_bot
      AND v_game.date > now() + ((v_game.auto_start_hours_before * 60 - 15) || ' minutes')::interval;

    -- Pares dos últimos 4 mixes deste grupo.
    SELECT COALESCE(array_agg(
             least(t.player1_id::text, t.player2_id::text) || '|' ||
             greatest(t.player1_id::text, t.player2_id::text)), '{}')
      INTO v_pares_recentes
      FROM teams t
     WHERE t.game_id IN (
       SELECT id FROM games
       WHERE organization_id = v_game.organization_id AND date < v_game.date
       ORDER BY date DESC LIMIT 4
     );

    -- Duplas escolhidas pelos jogadores: ficam como estão.
    INSERT INTO teams (game_id, player1_id, player2_id, seed_ranking)
    SELECT v_game.id, p.user_id, p.partner_id,
           COALESCE(pr1.rating, 0)::int + COALESCE(pr2.rating, 0)::int
      FROM participants p
      LEFT JOIN profiles pr1 ON pr1.id = p.user_id
      LEFT JOIN profiles pr2 ON pr2.id = p.partner_id
     WHERE p.game_id = v_game.id AND p.status = 'confirmed' AND p.partner_id IS NOT NULL;
    GET DIAGNOSTICS v_duplas = ROW_COUNT;

    -- Quem se inscreveu sozinho, por pontos (mais alto primeiro).
    SELECT COALESCE(array_agg(p.user_id ORDER BY COALESCE(pr.rating, 0) DESC), '{}')
      INTO v_solos
      FROM participants p
      LEFT JOIN profiles pr ON pr.id = p.user_id
     WHERE p.game_id = v_game.id AND p.status = 'confirmed' AND p.partner_id IS NULL;

    WHILE array_length(v_solos, 1) >= 2 LOOP
      a := v_solos[1];
      v_solos := v_solos[2:];
      -- primeiro candidato que não repete par dos últimos 4 mixes; se todos
      -- repetirem, fica o mais próximo em pontos (igual à app e ao bot)
      escolhido := 1;
      FOR i IN 1..array_length(v_solos, 1) LOOP
        IF NOT (least(a::text, v_solos[i]::text) || '|' || greatest(a::text, v_solos[i]::text) = ANY (v_pares_recentes)) THEN
          escolhido := i;
          EXIT;
        END IF;
      END LOOP;
      b := v_solos[escolhido];
      v_solos := v_solos[1:escolhido-1] || v_solos[escolhido+1:];

      INSERT INTO teams (game_id, player1_id, player2_id, seed_ranking)
      SELECT v_game.id, a, b,
             COALESCE((SELECT rating FROM profiles WHERE id = a), 0)::int
           + COALESCE((SELECT rating FROM profiles WHERE id = b), 0)::int;
      v_duplas := v_duplas + 1;
    END LOOP;

    -- Menos de 2 duplas não dá mix: desfaz e tenta no próximo ciclo.
    IF v_duplas < 2 THEN
      DELETE FROM teams WHERE game_id = v_game.id;
      CONTINUE;
    END IF;

    UPDATE games SET status = 'in_progress', updated_at = NOW() WHERE id = v_game.id;
    v_arrancados := v_arrancados + 1;
  END LOOP;

  RETURN v_arrancados;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION start_due_mixes() FROM public, anon, authenticated;

-- De 5 em 5 minutos, como process_due_game_recurrences. cron.schedule
-- substitui o trabalho se já existir, por isso é seguro re-correr.
SELECT cron.schedule('start-due-mixes', '*/5 * * * *', $$SELECT start_due_mixes()$$);

-- ── Verificação ──────────────────────────────────────────────────────────
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'start-due-mixes';
-- Mixes que esta função vai apanhar (só leitura):
-- SELECT g.title, g.date, o.name AS grupo,
--        EXISTS (SELECT 1 FROM whatsapp_groups w WHERE w.organization_id = g.organization_id) AS tem_bot
-- FROM games g JOIN organizations o ON o.id = g.organization_id
-- WHERE g.auto_start_hours_before IS NOT NULL AND g.status IN ('open','closed') AND g.date > now();
