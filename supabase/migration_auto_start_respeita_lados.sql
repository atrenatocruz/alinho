-- ════════════════════════════════════════════════════════════════════════
-- O arranque automático passa a olhar ao lado preferido (Trello #404).
--
-- PORQUÊ. A 22 set corrigiu-se o sorteio da app para não juntar dois
-- jogadores do mesmo lado quando havia alternativa. O arranque automático
-- (start_due_mixes, de migration_auto_start_mixes_sem_bot.sql) formava as
-- duplas só por pontos e por pares repetidos — o lado preferido não entrava
-- na conta de todo. Nos grupos que começam o mix sozinhos, que são
-- precisamente os que ninguém está a ver na altura, saíam duplas de dois
-- esquerdinos sem que nada as evitasse.
--
-- O QUE MUDA. Ao escolher o parceiro de cada jogador, por esta ordem:
--   1. não repete par dos últimos 4 mixes E dá lados diferentes;
--   2. não repete par (lado igual, quando não há outra saída);
--   3. o primeiro que sobrar.
-- 'both' (o valor por defeito) joga dos dois lados, por isso serve sempre.
--
-- HONESTIDADE SOBRE O LIMITE DISTO. A app, desde a mesma data, faz melhor:
-- recua e experimenta outras combinações para chegar ao mínimo possível de
-- duplas do mesmo lado. Aqui a escolha é seguida, sem recuar — resolve o
-- caso normal, não garante o mínimo. Unificar as três implementações
-- (app, bot, base de dados) é o trabalho que o cartão #399 já regista.
--
-- Tudo o resto — que mixes apanha, a espera de 15 minutos nos grupos com
-- bot, as duplas escolhidas pelos jogadores — fica igual.
--
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
  v_lados TEXT[];
  v_duplas INT := 0;
  v_arrancados INT := 0;
  a UUID;
  a_lado TEXT;
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

    -- Quem se inscreveu sozinho, por pontos (mais alto primeiro), com o
    -- lado preferido de cada um na mesma ordem.
    SELECT COALESCE(array_agg(p.user_id ORDER BY COALESCE(pr.rating, 0) DESC), '{}'),
           COALESCE(array_agg(COALESCE(pr.preferred_side, 'both') ORDER BY COALESCE(pr.rating, 0) DESC), '{}')
      INTO v_solos, v_lados
      FROM participants p
      LEFT JOIN profiles pr ON pr.id = p.user_id
     WHERE p.game_id = v_game.id AND p.status = 'confirmed' AND p.partner_id IS NULL;

    WHILE array_length(v_solos, 1) >= 2 LOOP
      a := v_solos[1];
      a_lado := v_lados[1];
      v_solos := v_solos[2:];
      v_lados := v_lados[2:];

      -- 1.ª escolha: sem repetir o par e com lados diferentes.
      escolhido := 0;
      FOR i IN 1..array_length(v_solos, 1) LOOP
        IF NOT (least(a::text, v_solos[i]::text) || '|' || greatest(a::text, v_solos[i]::text) = ANY (v_pares_recentes))
           AND (a_lado = 'both' OR v_lados[i] = 'both' OR a_lado <> v_lados[i]) THEN
          escolhido := i;
          EXIT;
        END IF;
      END LOOP;

      -- 2.ª: sem repetir o par, mesmo que o lado seja o mesmo.
      IF escolhido = 0 THEN
        FOR i IN 1..array_length(v_solos, 1) LOOP
          IF NOT (least(a::text, v_solos[i]::text) || '|' || greatest(a::text, v_solos[i]::text) = ANY (v_pares_recentes)) THEN
            escolhido := i;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      -- 3.ª: já não há nada a escolher — fica o mais próximo em pontos.
      IF escolhido = 0 THEN escolhido := 1; END IF;

      b := v_solos[escolhido];
      v_solos := v_solos[1:escolhido-1] || v_solos[escolhido+1:];
      v_lados := v_lados[1:escolhido-1] || v_lados[escolhido+1:];

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

-- O trabalho de 5 em 5 minutos já existe desde migration_auto_start_mixes_sem_bot.sql;
-- esta migração só troca o corpo da função. Confirmar que continua lá:
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'start-due-mixes';
--
-- ── Verificação ──────────────────────────────────────────────────────────
-- A função já olha ao lado:
-- SELECT pg_get_functiondef(oid) ~ 'preferred_side' AS olha_ao_lado
-- FROM pg_proc WHERE proname = 'start_due_mixes';
