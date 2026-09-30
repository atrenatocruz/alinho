-- ════════════════════════════════════════════════════════════════════════
-- GUESTS SEM CONTA NOS MIXES — conta = email (decisão Ruben, 30 set 2026)
--
-- O bot deixa de fabricar contas (`guest-*@whatsapp.alinho.pt`) para
-- números desconhecidos: essas pessoas passam a participantes SEM conta —
-- uma linha em `game_guests` (nome + phone_hash), sem profiles, sem rank.
-- O Elo já estava pronto (migration_elo_simples.sql: NULL = lugar sem
-- conta, a dupla vale a média de quem tem conta ⇒ com 1 guest vale o
-- rating do parceiro); o finalize já filtra `pid IS NOT NULL`. Esta
-- migração trata do resto: modelo de dados, contagem de vagas, sorteio
-- automático, lookalike, verificação de número e adoção de inscrições.
--
-- Decisões (Ruben, 30 set / 1 out):
--   • Grandfathering: quem já tem número associado fica VALIDADO
--     (phone_verified_at carimbado); novos utilizadores verificam antes de
--     o número contar para o match do bot.
--   • Legado guest-*: congela SEM dreno — o merge juntar_convidado sai do
--     confirm; quem se registar depois começa do zero.
--   • #339 (parceiro por nome com claim): substituído por guests sem
--     conta; partner_invites deixa de ganhar linhas novas (os pendentes
--     expiram sozinhos em 30 dias).
--
-- TUDO ADITIVO para o código no ar: o bot velho e a web velha continuam a
-- funcionar com este schema (só inserem linhas com user_id). Correr este
-- ficheiro inteiro no Supabase → SQL Editor ANTES de qualquer deploy do
-- branch feat/guests-sem-conta.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. game_guests: a identidade de um convidado DENTRO de um jogo ──────
-- Um UUID por convidado por jogo — flui por participants → teams →
-- drag-and-drop tal como um profiles.id, sem criar conta nenhuma.

CREATE TABLE IF NOT EXISTS game_guests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  phone_hash TEXT,        -- NULL = convidado só por nome (app/lista copiada)
  whatsapp_jid TEXT,      -- para @menções do bot; NUNCA legível pela app
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- O mesmo número só entra uma vez por jogo (anti-duplo-In do bot). Índice
-- COMPLETO e não parcial: o upsert do bot usa ON CONFLICT (game_id,
-- phone_hash), que não sabe apontar a índices parciais — e com phone_hash
-- NULL (convidados só por nome) os NULLs nunca colidem entre si.
CREATE UNIQUE INDEX IF NOT EXISTS game_guests_game_phone_key
  ON game_guests (game_id, phone_hash);
CREATE INDEX IF NOT EXISTS idx_game_guests_game ON game_guests (game_id);

ALTER TABLE game_guests ENABLE ROW LEVEL SECURITY;

-- Ler: membros do clube do jogo (mesmo âmbito de participants).
DROP POLICY IF EXISTS "Org members can view game guests" ON game_guests;
CREATE POLICY "Org members can view game guests"
  ON game_guests FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = game_guests.game_id AND memberships.user_id = auth.uid()
  ));

-- Gerir: admins do clube (o bot usa service-role e passa por cima).
DROP POLICY IF EXISTS "Org admins can manage game guests" ON game_guests;
CREATE POLICY "Org admins can manage game guests"
  ON game_guests FOR ALL
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = game_guests.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = game_guests.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- Grants por coluna: phone_hash e whatsapp_jid são pseudónimos de dados
-- pessoais — só o service-role os lê (padrão de
-- migration_tournament_entries_colunas.sql). A app tem de enumerar
-- colunas nos selects (um select('*') dá 42501, de propósito).
REVOKE ALL ON game_guests FROM public, anon, authenticated;
GRANT SELECT (id, game_id, name, created_at) ON game_guests TO authenticated;
GRANT DELETE ON game_guests TO authenticated;  -- policy restringe a admins

-- ── 2. participants e teams aprendem a apontar para um convidado ────────

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES game_guests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS partner_guest_id UUID REFERENCES game_guests(id) ON DELETE SET NULL;

-- Titular: ou conta ou convidado, nunca os dois nem nenhum.
ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_owner_xor;
ALTER TABLE participants ADD CONSTRAINT participants_owner_xor
  CHECK ((user_id IS NULL) <> (guest_id IS NULL));
-- Parceiro: no máximo um dos dois (ou nenhum — inscrição a solo).
ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_partner_one;
ALTER TABLE participants ADD CONSTRAINT participants_partner_one
  CHECK (partner_id IS NULL OR partner_guest_id IS NULL);

-- UNIQUE(game_id, user_id) não deduplica NULLs — o convidado tem o seu.
CREATE UNIQUE INDEX IF NOT EXISTS participants_game_guest_key
  ON participants (game_id, guest_id) WHERE guest_id IS NOT NULL;

ALTER TABLE teams
  ALTER COLUMN player1_id DROP NOT NULL,
  ALTER COLUMN player2_id DROP NOT NULL;
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS player1_guest_id UUID REFERENCES game_guests(id),
  ADD COLUMN IF NOT EXISTS player2_guest_id UUID REFERENCES game_guests(id);
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_p1_one;
ALTER TABLE teams ADD CONSTRAINT teams_p1_one
  CHECK ((player1_id IS NULL) <> (player1_guest_id IS NULL));
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_p2_one;
ALTER TABLE teams ADD CONSTRAINT teams_p2_one
  CHECK ((player2_id IS NULL) <> (player2_guest_id IS NULL));

-- Colunas novas de participants/teams: visíveis a quem já via as linhas.
GRANT SELECT (guest_id, partner_guest_id) ON participants TO authenticated;
GRANT SELECT (player1_guest_id, player2_guest_id) ON teams TO authenticated;

-- Convidado sem inscrição não serve de nada: quando a última linha que o
-- referencia sai, a linha dele vai atrás (nome + hash não ficam a arrastar).
CREATE OR REPLACE FUNCTION game_guests_gc()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM game_guests gg
   WHERE gg.id IN (OLD.guest_id, OLD.partner_guest_id)
     AND NOT EXISTS (SELECT 1 FROM participants p
                      WHERE p.guest_id = gg.id OR p.partner_guest_id = gg.id)
     AND NOT EXISTS (SELECT 1 FROM teams t
                      WHERE t.player1_guest_id = gg.id OR t.player2_guest_id = gg.id);
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION game_guests_gc() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS participants_guest_gc ON participants;
CREATE TRIGGER participants_guest_gc
  AFTER DELETE ON participants
  FOR EACH ROW
  WHEN (OLD.guest_id IS NOT NULL OR OLD.partner_guest_id IS NOT NULL)
  EXECUTE FUNCTION game_guests_gc();
-- Também quando a linha DEIXA de apontar para o convidado (tirar o parceiro
-- na app, adoção na confirmação do número) — um UPDATE não passa pelo
-- trigger de DELETE.
DROP TRIGGER IF EXISTS participants_guest_gc_upd ON participants;
CREATE TRIGGER participants_guest_gc_upd
  AFTER UPDATE OF guest_id, partner_guest_id ON participants
  FOR EACH ROW
  WHEN ((OLD.guest_id IS NOT NULL AND NEW.guest_id IS DISTINCT FROM OLD.guest_id)
     OR (OLD.partner_guest_id IS NOT NULL AND NEW.partner_guest_id IS DISTINCT FROM OLD.partner_guest_id))
  EXECUTE FUNCTION game_guests_gc();

-- ── 3. Contagem de vagas: parceiro-convidado também ocupa lugar ─────────
-- (as três funções vivas que contam: guard, promote, full)

-- Base: migration_mix_capacity_guard.sql (Renato, 24 set) — só muda a
-- aritmética do parceiro e o UPDATE OF do trigger.
CREATE OR REPLACE FUNCTION participants_capacity_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap    INTEGER;
  v_status TEXT;
  v_org    UUID;
  v_taken  INTEGER;
  v_size   INTEGER := CASE WHEN NEW.partner_id IS NOT NULL OR NEW.partner_guest_id IS NOT NULL THEN 2 ELSE 1 END;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed'
     AND NOT ((OLD.partner_id IS NULL AND OLD.partner_guest_id IS NULL)
              AND (NEW.partner_id IS NOT NULL OR NEW.partner_guest_id IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  SELECT COALESCE(max_players, num_courts * 4), status, organization_id
    INTO v_cap, v_status, v_org
    FROM games WHERE id = NEW.game_id FOR UPDATE;
  IF v_status NOT IN ('open', 'closed') THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND is_org_admin(v_org) THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO v_taken
    FROM participants
   WHERE game_id = NEW.game_id AND status = 'confirmed' AND id <> NEW.id;
  IF v_taken + v_size > v_cap THEN
    RAISE EXCEPTION 'game_full';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION participants_capacity_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS participants_capacity_guard ON participants;
CREATE TRIGGER participants_capacity_guard
  BEFORE INSERT OR UPDATE OF status, partner_id, partner_guest_id ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_capacity_guard();

-- Base: migration_promote_on_capacity_increase.sql.
CREATE OR REPLACE FUNCTION promote_waitlist(p_game_id UUID)
RETURNS VOID AS $$
DECLARE
  cap INTEGER;
  people INTEGER;
  v_waitlisted_id UUID;
BEGIN
  SELECT COALESCE(max_players, num_courts * 4) INTO cap FROM games WHERE id = p_game_id;

  LOOP
    SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END), 0)
      INTO people
      FROM participants
     WHERE game_id = p_game_id AND status = 'confirmed';

    EXIT WHEN people >= cap;

    SELECT id INTO v_waitlisted_id
      FROM participants
     WHERE game_id = p_game_id AND status = 'waitlisted'
     ORDER BY created_at
     LIMIT 1;

    EXIT WHEN v_waitlisted_id IS NULL;

    UPDATE participants SET status = 'confirmed' WHERE id = v_waitlisted_id;
  END LOOP;

  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO people
    FROM participants
   WHERE game_id = p_game_id AND status = 'confirmed';

  IF people < cap THEN
    UPDATE games SET status = 'open', updated_at = NOW()
    WHERE id = p_game_id AND status = 'closed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Base: schema.sql (check_game_full).
CREATE OR REPLACE FUNCTION check_game_full()
RETURNS TRIGGER AS $$
DECLARE
  people INTEGER;
  cap INTEGER;
BEGIN
  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO people
    FROM participants
   WHERE game_id = NEW.game_id AND status = 'confirmed';

  SELECT COALESCE(max_players, num_courts * 4) INTO cap FROM games WHERE id = NEW.game_id;

  IF people >= cap THEN
    UPDATE games SET status = 'closed', updated_at = NOW()
    WHERE id = NEW.game_id AND status = 'open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 4. Arranque automático com convidados ───────────────────────────────
-- Base: migration_auto_start_respeita_lados.sql (Trello #404). Novidades:
-- chave do jogador = COALESCE(user_id, guest_id); convidado emparelha com
-- rating 900 (o baseline que as contas fantasma usavam) e lado 'both';
-- seed_ranking: o convidado HERDA o rating do parceiro (2×avg de quem tem
-- conta; dupla 100% convidados = 0) — coerente com a regra do Elo.
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
  v_guest BOOLEAN[];
  v_pontos INT[];
  v_duplas INT := 0;
  v_arrancados INT := 0;
  a UUID;    a_lado TEXT;  a_guest BOOLEAN;  a_pts INT;
  b UUID;    b_guest BOOLEAN;                b_pts INT;
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
    v_capacidade := COALESCE(v_game.max_players, COALESCE(v_game.num_courts, 1) * 4);
    SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END), 0)
      INTO v_pessoas
      FROM participants WHERE game_id = v_game.id AND status = 'confirmed';
    CONTINUE WHEN v_pessoas < v_capacidade;

    SELECT EXISTS (SELECT 1 FROM whatsapp_groups w WHERE w.organization_id = v_game.organization_id)
      INTO v_tem_bot;
    CONTINUE WHEN v_tem_bot
      AND v_game.date > now() + ((v_game.auto_start_hours_before * 60 - 15) || ' minutes')::interval;

    -- Pares dos últimos 4 mixes (convidados têm id por jogo — nunca
    -- repetem entre mixes, o COALESCE é só para não gerar NULLs).
    SELECT COALESCE(array_agg(
             least(COALESCE(t.player1_id, t.player1_guest_id)::text,
                   COALESCE(t.player2_id, t.player2_guest_id)::text) || '|' ||
             greatest(COALESCE(t.player1_id, t.player1_guest_id)::text,
                      COALESCE(t.player2_id, t.player2_guest_id)::text)), '{}')
      INTO v_pares_recentes
      FROM teams t
     WHERE t.game_id IN (
       SELECT id FROM games
       WHERE organization_id = v_game.organization_id AND date < v_game.date
       ORDER BY date DESC LIMIT 4
     );

    -- Duplas escolhidas pelos jogadores: ficam como estão.
    INSERT INTO teams (game_id, player1_id, player1_guest_id, player2_id, player2_guest_id, seed_ranking)
    SELECT v_game.id, p.user_id, p.guest_id, p.partner_id, p.partner_guest_id,
           CASE
             WHEN p.user_id IS NOT NULL AND p.partner_id IS NOT NULL
               THEN COALESCE(pr1.rating, 0)::int + COALESCE(pr2.rating, 0)::int
             WHEN p.user_id IS NOT NULL   THEN COALESCE(pr1.rating, 0)::int * 2
             WHEN p.partner_id IS NOT NULL THEN COALESCE(pr2.rating, 0)::int * 2
             ELSE 0
           END
      FROM participants p
      LEFT JOIN profiles pr1 ON pr1.id = p.user_id
      LEFT JOIN profiles pr2 ON pr2.id = p.partner_id
     WHERE p.game_id = v_game.id AND p.status = 'confirmed'
       AND (p.partner_id IS NOT NULL OR p.partner_guest_id IS NOT NULL);
    GET DIAGNOSTICS v_duplas = ROW_COUNT;

    -- Solos por pontos (convidado = 900, lado 'both').
    SELECT COALESCE(array_agg(x.pid  ORDER BY x.pts DESC), '{}'),
           COALESCE(array_agg(x.lado ORDER BY x.pts DESC), '{}'),
           COALESCE(array_agg(x.eh_convidado ORDER BY x.pts DESC), '{}'),
           COALESCE(array_agg(x.pts  ORDER BY x.pts DESC), '{}')
      INTO v_solos, v_lados, v_guest, v_pontos
      FROM (
        SELECT COALESCE(p.user_id, p.guest_id) AS pid,
               CASE WHEN p.user_id IS NULL THEN 'both'
                    ELSE COALESCE(pr.preferred_side, 'both') END AS lado,
               (p.user_id IS NULL) AS eh_convidado,
               CASE WHEN p.user_id IS NULL THEN 900
                    ELSE COALESCE(pr.rating, 0)::int END AS pts
          FROM participants p
          LEFT JOIN profiles pr ON pr.id = p.user_id
         WHERE p.game_id = v_game.id AND p.status = 'confirmed'
           AND p.partner_id IS NULL AND p.partner_guest_id IS NULL
      ) x;

    WHILE array_length(v_solos, 1) >= 2 LOOP
      a := v_solos[1];  a_lado := v_lados[1];  a_guest := v_guest[1];  a_pts := v_pontos[1];
      v_solos := v_solos[2:];  v_lados := v_lados[2:];
      v_guest := v_guest[2:];  v_pontos := v_pontos[2:];

      escolhido := 0;
      FOR i IN 1..array_length(v_solos, 1) LOOP
        IF NOT (least(a::text, v_solos[i]::text) || '|' || greatest(a::text, v_solos[i]::text) = ANY (v_pares_recentes))
           AND (a_lado = 'both' OR v_lados[i] = 'both' OR a_lado <> v_lados[i]) THEN
          escolhido := i;
          EXIT;
        END IF;
      END LOOP;

      IF escolhido = 0 THEN
        FOR i IN 1..array_length(v_solos, 1) LOOP
          IF NOT (least(a::text, v_solos[i]::text) || '|' || greatest(a::text, v_solos[i]::text) = ANY (v_pares_recentes)) THEN
            escolhido := i;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF escolhido = 0 THEN escolhido := 1; END IF;

      b := v_solos[escolhido];  b_guest := v_guest[escolhido];  b_pts := v_pontos[escolhido];
      v_solos  := v_solos[1:escolhido-1]  || v_solos[escolhido+1:];
      v_lados  := v_lados[1:escolhido-1]  || v_lados[escolhido+1:];
      v_guest  := v_guest[1:escolhido-1]  || v_guest[escolhido+1:];
      v_pontos := v_pontos[1:escolhido-1] || v_pontos[escolhido+1:];

      INSERT INTO teams (game_id, player1_id, player1_guest_id, player2_id, player2_guest_id, seed_ranking)
      VALUES (v_game.id,
              CASE WHEN a_guest THEN NULL ELSE a END,
              CASE WHEN a_guest THEN a END,
              CASE WHEN b_guest THEN NULL ELSE b END,
              CASE WHEN b_guest THEN b END,
              CASE WHEN NOT a_guest AND NOT b_guest THEN a_pts + b_pts
                   WHEN NOT a_guest THEN a_pts * 2
                   WHEN NOT b_guest THEN b_pts * 2
                   ELSE 0 END);
      v_duplas := v_duplas + 1;
    END LOOP;

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

-- ── 5. Lookalike (#576) também vê os convidados novos ───────────────────
-- Base: migration_576_convidado_parecido.sql. Sem isto, o aviso «há um
-- convidado parecido contigo» só apanhava as contas fantasma antigas e o
-- duplo-lugar app+WhatsApp voltava com os guests sem conta.
CREATE OR REPLACE FUNCTION public.whatsapp_lookalike_in_game(p_game_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'participant_id', r.participant_id, 'guest_user_id', r.guest_user_id,
           'name', r.name, 'as_partner', r.as_partner) ORDER BY r.name), '[]'::jsonb)
    FROM (
      -- Contas fantasma antigas (legado congelado).
      SELECT p.id AS participant_id, gp.id AS guest_user_id, gp.name,
             COALESCE(p.partner_id = gp.id, FALSE) AS as_partner
        FROM profiles me
        JOIN participants p ON p.game_id = p_game_id AND p.status IN ('confirmed', 'waitlisted')
        JOIN profiles gp ON gp.id IN (p.user_id, p.partner_id)
                        AND gp.email LIKE 'guest-%@whatsapp.alinho.pt' AND gp.id <> me.id
       WHERE me.id = auth.uid()
         AND me.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
         AND names_look_alike(gp.name, me.name)
      UNION ALL
      -- Convidados sem conta (modelo novo).
      SELECT p.id, gg.id, gg.name, COALESCE(p.partner_guest_id = gg.id, FALSE)
        FROM profiles me
        JOIN participants p ON p.game_id = p_game_id AND p.status IN ('confirmed', 'waitlisted')
        JOIN game_guests gg ON gg.id IN (p.guest_id, p.partner_guest_id)
       WHERE me.id = auth.uid()
         AND me.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
         AND names_look_alike(gg.name, me.name)
    ) r;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_lookalike_in_game(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_lookalike_in_game(UUID) TO authenticated;

-- ── 6. Confirmação do número: sem merges, com adoção de inscrições ──────
-- Base: migration_537_confirmar_numero.sql. Duas mudanças:
--   • SAI o loop juntar_convidado (decisão: congelar o legado SEM dreno —
--     a função juntar_convidado fica na BD, mas nada lhe chama).
--   • ENTRA a adoção: inscrições-guest com este número em jogos ainda
--     abertos passam para a conta confirmada (histórico fechado NUNCA
--     migra — sem conta não houve rank, não há nada para juntar).
CREATE OR REPLACE FUNCTION confirm_phone_from_whatsapp(p_phone_hash TEXT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_ver      phone_verifications%ROWTYPE;
  v_nome     TEXT;
  v_hash     TEXT;
  v_adotadas INT := 0;
  n          INT;
  v_result   JSONB;
BEGIN
  SELECT * INTO v_ver FROM phone_verifications
   WHERE phone_hash = p_phone_hash AND code = trim(p_code)
     AND confirmed_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code');
  END IF;

  SELECT p.name, p.phone_hash INTO v_nome, v_hash FROM profiles p WHERE p.id = v_ver.user_id;
  IF v_hash IS DISTINCT FROM p_phone_hash THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'phone_changed');
  END IF;

  UPDATE profiles SET phone_verified_at = now() WHERE id = v_ver.user_id;
  -- Um número confirmado numa conta só: a última a confirmar fica com ele.
  UPDATE profiles SET phone_verified_at = NULL
   WHERE phone_hash = p_phone_hash AND id <> v_ver.user_id AND phone_verified_at IS NOT NULL;

  -- Adoção (jogos abertos/fechados, ainda sem sorteio): a linha-guest com
  -- este número passa a ser desta conta. Se a conta já está inscrita no
  -- mesmo jogo, não se duplica — a linha-guest fica (o admin remove).
  -- Nunca pode travar a confirmação: degrada para WARNING.
  BEGIN
    UPDATE participants p SET user_id = v_ver.user_id, guest_id = NULL
      FROM game_guests gg JOIN games g ON g.id = gg.game_id
     WHERE gg.id = p.guest_id AND gg.phone_hash = p_phone_hash
       AND g.status IN ('open', 'closed')
       AND NOT EXISTS (SELECT 1 FROM participants q
                        WHERE q.game_id = p.game_id
                          AND (q.user_id = v_ver.user_id OR q.partner_id = v_ver.user_id));
    GET DIAGNOSTICS n = ROW_COUNT;
    v_adotadas := v_adotadas + n;

    UPDATE participants p SET partner_id = v_ver.user_id, partner_guest_id = NULL
      FROM game_guests gg JOIN games g ON g.id = gg.game_id
     WHERE gg.id = p.partner_guest_id AND gg.phone_hash = p_phone_hash
       AND g.status IN ('open', 'closed')
       AND p.user_id IS DISTINCT FROM v_ver.user_id
       AND NOT EXISTS (SELECT 1 FROM participants q
                        WHERE q.game_id = p.game_id
                          AND (q.user_id = v_ver.user_id OR q.partner_id = v_ver.user_id));
    GET DIAGNOSTICS n = ROW_COUNT;
    v_adotadas := v_adotadas + n;

    -- Linhas game_guests que ficaram órfãs com a adoção.
    DELETE FROM game_guests gg
     WHERE gg.phone_hash = p_phone_hash
       AND NOT EXISTS (SELECT 1 FROM participants p
                        WHERE p.guest_id = gg.id OR p.partner_guest_id = gg.id)
       AND NOT EXISTS (SELECT 1 FROM teams t
                        WHERE t.player1_guest_id = gg.id OR t.player2_guest_id = gg.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'adoção de inscrições-guest falhou para %: %', v_ver.user_id, SQLERRM;
  END;

  -- 'merged' mantém-se no retorno (sempre 0) para o bot no ar não partir;
  -- o bot novo lê 'adopted'.
  v_result := jsonb_build_object('ok', true, 'name', v_nome,
                                 'merged', 0, 'failed', '[]'::jsonb,
                                 'adopted', v_adotadas);
  UPDATE phone_verifications SET confirmed_at = now(), result = v_result WHERE id = v_ver.id;
  RETURN v_result;
END $f$;

REVOKE ALL ON FUNCTION confirm_phone_from_whatsapp(TEXT, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_phone_from_whatsapp(TEXT, TEXT) TO service_role;

-- ── 7. RPCs para a app criar convidados (sem service-role) ──────────────

-- Admin adiciona um convidado por nome ao mix (AddPlayerSheet).
CREATE OR REPLACE FUNCTION add_game_guest(p_game_id UUID, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_status TEXT;
  v_guest UUID;
BEGIN
  SELECT organization_id, status INTO v_org, v_status FROM games WHERE id = p_game_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF NOT is_org_admin(v_org) THEN RAISE EXCEPTION 'not_admin'; END IF;
  -- in_progress incluído: o AddPlayerSheet também serve o «mix à última da
  -- hora» (#292), antes da ronda 1 — a janela é validada pela UI/refazer.
  IF v_status NOT IN ('open', 'closed', 'in_progress') THEN RAISE EXCEPTION 'mix_already_started'; END IF;

  INSERT INTO game_guests (game_id, name) VALUES (p_game_id, btrim(p_name))
  RETURNING id INTO v_guest;
  INSERT INTO participants (game_id, guest_id, status, joined_alone)
  VALUES (p_game_id, v_guest, 'confirmed', TRUE);
  RETURN v_guest;
END;
$$;
REVOKE ALL ON FUNCTION add_game_guest(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION add_game_guest(UUID, TEXT) TO authenticated;

-- Jogador inscreve-se com um parceiro sem conta (JoinPartnerSheet) —
-- substitui o fluxo partner_invites/claim (#339). O capacity guard
-- continua a valer: auth.uid() é o jogador, não é admin, e o trigger
-- corre por baixo deste INSERT/UPDATE.
CREATE OR REPLACE FUNCTION join_with_guest_partner(p_game_id UUID, p_guest_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_status TEXT;
  v_guest UUID;
  v_row participants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT organization_id, status INTO v_org, v_status FROM games WHERE id = p_game_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'game_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.organization_id = v_org AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_member';
  END IF;
  IF v_status NOT IN ('open', 'closed') THEN RAISE EXCEPTION 'mix_already_started'; END IF;

  INSERT INTO game_guests (game_id, name) VALUES (p_game_id, btrim(p_guest_name))
  RETURNING id INTO v_guest;

  SELECT * INTO v_row FROM participants
   WHERE game_id = p_game_id AND user_id = auth.uid();
  IF v_row.id IS NOT NULL THEN
    IF v_row.partner_id IS NOT NULL OR v_row.partner_guest_id IS NOT NULL THEN
      DELETE FROM game_guests WHERE id = v_guest;
      RAISE EXCEPTION 'already_has_partner';
    END IF;
    UPDATE participants SET partner_guest_id = v_guest, joined_alone = FALSE
     WHERE id = v_row.id;
  ELSE
    INSERT INTO participants (game_id, user_id, partner_guest_id, status, joined_alone)
    VALUES (p_game_id, auth.uid(), v_guest, 'confirmed', FALSE);
  END IF;
  RETURN v_guest;
END;
$$;
REVOKE ALL ON FUNCTION join_with_guest_partner(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION join_with_guest_partner(UUID, TEXT) TO authenticated;

-- ── 8. Grandfathering: quem tem número associado está validado ──────────
-- (Ruben, 1 out: «todos os que têm o número associado são validados; para
-- novos utilizadores há validação antes de o número ser associado».)
-- Inclui as contas fantasma congeladas — é isso que mantém os habitués do
-- WhatsApp a entrar com a identidade e o Elo de sempre; quando a pessoa
-- real confirmar o número, o «uma conta só» acima retira-lho.
UPDATE profiles SET phone_verified_at = TIMEZONE('utc', NOW())
 WHERE phone_hash IS NOT NULL
   AND phone_hash <> 'dev-bypass'
   AND phone_verified_at IS NULL;

-- ── Verificação pós-migração ─────────────────────────────────────────────
-- SELECT to_regclass('public.game_guests');                          -- não-nulo
-- SELECT count(*) FROM profiles WHERE phone_hash IS NOT NULL
--    AND phone_verified_at IS NULL AND phone_hash <> 'dev-bypass';   -- 0
-- INSERT de teste num mix aberto (trocar os UUIDs):
--   SELECT add_game_guest('<game_id>', 'Convidado Teste');
--   ... conferir roster na app e no bot, depois apagar:
--   DELETE FROM participants WHERE game_id = '<game_id>' AND guest_id IS NOT NULL;
