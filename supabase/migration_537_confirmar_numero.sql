-- ════════════════════════════════════════════════════════════════════════
-- Migration: confirmar o número pelo WhatsApp e juntar o convidado do bot
-- à conta registada (Trello #537, pontos 1 e 2)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
--
-- ORDEM: DEPOIS do supabase/fix_537_contas_do_whatsapp.sql (Dev 3) ter
-- corrido pelo menos a PARTE 2 (o esquema arquivo_537). Este ficheiro volta
-- a criar esse esquema só se não existir, com as mesmas funções.
--
-- O QUE FAZ
--  1. A app pede um código (start_phone_verification): 6 números, válidos
--     15 minutos, ligados ao telemóvel que a pessoa tem no perfil.
--  2. A pessoa manda esse código ao bot, por WhatsApp, a partir do próprio
--     telemóvel. O bot vê de que número veio e chama
--     confirm_phone_from_whatsapp(hash do número, código). Só o bot a pode
--     chamar (service_role): nenhuma conta da app a vê.
--  3. Se o número de onde veio a mensagem é o do perfil e o código bate:
--     o número fica confirmado (profiles.phone_verified_at) e cada convidado
--     do bot com esse número é junto à conta (juntar_convidado).
--
-- SEGURANÇA: sem número confirmado, nada passa de uma conta para outra.
-- Escrever o número de outra pessoa no perfil não chega: o código tem de
-- chegar ao bot VINDO desse número.
--
-- JUNTAR (juntar_convidado): a mesma lógica do caso A do Dev 3, feita
-- função, com as lições de produção dele:
--  · tudo o que aponta para o convidado (descoberto pelas chaves estrangeiras
--    vivas, não por uma lista) passa para a registada; recusa se as duas
--    contas chocarem (ex.: as duas no mesmo jogo) em vez de escolher;
--  · os números do clube (player_stats) somam-se; recusa se a tabela tiver
--    colunas que isto não conhece;
--  · o nível: a registada fica com o seu nível mais o que o convidado ganhou
--    ou perdeu, e os jogos somam-se; o CONVIDADO VOLTA ao nível de partida
--    com 0 jogos — os pontos passam de uma conta para a outra, a soma de
--    todos os níveis não muda (#440, soma zero; combinado com o Dev 3);
--  · o participant_events_trigger desliga-se só enquanto se mexe em
--    participants (senão escrevia «parceiro adicionado» falso);
--  · o convidado nunca é apagado: fica sem telemóvel, «(juntado)» no nome e
--    escondido das listas e do ranking (is_test, como as contas de teste);
--  · tudo fica copiado em arquivo_537.alteracoes com caso 'auto-<convidado>'
--    e desfaz-se com SELECT arquivo_537.desfazer('auto-<id do convidado>').
-- Se juntar falhar, o número fica confirmado na mesma e a falha fica escrita
-- em phone_verifications.result, para se ver à mão.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Número confirmado ────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS phone_verifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_hash    TEXT        NOT NULL,
  code          TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  confirmed_at  TIMESTAMPTZ,
  result        JSONB
);
CREATE INDEX IF NOT EXISTS phone_verifications_lookup ON phone_verifications (phone_hash, code) WHERE confirmed_at IS NULL;
ALTER TABLE phone_verifications ENABLE ROW LEVEL SECURITY;

-- Cada um vê só os seus pedidos (para a app mostrar o código e o resultado).
-- Ninguém escreve diretamente: só pelas duas funções abaixo.
DROP POLICY IF EXISTS "Own phone verifications" ON phone_verifications;
CREATE POLICY "Own phone verifications" ON phone_verifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON phone_verifications FROM anon, authenticated;

-- ── 2. O sítio da cópia (igual ao do Dev 3; só cria se faltar) ──────────
CREATE SCHEMA IF NOT EXISTS arquivo_537;
REVOKE ALL ON SCHEMA arquivo_537 FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS arquivo_537.alteracoes (
  id           BIGSERIAL PRIMARY KEY,
  caso         TEXT        NOT NULL,
  tipo         TEXT        NOT NULL CHECK (tipo IN ('alterada', 'inserida')),
  tabela       TEXT        NOT NULL,
  chave        JSONB       NOT NULL,
  colunas      TEXT[],
  antes        JSONB,
  nota         TEXT,
  feito_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  desfeito_em  TIMESTAMPTZ
);
REVOKE ALL ON ALL TABLES    IN SCHEMA arquivo_537 FROM public, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA arquivo_537 FROM public, anon, authenticated;

DO $cria_guardar$
BEGIN
  IF to_regprocedure('arquivo_537.guardar(text, regclass, text, jsonb, text)') IS NULL THEN
    EXECUTE $def$
      CREATE FUNCTION arquivo_537.guardar(
        p_caso TEXT, p_tabela REGCLASS, p_onde TEXT, p_novos JSONB, p_nota TEXT)
      RETURNS INTEGER
      LANGUAGE plpgsql AS $f$
      DECLARE
        v_pk TEXT[];
        v_n  INTEGER;
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s r WHERE %s', p_tabela, p_onde) INTO v_n;
        IF v_n = 0 THEN
          RETURN 0;
        END IF;
        SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_pk
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
         WHERE i.indrelid = p_tabela AND i.indisprimary;
        IF v_pk IS NULL THEN
          RAISE EXCEPTION '% não tem chave primária — não sei guardar a cópia. Parar e ler.', p_tabela;
        END IF;
        EXECUTE format(
          'INSERT INTO arquivo_537.alteracoes (caso, tipo, tabela, chave, colunas, antes, nota)
           SELECT $1, ''alterada'', $2,
                  (SELECT jsonb_object_agg(k, (to_jsonb(r) || $3) -> k) FROM unnest($4) k),
                  (SELECT array_agg(k) FROM jsonb_object_keys($3) k),
                  to_jsonb(r), $5
             FROM %s r WHERE %s', p_tabela, p_onde)
          USING p_caso, p_tabela::text, p_novos, v_pk, p_nota;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        RETURN v_n;
      END $f$;
    $def$;
    REVOKE ALL ON FUNCTION arquivo_537.guardar(TEXT, REGCLASS, TEXT, JSONB, TEXT) FROM public, anon, authenticated;
  END IF;
  -- desfazer: se faltar, o System Integrator corre a PARTE 2 do ficheiro do
  -- Dev 3 (é lá que ela vive). Sem ela não se desfaz, mas junta-se na mesma.
END
$cria_guardar$;

-- ── 3. Juntar um convidado do bot a uma conta registada ─────────────────
CREATE OR REPLACE FUNCTION juntar_convidado(p_convidado UUID, p_registada UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  c_caso       CONSTANT TEXT   := 'auto-' || p_convidado::text;
  c_stats_cols CONSTANT TEXT[] := ARRAY['id','user_id','organization_id','game_wins','game_losses',
                                        'mix_wins','mixes_played','total_points','updated_at'];
  v_de     profiles%ROWTYPE;
  v_para   profiles%ROWTYPE;
  f        RECORD;
  u        RECORD;
  s        RECORD;
  mb       RECORD;
  t        player_stats%ROWTYPE;
  v_n      INTEGER;
  v_conf   INTEGER;
  v_join   TEXT;
  v_delta  NUMERIC;
  v_novo   UUID;
  v_trig   BOOLEAN;
  v_resumo TEXT := '';
BEGIN
  IF EXISTS (SELECT 1 FROM arquivo_537.alteracoes WHERE caso = c_caso AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'Este convidado já foi junto (%).', c_caso;
  END IF;
  SELECT * INTO v_de   FROM profiles WHERE id = p_convidado;
  SELECT * INTO v_para FROM profiles WHERE id = p_registada;
  IF v_de.id IS NULL OR v_para.id IS NULL THEN
    RAISE EXCEPTION 'Não encontrei uma das contas.';
  END IF;
  IF v_de.email NOT LIKE 'guest-%@whatsapp.alinho.pt' THEN
    RAISE EXCEPTION 'A primeira conta não é um convidado do bot.';
  END IF;
  IF v_para.email LIKE 'guest-%@whatsapp.alinho.pt' THEN
    RAISE EXCEPTION 'A conta de destino também é um convidado do bot.';
  END IF;
  -- A regra de segurança: só com o número CONFIRMADO, e o mesmo nas duas.
  IF v_para.phone_verified_at IS NULL THEN
    RAISE EXCEPTION 'A conta registada não tem o número confirmado — nada passa.';
  END IF;
  IF v_de.phone_hash IS DISTINCT FROM v_para.phone_hash THEN
    RAISE EXCEPTION 'As duas contas não têm o mesmo telemóvel — nada passa.';
  END IF;
  IF (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'player_stats')
     IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(c_stats_cols) c) THEN
    RAISE EXCEPTION 'player_stats tem colunas que esta função não conhece — parar e ler.';
  END IF;

  v_trig := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.participants'::regclass
                     AND tgname = 'participant_events_trigger' AND tgenabled <> 'D');

  -- ── a) Tudo o que aponta para o convidado passa para a registada ──────
  FOR f IN
    SELECT c.conrelid::regclass AS tabela, a.attname AS coluna, a.attnum
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f'
       AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
       AND c.connamespace = 'public'::regnamespace
       AND c.conrelid NOT IN ('public.profiles'::regclass,
                              'public.memberships'::regclass,
                              'public.player_stats'::regclass,
                              'public.phone_verifications'::regclass)
     ORDER BY 1, 2
  LOOP
    FOR u IN SELECT con.conkey FROM pg_constraint con
              WHERE con.conrelid = f.tabela AND con.contype IN ('u', 'p')
                AND f.attnum = ANY (con.conkey) LOOP
      SELECT string_agg(format('r1.%1$I IS NOT DISTINCT FROM r2.%1$I', a.attname), ' AND ')
        INTO v_join
        FROM pg_attribute a
       WHERE a.attrelid = f.tabela AND a.attnum = ANY (u.conkey) AND a.attnum <> f.attnum;
      EXECUTE format('SELECT count(*) FROM %s r1 JOIN %s r2 ON %s WHERE r1.%I = $1 AND r2.%I = $2',
                     f.tabela, f.tabela, COALESCE(v_join, 'TRUE'), f.coluna, f.coluna)
        INTO v_conf USING p_convidado, p_registada;
      IF v_conf > 0 THEN
        RAISE EXCEPTION 'As duas contas têm % linha(s) que chocam em %.% (ex.: as duas no mesmo jogo). Não escolho — ver à mão.',
          v_conf, f.tabela, f.coluna;
      END IF;
    END LOOP;

    v_n := arquivo_537.guardar(c_caso, f.tabela, format('%I = %L', f.coluna, p_convidado),
                               jsonb_build_object(f.coluna, p_registada),
                               'passa do convidado para a conta registada');
    IF v_n > 0 THEN
      IF v_trig AND f.tabela = 'public.participants'::regclass THEN
        ALTER TABLE public.participants DISABLE TRIGGER participant_events_trigger;
      END IF;
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', f.tabela, f.coluna, f.coluna)
        USING p_registada, p_convidado;
      IF v_trig AND f.tabela = 'public.participants'::regclass THEN
        ALTER TABLE public.participants ENABLE TRIGGER participant_events_trigger;
      END IF;
      v_resumo := v_resumo || format('%s.%s: %s; ', f.tabela, f.coluna, v_n);
    END IF;
  END LOOP;

  -- ── b) Números do clube: somam-se ─────────────────────────────────────
  FOR s IN SELECT * FROM player_stats WHERE user_id = p_convidado LOOP
    t := NULL;
    SELECT * INTO t FROM player_stats
     WHERE user_id = p_registada AND organization_id = s.organization_id;
    IF t.id IS NULL THEN
      PERFORM arquivo_537.guardar(c_caso, 'public.player_stats', format('id = %L', s.id),
                                  jsonb_build_object('user_id', p_registada), 'números do clube passam');
      UPDATE player_stats SET user_id = p_registada WHERE id = s.id;
    ELSE
      PERFORM arquivo_537.guardar(c_caso, 'public.player_stats', format('id = %L', t.id),
        jsonb_build_object('game_wins',    t.game_wins    + s.game_wins,
                           'game_losses',  t.game_losses  + s.game_losses,
                           'mix_wins',     t.mix_wins     + s.mix_wins,
                           'mixes_played', t.mixes_played + s.mixes_played,
                           'total_points', t.total_points + s.total_points,
                           'updated_at',   now()),
        'somam-se os números do convidado');
      UPDATE player_stats
         SET game_wins    = t.game_wins    + s.game_wins,
             game_losses  = t.game_losses  + s.game_losses,
             mix_wins     = t.mix_wins     + s.mix_wins,
             mixes_played = t.mixes_played + s.mixes_played,
             total_points = t.total_points + s.total_points,
             updated_at   = now()
       WHERE id = t.id;
      PERFORM arquivo_537.guardar(c_caso, 'public.player_stats', format('id = %L', s.id),
        jsonb_build_object('game_wins', 0, 'game_losses', 0, 'mix_wins', 0,
                           'mixes_played', 0, 'total_points', 0, 'updated_at', now()),
        'o convidado fica a zero (passou para a registada)');
      UPDATE player_stats
         SET game_wins = 0, game_losses = 0, mix_wins = 0, mixes_played = 0,
             total_points = 0, updated_at = now()
       WHERE id = s.id;
    END IF;
    v_resumo := v_resumo || format('player_stats: +%s mixes; ', s.mixes_played);
  END LOOP;

  -- ── c) Clubes: a registada passa a membro; o convidado fica escondido ──
  FOR mb IN SELECT * FROM memberships WHERE user_id = p_convidado LOOP
    IF NOT EXISTS (SELECT 1 FROM memberships
                    WHERE user_id = p_registada AND organization_id = mb.organization_id) THEN
      INSERT INTO memberships (user_id, organization_id, is_admin, is_guest, level)
      VALUES (p_registada, mb.organization_id, false, false, mb.level)
      RETURNING id INTO v_novo;
      INSERT INTO arquivo_537.alteracoes (caso, tipo, tabela, chave, nota)
      VALUES (c_caso, 'inserida', 'public.memberships', jsonb_build_object('id', v_novo),
              'a registada passa a membro do clube do convidado');
    END IF;
    PERFORM arquivo_537.guardar(c_caso, 'public.memberships', format('id = %L', mb.id),
                                jsonb_build_object('is_test', true),
                                'convidado escondido das listas e do ranking');
    UPDATE memberships SET is_test = true WHERE id = mb.id;
  END LOOP;

  -- ── d) Nível e telemóvel ──────────────────────────────────────────────
  v_delta := CASE WHEN COALESCE(v_de.rating_games, 0) = 0 OR v_de.rating IS NULL THEN 0
                  ELSE v_de.rating - COALESCE(v_de.rating_anchor, 900) END;

  PERFORM arquivo_537.guardar(c_caso, 'public.profiles', format('id = %L', p_registada),
    jsonb_build_object(
      'whatsapp_jid',        COALESCE(v_para.whatsapp_jid, v_de.whatsapp_jid),
      'rating',              CASE WHEN v_para.rating IS NULL THEN v_de.rating ELSE v_para.rating + v_delta END,
      'rating_anchor',       COALESCE(v_para.rating_anchor, v_de.rating_anchor),
      'rating_games',        COALESCE(v_para.rating_games, 0) + COALESCE(v_de.rating_games, 0),
      'rating_onboarded_at', COALESCE(v_para.rating_onboarded_at, v_de.rating_onboarded_at)),
    'recebe o que o convidado jogou');
  UPDATE profiles
     SET whatsapp_jid        = COALESCE(v_para.whatsapp_jid, v_de.whatsapp_jid),
         rating              = CASE WHEN v_para.rating IS NULL THEN v_de.rating ELSE v_para.rating + v_delta END,
         rating_anchor       = COALESCE(v_para.rating_anchor, v_de.rating_anchor),
         rating_games        = COALESCE(v_para.rating_games, 0) + COALESCE(v_de.rating_games, 0),
         rating_onboarded_at = COALESCE(v_para.rating_onboarded_at, v_de.rating_onboarded_at)
   WHERE id = p_registada;

  -- O convidado volta ao nível de partida, com 0 jogos: os pontos PASSARAM,
  -- não ficam nas duas contas (soma zero, #440).
  PERFORM arquivo_537.guardar(c_caso, 'public.profiles', format('id = %L', p_convidado),
    jsonb_build_object('phone_hash', NULL, 'whatsapp_jid', NULL,
                       'name', v_de.name || ' (juntado)',
                       'rating', COALESCE(v_de.rating_anchor, 900), 'rating_games', 0),
    'o convidado fica sem telemóvel, marcado e no nível de partida');
  UPDATE profiles
     SET phone_hash = NULL, whatsapp_jid = NULL, name = v_de.name || ' (juntado)',
         rating = COALESCE(v_de.rating_anchor, 900), rating_games = 0
   WHERE id = p_convidado;

  RETURN format('Juntado %s → %s. %s nível %s → %s.', p_convidado, p_registada, v_resumo,
    round(v_para.rating), round(CASE WHEN v_para.rating IS NULL THEN v_de.rating ELSE v_para.rating + v_delta END));
END $f$;

REVOKE ALL ON FUNCTION juntar_convidado(UUID, UUID) FROM public, anon, authenticated;

-- ── 4. A app pede o código ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION start_phone_verification()
RETURNS TABLE (code TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_hash TEXT;
  v_code TEXT;
  v_exp  TIMESTAMPTZ := now() + interval '15 minutes';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sem sessão.';
  END IF;
  SELECT p.phone_hash INTO v_hash FROM profiles p WHERE p.id = auth.uid();
  IF v_hash IS NULL OR v_hash = 'dev-bypass' THEN
    RAISE EXCEPTION 'Primeiro guarda o teu telemóvel no perfil.';
  END IF;
  -- Nada de pedir códigos sem fim: 5 por hora chegam.
  IF (SELECT count(*) FROM phone_verifications pv
       WHERE pv.user_id = auth.uid() AND pv.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Pediste muitos códigos. Espera um pouco e tenta outra vez.';
  END IF;
  -- Um código aberto de cada vez: os anteriores deixam de valer.
  UPDATE phone_verifications pv SET expires_at = now()
   WHERE pv.user_id = auth.uid() AND pv.confirmed_at IS NULL AND pv.expires_at > now();

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO phone_verifications (user_id, phone_hash, code, expires_at)
  VALUES (auth.uid(), v_hash, v_code, v_exp);
  RETURN QUERY SELECT v_code, v_exp;
END $f$;

REVOKE ALL ON FUNCTION start_phone_verification() FROM public, anon;
GRANT EXECUTE ON FUNCTION start_phone_verification() TO authenticated;

-- ── 5. O bot confirma (só o bot: service_role) ──────────────────────────
CREATE OR REPLACE FUNCTION confirm_phone_from_whatsapp(p_phone_hash TEXT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_ver     phone_verifications%ROWTYPE;
  v_nome    TEXT;
  v_hash    TEXT;
  g         RECORD;
  v_juntos  INT := 0;
  v_falhas  JSONB := '[]'::jsonb;
  v_msg     TEXT;
  v_result  JSONB;
BEGIN
  SELECT * INTO v_ver FROM phone_verifications
   WHERE phone_hash = p_phone_hash AND code = trim(p_code)
     AND confirmed_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'code');
  END IF;

  SELECT p.name, p.phone_hash INTO v_nome, v_hash FROM profiles p WHERE p.id = v_ver.user_id;
  -- O telemóvel do perfil mudou depois de pedir o código: não vale.
  IF v_hash IS DISTINCT FROM p_phone_hash THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'phone_changed');
  END IF;

  UPDATE profiles SET phone_verified_at = now() WHERE id = v_ver.user_id;
  -- Um número confirmado numa conta só: a última a confirmar fica com ele.
  UPDATE profiles SET phone_verified_at = NULL
   WHERE phone_hash = p_phone_hash AND id <> v_ver.user_id AND phone_verified_at IS NOT NULL;

  -- Cada convidado do bot com este número passa para esta conta. Uma falha
  -- num não impede o número de ficar confirmado nem os outros de passar.
  FOR g IN SELECT p.id FROM profiles p
            WHERE p.phone_hash = p_phone_hash AND p.id <> v_ver.user_id
              AND p.email LIKE 'guest-%@whatsapp.alinho.pt' LOOP
    BEGIN
      v_msg := juntar_convidado(g.id, v_ver.user_id);
      v_juntos := v_juntos + 1;
    EXCEPTION WHEN others THEN
      v_falhas := v_falhas || jsonb_build_object('convidado', g.id, 'erro', SQLERRM);
    END;
  END LOOP;

  v_result := jsonb_build_object('ok', true, 'name', v_nome, 'merged', v_juntos, 'failed', v_falhas);
  UPDATE phone_verifications SET confirmed_at = now(), result = v_result WHERE id = v_ver.id;
  RETURN v_result;
END $f$;

REVOKE ALL ON FUNCTION confirm_phone_from_whatsapp(TEXT, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_phone_from_whatsapp(TEXT, TEXT) TO service_role;

COMMIT;
