-- ════════════════════════════════════════════════════════════════════════
-- CONVIDADOS SÓ PARA AQUELE JOGO (Renato, 8 out 2026)
--
-- PORQUÊ. Quem entra sem conta é convidado de UM jogo, não uma conta à
-- espera de dono. Antes, cada «In com João Miguel» sem conta fabricava uma
-- conta nova (guest-*@whatsapp.alinho.pt, ou a conta «por reclamar» do
-- #339) — semana após semana, a mesma pessoa em várias contas, e o robô a
-- responder «Há mais do que uma pessoa com Guilherme Ameixa». Desde
-- migration_mix_guest_sem_conta.sql (Ruben, 30 set) já não se criam contas:
-- o convidado é uma linha em game_guests, presa a um jogo. Falta:
--
--   1. No fim, o convidado fica só com o NOME (para o histórico do jogo):
--      número e WhatsApp apagados. Não se apaga a linha — participants e
--      teams apontam para ela em cascata e o jogo ficava com buracos.
--      O mesmo para os emails de convidados nos torneios e nos jogos entre
--      amigos, e os links de convite («fica com o lugar») desses jogos
--      deixam de valer depois de acabarem.
--      Corre num cron diário, 2 dias depois do jogo — o aviso do voucher do
--      robô (voucherNotices.js) ainda menciona o convidado pelo WhatsApp
--      logo a seguir ao fim, por isso não pode ser no próprio momento.
--
--   2. As contas-convidado antigas (guest-*@whatsapp.alinho.pt e as «por
--      reclamar» sem-conta+*@invalid.alinho.pt / claim_pending) que não
--      estão em jogo nenhum: apagadas. As que têm jogos ficam (sustentam os
--      pontos de quem jogou com elas), mas «limpas»: sem número nem
--      WhatsApp — o robô deixa de as usar como identidade de quem escreve
--      «In» (passa a ser convidado do jogo, como toda a gente sem conta).
--      Quem está agora num jogo por acabar fica como está até ao jogo
--      acabar (o «Out» precisa do número); o cron apanha-as depois.
--
-- PRÉ-VISUALIZAR antes de correr (só lê):
--   SELECT count(*) FILTER (WHERE NOT convidado_antigo_tem_historico(id)) AS a_apagar,
--          count(*) FILTER (WHERE convidado_antigo_tem_historico(id))     AS a_limpar
--     FROM profiles WHERE e_convidado_antigo(email, claim_pending);
--   (as duas funções são criadas na secção 2 — correr a secção 2 primeiro
--   se quiser ver os números antes do resto; criar funções não apaga nada.)
--
-- CORRER PRIMEIRO: migration_mix_guest_sem_conta.sql (game_guests,
-- teams.player*_guest_id), migration_partner_without_account.sql
-- (claim_pending), migration_tournament_entries_sem_conta.sql,
-- migration_friend_match_invitees.sql, migration_cancel_stale_mixes.sql
-- (pg_cron). Pode-se correr mais do que uma vez.
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.game_guests') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'teams' AND column_name = 'player1_guest_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'profiles' AND column_name = 'claim_pending')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'tournament_entries' AND column_name = 'guest1_email')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'tournament_entries' AND column_name = 'guest_phone_hash')
     OR to_regclass('public.private_match_invitees') IS NULL THEN
    RAISE EXCEPTION 'Faltam migrações anteriores (ver CORRER PRIMEIRO no topo deste ficheiro).';
  END IF;
END $$;

-- ── 1. No fim do jogo, o convidado fica só com o nome ───────────────────
CREATE OR REPLACE FUNCTION limpar_convidados_de_jogos_acabados()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mixes: dois dias depois da data. Um mix por fechar a essa altura já foi
  -- cancelado pelo cancel_stale_open_mixes (24 h), por isso a data chega.
  UPDATE game_guests gg
     SET phone_hash = NULL, whatsapp_jid = NULL
    FROM games g
   WHERE g.id = gg.game_id
     AND g.date < now() - interval '2 days'
     AND (gg.phone_hash IS NOT NULL OR gg.whatsapp_jid IS NOT NULL);

  -- Torneios: dois dias depois do último dia. Emails dos convidados fora, e
  -- os links «fica com o lugar» deixam de valer.
  UPDATE tournament_entries e
     SET guest_email = NULL, guest1_email = NULL, guest_phone_hash = NULL,
         invite_token = NULL, invite_token_player1 = NULL
    FROM tournament_categories c
    JOIN tournaments t ON t.id = c.tournament_id
   WHERE c.id = e.category_id
     AND t.ends_on < current_date - 2
     AND (e.guest_email IS NOT NULL OR e.guest1_email IS NOT NULL OR e.guest_phone_hash IS NOT NULL
          OR e.invite_token IS NOT NULL OR e.invite_token_player1 IS NOT NULL);

  -- Jogos entre amigos: o mesmo, dois dias depois de jogado.
  UPDATE private_match_invitees i
     SET guest_email = NULL, invite_token = NULL
    FROM private_matches m
   WHERE m.id = i.match_id
     AND m.played_at < now() - interval '2 days'
     AND i.guest_name IS NOT NULL
     AND (i.guest_email IS NOT NULL OR i.invite_token IS NOT NULL);

  -- Contas-convidado antigas com histórico (secção 2): ficam sem número nem
  -- WhatsApp quando já não estão em nenhum jogo por acabar.
  UPDATE profiles p
     SET phone_hash = NULL, whatsapp_jid = NULL, phone_verified_at = NULL
   WHERE e_convidado_antigo(p.email, p.claim_pending)
     AND (p.phone_hash IS NOT NULL OR p.whatsapp_jid IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM participants pa JOIN games g ON g.id = pa.game_id
                      WHERE (pa.user_id = p.id OR pa.partner_id = p.id)
                        AND g.date >= now() - interval '2 days');
END;
$$;

-- ── 2. Contas-convidado antigas ─────────────────────────────────────────
-- Os emails inventados com que se criavam: o robô (createGuestProfile, já
-- não existe) e a edge function join-with-named-partner (#339).
CREATE OR REPLACE FUNCTION e_convidado_antigo(p_email TEXT, p_claim_pending BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(p_claim_pending, false)
      OR coalesce(p_email, '') ~ '^guest-.*@whatsapp\.alinho\.pt$'
      OR coalesce(p_email, '') ~ '^sem-conta\+.*@invalid\.alinho\.pt$';
$$;

-- Jogou ou está inscrito em alguma coisa? (mix, torneio, jogo entre amigos,
-- voucher). Tudo o que ligue a pessoa a um resultado de outra.
CREATE OR REPLACE FUNCTION convidado_antigo_tem_historico(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM participants WHERE user_id = p_id OR partner_id = p_id)
      OR EXISTS (SELECT 1 FROM teams WHERE player1_id = p_id OR player2_id = p_id)
      OR EXISTS (SELECT 1 FROM mix_player_stats WHERE user_id = p_id)
      OR EXISTS (SELECT 1 FROM player_stats WHERE user_id = p_id)
      OR EXISTS (SELECT 1 FROM tournament_entries WHERE player1_id = p_id OR player2_id = p_id)
      OR EXISTS (SELECT 1 FROM private_matches
                  WHERE p_id IN (team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id))
      OR EXISTS (SELECT 1 FROM private_match_invitees WHERE user_id = p_id)
      OR EXISTS (SELECT 1 FROM vouchers WHERE user_id = p_id);
$$;

REVOKE ALL ON FUNCTION limpar_convidados_de_jogos_acabados() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION convidado_antigo_tem_historico(UUID) FROM public, anon, authenticated;

-- Sem histórico: apagar (auth.users → profiles → memberships, kudos, etc.
-- em cascata). Uma a uma, cada uma no seu bloco: se alguma tabela que não
-- está na lista acima ainda lhe aponta (ON DELETE NO ACTION), a base de
-- dados recusa só essa — e essa fica limpa em vez de apagada.
DO $$
DECLARE
  r RECORD;
  v_apagadas INT := 0;
  v_limpas   INT := 0;
BEGIN
  FOR r IN SELECT id FROM profiles
            WHERE e_convidado_antigo(email, claim_pending)
              AND NOT convidado_antigo_tem_historico(id)
  LOOP
    BEGIN
      DELETE FROM auth.users WHERE id = r.id;
      v_apagadas := v_apagadas + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE profiles SET phone_hash = NULL, whatsapp_jid = NULL, phone_verified_at = NULL
       WHERE id = r.id;
      v_limpas := v_limpas + 1;
    END;
  END LOOP;
  RAISE NOTICE 'Contas-convidado sem jogos: % apagadas, % só limpas (presas por outra tabela).',
    v_apagadas, v_limpas;
END $$;

-- Com histórico (e já sem jogos por acabar): limpas agora, e o cron
-- apanha as restantes. Os jogos acabados também ficam limpos já.
SELECT limpar_convidados_de_jogos_acabados();

-- ── 3. Todos os dias ────────────────────────────────────────────────────
-- cron.schedule atualiza o job se já existir: re-correr é seguro.
SELECT cron.schedule(
  'limpar-convidados',
  '30 6 * * *',
  $$SELECT limpar_convidados_de_jogos_acabados()$$
);
