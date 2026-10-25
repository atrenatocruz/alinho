-- ═════════════════════════════════════════════════════════════════════════
-- Conquistas, fase 2: quando, onde e com quem se ganhou cada uma
--
-- PORQUÊ. Aprovado pelo Francisco a 21 out (design-handoff/2026-10-21-
-- conquistas-quando-e-quebra-enguico/REGRAS-BA.md e SPEC-UX.md). Plano em 3
-- fases (okay a 21 out). Esta é a 2: daqui para a frente. A 3 reconstrói as
-- antigas.
--
-- O QUE FAZ
--   · player_achievements ganha: event_kind ('mix' | 'torneio' | 'amigos' |
--     'grupo'), event_id, event_on (o dia do jogo ou do facto), partner_id,
--     partner_name (o nome de um parceiro convidado sem conta), beaten_ids
--     (a dupla vencida, na Quebra Enguiço), context ('jogo' | 'facto' |
--     'antes') e before_on (para as antigas: «Ganha antes de …»).
--   · Um gatilho antes de gravar uma conquista nova preenche isto:
--       - conquistas de jogo (categorias jogo, torneio, elo): o jogo com
--         resultado mais recente de quem a ganhou (é o que completou a
--         condição: a conta corre logo a seguir ao jogo); o parceiro só nas
--         conquistas «com parceiro» (lista da BA, achievement_takes_partner);
--       - as outras (antiguidade, kudos, aulas, xp): só o dia.
--   · As que já existem ficam context = 'antes' e before_on = o dia em que
--     esta migração corre (o do main). A fase 3 reconstrói as que der.
--   · get_player_achievements_v2(p_user_id): o mesmo da get_player_achievements
--     (que fica igual, para a app antiga) e mais o contexto, com a regra de
--     privacidade da BA: o dono vê tudo; os outros veem o evento, o parceiro
--     e a dupla vencida só se o perfil não for privado e a secção de
--     atividade lhes estiver aberta (pública, ou «só amigos» e são amigos).
--     Senão, só a conquista e o dia. O parceiro com perfil privado aparece
--     pelo nome, sem link (partner_linkable = false).
--
-- COMPATIBILIDADE. Só acrescenta (colunas novas com NULL, função nova ao
-- lado). Nenhuma conquista se tira.
--
-- Dev 3, 22 out 2026 · ecrãs: Dev 2 · regras: BA
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. As colunas ───────────────────────────────────────────────────────
ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS event_kind   TEXT;
ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS event_id     UUID;
ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS event_on     DATE;
ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS partner_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS partner_name TEXT;
ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS beaten_ids   UUID[];
ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS context      TEXT;
ALTER TABLE public.player_achievements ADD COLUMN IF NOT EXISTS before_on    DATE;

-- As de antes: «Ganha antes de <hoje>» (o dia do main em que isto corre).
UPDATE public.player_achievements
   SET context = 'antes', before_on = (NOW() AT TIME ZONE 'Europe/Lisbon')::date
 WHERE context IS NULL;

-- ── 2. Com parceiro? (lista da BA, 21 out) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.achievement_takes_partner(p_key TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public
AS $function$
  SELECT p_key IN ('desforra', 'quebra_enguico', 'primeira_rotunda', 'ate_a_porta', 'dupla_de_sempre',
                   'par_perfeito', 'quimica', 'contra_a_corrente', 'nervos_de_aco', 'tie_break',
                   'punto_de_oro', 'golias_abaixo', 'campeao', 'podio', 'invicto_no_torneio',
                   'sobrevivente', 'batismo_de_campo', 'rosca', 'final_four');
$function$;

-- ── 3. O jogo com resultado mais recente de alguém (interna) ────────────
CREATE OR REPLACE FUNCTION public.achievement_latest_game(p_uid UUID, p_at TIMESTAMPTZ)
RETURNS TABLE(kind TEXT, event_id UUID, event_on DATE, partner_id UUID, partner_name TEXT, opp1 UUID, opp2 UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT x.kind, x.event_id, (x.at AT TIME ZONE 'Europe/Lisbon')::date, x.partner_id, x.partner_name, x.opp1, x.opp2
    FROM (
      -- Mix e jogo em aberto: cada jogo com resultado.
      SELECT 'mix'::text AS kind, g.id AS event_id, COALESCE(m.scored_at, m.created_at, g.date) AS at,
             CASE WHEN tm.player1_id = p_uid THEN tm.player2_id ELSE tm.player1_id END AS partner_id,
             (SELECT gg.name FROM game_guests gg
               WHERE gg.id = CASE WHEN tm.player1_id = p_uid THEN tm.player2_guest_id ELSE tm.player1_guest_id END) AS partner_name,
             op.player1_id AS opp1, op.player2_id AS opp2
        FROM teams tm
        JOIN games g ON g.id = tm.game_id AND g.status <> 'cancelled'
        JOIN matches m ON m.game_id = g.id AND tm.id IN (m.team_a_id, m.team_b_id) AND m.winner_team_id IS NOT NULL
        JOIN teams op ON op.id = CASE WHEN m.team_a_id = tm.id THEN m.team_b_id ELSE m.team_a_id END
       WHERE p_uid IN (tm.player1_id, tm.player2_id)
      UNION ALL
      -- Torneio (sem faltas): o evento é o torneio.
      SELECT 'torneio', t.id, COALESCE(tmx.started_at, tmx.scheduled_at, tmx.created_at),
             CASE WHEN me.player1_id = p_uid THEN me.player2_id ELSE me.player1_id END,
             NULL, op.player1_id, op.player2_id
        FROM tournament_entries me
        JOIN tournament_matches tmx ON me.id IN (tmx.entry_a_id, tmx.entry_b_id) AND tmx.status = 'terminado' AND tmx.winner_entry_id IS NOT NULL
        JOIN tournament_categories c ON c.id = tmx.category_id
        JOIN tournaments t ON t.id = c.tournament_id
        LEFT JOIN tournament_entries op ON op.id = CASE WHEN tmx.entry_a_id = me.id THEN tmx.entry_b_id ELSE tmx.entry_a_id END
       WHERE p_uid IN (me.player1_id, me.player2_id)
      UNION ALL
      -- Jogos entre amigos confirmados.
      SELECT 'amigos', pm.id, COALESCE(pm.confirmed_at, pm.played_at),
             CASE WHEN p_uid = pm.team_a_player1_id THEN pm.team_a_player2_id
                  WHEN p_uid = pm.team_a_player2_id THEN pm.team_a_player1_id
                  WHEN p_uid = pm.team_b_player1_id THEN pm.team_b_player2_id ELSE pm.team_b_player1_id END,
             NULL,
             CASE WHEN p_uid IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN pm.team_b_player1_id ELSE pm.team_a_player1_id END,
             CASE WHEN p_uid IN (pm.team_a_player1_id, pm.team_a_player2_id) THEN pm.team_b_player2_id ELSE pm.team_a_player2_id END
        FROM private_matches pm
       WHERE pm.status = 'confirmed' AND NOT COALESCE(pm.is_friend_session, FALSE) AND pm.winner_team IS NOT NULL
         AND p_uid IN (pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id)
      UNION ALL
      -- Jogos de grupo com resultado.
      SELECT 'grupo', gm.id, gm.created_at,
             CASE WHEN p_uid = gm.team_a_player1_id THEN gm.team_a_player2_id
                  WHEN p_uid = gm.team_a_player2_id THEN gm.team_a_player1_id
                  WHEN p_uid = gm.team_b_player1_id THEN gm.team_b_player2_id ELSE gm.team_b_player1_id END,
             NULL,
             CASE WHEN p_uid IN (gm.team_a_player1_id, gm.team_a_player2_id) THEN gm.team_b_player1_id ELSE gm.team_a_player1_id END,
             CASE WHEN p_uid IN (gm.team_a_player1_id, gm.team_a_player2_id) THEN gm.team_b_player2_id ELSE gm.team_a_player2_id END
        FROM group_matches gm
       WHERE gm.winner_team IS NOT NULL
         AND p_uid IN (gm.team_a_player1_id, gm.team_a_player2_id, gm.team_b_player1_id, gm.team_b_player2_id)
    ) x
   WHERE x.at <= p_at + interval '5 minutes'
   ORDER BY x.at DESC
   LIMIT 1;
$function$;

-- ── 4. Preencher ao gravar ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.player_achievements_fill_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cat TEXT;
  g     RECORD;
BEGIN
  IF NEW.context IS NOT NULL THEN RETURN NEW; END IF;   -- já veio preenchido (fase 3)
  BEGIN
    SELECT category INTO v_cat FROM achievements WHERE key = NEW.achievement_key;
    IF v_cat IN ('jogo', 'torneio', 'elo') THEN
      SELECT * INTO g FROM achievement_latest_game(NEW.user_id, COALESCE(NEW.awarded_at, NOW()));
      IF g.kind IS NOT NULL THEN
        NEW.context := 'jogo';
        NEW.event_kind := g.kind;
        NEW.event_id := g.event_id;
        NEW.event_on := g.event_on;
        IF achievement_takes_partner(NEW.achievement_key) THEN
          NEW.partner_id := g.partner_id;
          NEW.partner_name := CASE WHEN g.partner_id IS NULL THEN g.partner_name END;
        END IF;
        IF NEW.achievement_key = 'quebra_enguico' AND g.opp1 IS NOT NULL AND g.opp2 IS NOT NULL THEN
          NEW.beaten_ids := ARRAY[g.opp1, g.opp2];
        END IF;
        RETURN NEW;
      END IF;
    END IF;
    NEW.context := 'facto';
    NEW.event_on := (COALESCE(NEW.awarded_at, NOW()) AT TIME ZONE 'Europe/Lisbon')::date;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca impede a conquista de ser dada.
    NEW.context := 'facto';
    NEW.event_on := (COALESCE(NEW.awarded_at, NOW()) AT TIME ZONE 'Europe/Lisbon')::date;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS player_achievements_fill_context ON public.player_achievements;
CREATE TRIGGER player_achievements_fill_context
  BEFORE INSERT ON public.player_achievements
  FOR EACH ROW EXECUTE FUNCTION public.player_achievements_fill_context();

REVOKE ALL ON FUNCTION public.achievement_takes_partner(TEXT), public.achievement_latest_game(UUID, TIMESTAMPTZ),
  public.player_achievements_fill_context() FROM PUBLIC, anon, authenticated;

-- ── 5. Para o ecrã, com a privacidade ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_player_achievements_v2(p_user_id UUID)
RETURNS TABLE(achievement_key TEXT, category TEXT, rarity TEXT, awarded_at TIMESTAMPTZ, rarity_pct NUMERIC,
              context TEXT, event_on DATE, before_on DATE,
              event_kind TEXT, event_id UUID, event_title TEXT,
              partner_id UUID, partner_name TEXT, partner_linkable BOOLEAN, beaten JSONB)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_show BOOLEAN;
BEGIN
  SELECT auth.uid() = p.id
         OR (NOT COALESCE(p.is_private, FALSE) AND can_view_section(p.id, COALESCE(p.activity_visibility, 'public')))
    INTO v_show
    FROM profiles p WHERE p.id = p_user_id;
  v_show := COALESCE(v_show, FALSE);
  RETURN QUERY
    WITH active_players AS (SELECT COUNT(*) AS n FROM profiles WHERE rating IS NOT NULL)
    SELECT pa.achievement_key, a.category, a.rarity, pa.awarded_at,
           ROUND(100.0 * (SELECT COUNT(*) FROM player_achievements x
                          JOIN profiles px ON px.id = x.user_id AND px.rating IS NOT NULL
                          WHERE x.achievement_key = pa.achievement_key)
                 / GREATEST((SELECT n FROM active_players), 1), 1),
           pa.context, pa.event_on, pa.before_on,
           CASE WHEN v_show THEN pa.event_kind END,
           CASE WHEN v_show THEN pa.event_id END,
           CASE WHEN v_show THEN
             CASE pa.event_kind WHEN 'mix' THEN (SELECT g.title FROM games g WHERE g.id = pa.event_id)
                                WHEN 'torneio' THEN (SELECT t.name FROM tournaments t WHERE t.id = pa.event_id) END
           END,
           CASE WHEN v_show THEN pa.partner_id END,
           CASE WHEN v_show THEN COALESCE((SELECT pp.name FROM profiles pp WHERE pp.id = pa.partner_id), pa.partner_name) END,
           CASE WHEN v_show AND pa.partner_id IS NOT NULL
                THEN NOT COALESCE((SELECT pp.is_private FROM profiles pp WHERE pp.id = pa.partner_id), FALSE) END,
           CASE WHEN v_show AND pa.beaten_ids IS NOT NULL THEN
             (SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'linkable', NOT COALESCE(b.is_private, FALSE)))
                FROM profiles b WHERE b.id = ANY(pa.beaten_ids))
           END
      FROM player_achievements pa
      JOIN achievements a ON a.key = pa.achievement_key AND a.active
     WHERE pa.user_id = p_user_id
     ORDER BY pa.awarded_at DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_player_achievements_v2(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_player_achievements_v2(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM player_achievements WHERE context IS NULL;                         -- 0
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'player_achievements_fill_context';       -- 1
--   SELECT has_function_privilege('anon', 'public.get_player_achievements_v2(uuid)', 'EXECUTE');  -- false
