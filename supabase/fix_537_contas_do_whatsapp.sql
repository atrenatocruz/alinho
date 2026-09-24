-- ═════════════════════════════════════════════════════════════════════════
-- ARRUMAR À MÃO OS DOIS CASOS DO WHATSAPP (#537)
-- (Dev 3, 24 set 2026) — cartão «#537 — Convidado do WhatsApp perde o
-- histórico ao registar-se, e o bot cria convidados a mais».
--
-- Não é uma migração: não muda nenhuma função nem tabela da app. Mexe em
-- DUAS pessoas, e só com os ids escritos à mão no topo de cada caso.
--
-- Quem corre: o System Integrator, com o «corre» do Francisco dado
-- diretamente. Correr POR PARTES, pela ordem, e parar se alguma recusar.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO O BOT ENCONTRA UMA PESSOA (é isto que se está a arrumar)
-- ─────────────────────────────────────────────────────────────────────────
-- `resolveProfileByPhoneJid` (whatsapp-bot/src/phone.js) procura, entre os
-- membros do clube do grupo, a conta com o mesmo `profiles.phone_hash`, e
-- espera UMA. Com zero, cria um convidado. Com duas, dá erro, trata a pessoa
-- como desconhecida — e cria um convidado. Depois de arrumar, cada clube
-- destas pessoas tem de ter exatamente UMA conta com aquele telemóvel.
--
-- ─────────────────────────────────────────────────────────────────────────
-- AS REGRAS
-- ─────────────────────────────────────────────────────────────────────────
--  · Não se apaga nenhuma conta nem nenhum jogo.
--  · Antes de mudar uma linha, a linha inteira fica copiada em
--    `arquivo_537.alteracoes`. `SELECT arquivo_537.desfazer('A')` (ou 'B')
--    põe tudo como estava.
--  · Cada caso tem `c_so_ver := TRUE` por omissão: faz tudo, escreve o
--    resumo do que passaria de onde para onde, e desfaz sozinho. Só grava
--    com `FALSE`.
--  · Se as duas contas tiverem coisas que chocam (as duas no mesmo jogo, por
--    exemplo), recusa em vez de escolher.
--  · O que muda de dono é descoberto no momento, a partir das ligações da
--    base de dados de produção — não de uma lista escrita aqui. Uma tabela
--    nova que produção tenha e este ficheiro não conheça também passa.
-- ═════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- PARTE 1 — VER (só leitura). Correr primeiro e mandar o resultado ao PO.
-- ═════════════════════════════════════════════════════════════════════════

-- 1a. Todas as contas que partilham telemóvel com outra, e o que cada uma tem.
--     A 24 set devolvia QUATRO contas, dois pares: os ids escritos nos casos A
--     e B (Dev 2). Se devolver mais, apareceu um caso novo entretanto — não o
--     tratar às cegas com este ficheiro. (`dev-bypass` é o marcador das contas
--     de desenvolvimento, não um telemóvel.)
SELECT p.phone_hash,
       p.id,
       p.name,
       p.created_at::date                                  AS criada,
       (p.email LIKE 'guest-%@whatsapp.alinho.pt')         AS convidado_do_bot,
       p.rating                                             AS nivel,
       p.rating_games                                       AS jogos_no_nivel,
       (SELECT string_agg(o.name
                 || CASE WHEN m.is_guest THEN ' (convidado)' ELSE '' END
                 || CASE WHEN m.is_test  THEN ' (escondida)' ELSE '' END, ', ')
          FROM memberships m JOIN organizations o ON o.id = m.organization_id
         WHERE m.user_id = p.id)                            AS clubes,
       (SELECT count(*) FROM participants x
         WHERE x.user_id = p.id OR x.partner_id = p.id)     AS inscricoes_em_mixes,
       (SELECT count(*) FROM mix_player_stats s
         WHERE s.user_id = p.id)                            AS mixes_com_resultado
  FROM profiles p
 WHERE p.phone_hash IN (SELECT phone_hash FROM profiles
                         WHERE phone_hash IS NOT NULL AND phone_hash <> 'dev-bypass'
                         GROUP BY 1 HAVING count(*) > 1)
 ORDER BY p.phone_hash, p.created_at;

-- 1b. Tudo o que estas contas têm, tabela a tabela. Pôr os ids dos dois
--     casos na primeira linha.
WITH contas(id) AS (VALUES ('4b8d97e4-64ae-4a8d-92e8-b305448b8cf8'::uuid),   -- A: convidado
                           ('3bf16cc8-e2e1-48b8-9f0e-bd5853f74d22'::uuid),   -- A: registada
                           ('e41d6ca8-556d-4361-9e18-9bcab9fbbd99'::uuid),   -- B: fica
                           ('34329a2c-abb8-4456-a22a-cfe6cce36728'::uuid)),  -- B: sai (teste)
ligacoes AS (
  SELECT c.conrelid::regclass AS tabela, a.attname AS coluna
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.contype = 'f'
     AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
     AND c.connamespace = 'public'::regnamespace
     AND c.conrelid <> 'public.profiles'::regclass)
SELECT * FROM (
  SELECT contas.id AS conta, l.tabela::text, l.coluna::text,
         (xpath('/row/n/text()', query_to_xml(
            format('SELECT count(*) AS n FROM %s WHERE %I = %L', l.tabela, l.coluna, contas.id),
            false, true, '')))[1]::text::int AS linhas
    FROM contas CROSS JOIN ligacoes l) x
 WHERE linhas > 0
 ORDER BY conta, tabela, coluna;


-- ═════════════════════════════════════════════════════════════════════════
-- PARTE 2 — O SÍTIO DA CÓPIA. Correr uma vez, antes dos casos.
-- Fica num esquema à parte, que a app não vê: tem emails e telemóveis.
-- ═════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS arquivo_537;
REVOKE ALL ON SCHEMA arquivo_537 FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS arquivo_537.alteracoes (
  id           BIGSERIAL PRIMARY KEY,
  caso         TEXT        NOT NULL,
  tipo         TEXT        NOT NULL CHECK (tipo IN ('alterada', 'inserida')),
  tabela       TEXT        NOT NULL,
  chave        JSONB       NOT NULL,   -- como encontrar a linha DEPOIS da mudança
  colunas      TEXT[],                 -- as colunas que mudaram (só em 'alterada')
  antes        JSONB,                  -- a linha inteira, como estava
  nota         TEXT,
  feito_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  desfeito_em  TIMESTAMPTZ
);
REVOKE ALL ON ALL TABLES    IN SCHEMA arquivo_537 FROM public, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA arquivo_537 FROM public, anon, authenticated;

-- Guarda as linhas de `p_tabela` que cumprem `p_onde`, antes de lhes mudar
-- as colunas de `p_novos`. A chave guardada já é a de depois da mudança
-- (numa tabela em que a própria conta faz parte da chave, é essa que muda).
CREATE OR REPLACE FUNCTION arquivo_537.guardar(
  p_caso TEXT, p_tabela REGCLASS, p_onde TEXT, p_novos JSONB, p_nota TEXT)
RETURNS INTEGER
LANGUAGE plpgsql AS $f$
DECLARE
  v_pk TEXT[];
  v_n  INTEGER;
BEGIN
  -- Primeiro: há alguma coisa a guardar? Uma tabela sem chave primária só é
  -- problema se tiver linhas desta pessoa (24 set: `tournament_match_players`
  -- não tem chave em produção, e o convidado não tinha lá nada — a primeira
  -- versão recusava na mesma, e parou o «só ver» do System Integrator).
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

-- Põe tudo como estava, do fim para o princípio. Repõe SÓ as colunas que o
-- caso mudou: o que a pessoa fez entretanto noutras colunas fica.
-- Uma ressalva: o NÍVEL volta ao valor de antes. Se a pessoa tiver jogado
-- entre arrumar e desfazer, esses jogos deixam de estar no nível dela até o
-- ranking ser recalculado (#440 — refaz todos os níveis a partir dos jogos).
CREATE OR REPLACE FUNCTION arquivo_537.desfazer(p_caso TEXT)
RETURNS TEXT
LANGUAGE plpgsql AS $f$
DECLARE
  r       RECORD;
  v_set   TEXT;
  v_n     INTEGER;
  v_total INTEGER := 0;
  v_trig  BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM arquivo_537.alteracoes
                  WHERE caso = p_caso AND desfeito_em IS NULL) THEN
    RETURN format('Caso %s: nada por desfazer.', p_caso);
  END IF;

  -- Mudar o parceiro de uma inscrição escreve «parceiro adicionado» no
  -- histórico do mix. Aqui não é verdade — é arrumação — por isso desliga-se
  -- só durante isto (e volta a ligar-se, mesmo que rebente a meio: tudo
  -- volta atrás junto).
  v_trig := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.participants'::regclass
                     AND tgname = 'participant_events_trigger' AND tgenabled <> 'D');
  IF v_trig THEN
    ALTER TABLE public.participants DISABLE TRIGGER participant_events_trigger;
  END IF;

  FOR r IN SELECT * FROM arquivo_537.alteracoes
            WHERE caso = p_caso AND desfeito_em IS NULL
            ORDER BY id DESC LOOP
    IF r.tipo = 'inserida' THEN
      EXECUTE format('DELETE FROM %s t WHERE to_jsonb(t) @> $1', r.tabela) USING r.chave;
    ELSE
      SELECT string_agg(format('%1$I = x.%1$I', c), ', ') INTO v_set FROM unnest(r.colunas) c;
      EXECUTE format(
        'UPDATE %s t SET %s FROM jsonb_populate_record(NULL::%s, $1) x WHERE to_jsonb(t) @> $2',
        r.tabela, v_set, r.tabela)
        USING r.antes, r.chave;
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Não encontrei a linha % de % (chave %). Nada foi desfeito — parar e ler.',
        r.id, r.tabela, r.chave;
    END IF;
    UPDATE arquivo_537.alteracoes SET desfeito_em = now() WHERE id = r.id;
    v_total := v_total + 1;
  END LOOP;

  IF v_trig THEN
    ALTER TABLE public.participants ENABLE TRIGGER participant_events_trigger;
  END IF;
  RETURN format('Caso %s: %s linhas repostas como estavam.', p_caso, v_total);
END $f$;

REVOKE ALL ON FUNCTION arquivo_537.guardar(TEXT, REGCLASS, TEXT, JSONB, TEXT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION arquivo_537.desfazer(TEXT) FROM public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- PARTE 3 — CASO A: juntar o convidado à conta registada
-- ═════════════════════════════════════════════════════════════════════════
-- O que passa do convidado para a conta registada:
--   · os mixes em que jogou (inscrição, dupla, resultado de cada mix) e o
--     histórico de entradas e saídas;
--   · os números do clube (vitórias, derrotas, mixes jogados, pontos): SOMAM-SE
--     aos da conta registada;
--   · o nível: o que o convidado ganhou ou perdeu soma-se ao nível da conta
--     registada. (O convidado começou em 900, não no nível da pessoa, por isso
--     o valor é aproximado — o recálculo do #440 refaz-o a partir dos jogos.)
--   · o telemóvel: fica na conta registada, que passa a ser membro do clube se
--     ainda não era.
--   · qualquer outra coisa ligada ao convidado (jogos entre amigos, torneios,
--     pedidos de amizade…) — descoberto no momento.
-- O convidado fica, sem telemóvel, com «(juntado, #537)» no nome e escondido
-- das listas e do ranking (a mesma marca que as contas de teste usam).
DO $caso_a$
DECLARE
  -- ↓↓↓ PREENCHER ↓↓↓
  -- Ids tirados de produção pelo Dev 2 a 24 set. A registada entrou no clube
  -- às 12h32 de 22 set, meia hora DEPOIS do «In» das 12h02 — por isso o bot
  -- não a encontrou e criou o convidado. Hoje as duas têm o telemóvel e são
  -- membros do clube: o próximo «In» dá erro e cria mais um.
  c_convidado CONSTANT UUID    := '4b8d97e4-64ae-4a8d-92e8-b305448b8cf8';  -- convidado do bot, 22 set, 1 jogo
  c_registada CONSTANT UUID    := '3bf16cc8-e2e1-48b8-9f0e-bd5853f74d22';  -- registada a 16 set, 0 jogos
  -- clube: 2a5f7ef2-ba1c-4d9d-97ca-57ea00c76164 (o script lê-o das inscrições do convidado)
  c_so_ver    CONSTANT BOOLEAN := TRUE;  -- TRUE: mostra e desfaz. FALSE: grava.
  -- ↑↑↑ PREENCHER ↑↑↑
  c_stats_cols CONSTANT TEXT[] := ARRAY['id','user_id','organization_id','game_wins','game_losses',
                                        'mix_wins','mixes_played','total_points','updated_at'];
  v_de     profiles%ROWTYPE;
  v_para   profiles%ROWTYPE;
  f        RECORD;
  u        RECORD;
  s        RECORD;
  m        RECORD;
  t        player_stats%ROWTYPE;
  v_n      INTEGER;
  v_conf   INTEGER;
  v_join   TEXT;
  v_delta  NUMERIC;
  v_novo   UUID;
  v_trig   BOOLEAN;
  v_resumo TEXT := '';
BEGIN
  -- ── Verificações ──────────────────────────────────────────────────────
  IF c_convidado IS NULL OR c_registada IS NULL THEN
    RAISE EXCEPTION 'Caso A: faltam os dois ids no topo.';
  END IF;
  IF EXISTS (SELECT 1 FROM arquivo_537.alteracoes WHERE caso = 'A' AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'Caso A: já foi feito. Para refazer, primeiro SELECT arquivo_537.desfazer(''A'').';
  END IF;
  SELECT * INTO v_de   FROM profiles WHERE id = c_convidado;
  SELECT * INTO v_para FROM profiles WHERE id = c_registada;
  IF v_de.id IS NULL OR v_para.id IS NULL THEN
    RAISE EXCEPTION 'Caso A: não encontrei uma das contas.';
  END IF;
  IF v_de.email NOT LIKE 'guest-%@whatsapp.alinho.pt' THEN
    RAISE EXCEPTION 'Caso A: a primeira conta não é um convidado do bot (%). Os ids estão trocados?', v_de.email;
  END IF;
  IF v_para.email LIKE 'guest-%@whatsapp.alinho.pt' THEN
    RAISE EXCEPTION 'Caso A: a conta registada também é um convidado do bot. Parar e ver à mão.';
  END IF;
  IF v_de.phone_hash IS DISTINCT FROM v_para.phone_hash
     AND v_de.phone_hash IS NOT NULL AND v_para.phone_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Caso A: as duas contas têm telemóveis DIFERENTES. Confirmar que é a mesma pessoa antes de juntar.';
  END IF;
  IF (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'player_stats')
     IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(c_stats_cols) c) THEN
    RAISE EXCEPTION 'Caso A: player_stats tem colunas que este ficheiro não conhece — somar só as que conheço perdia números. Parar e ler.';
  END IF;

  v_trig := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.participants'::regclass
                     AND tgname = 'participant_events_trigger' AND tgenabled <> 'D');
  IF v_trig THEN
    ALTER TABLE public.participants DISABLE TRIGGER participant_events_trigger;
  END IF;

  -- ── 1. Tudo o que aponta para o convidado passa para a conta registada ──
  FOR f IN
    SELECT c.conrelid::regclass AS tabela, a.attname AS coluna, a.attnum
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f'
       AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
       AND c.connamespace = 'public'::regnamespace
       AND c.conrelid NOT IN ('public.profiles'::regclass,       -- a conta em si (passo 4)
                              'public.memberships'::regclass,    -- passo 3
                              'public.player_stats'::regclass)   -- passo 2: soma-se
     ORDER BY 1, 2
  LOOP
    -- Recusar se as duas contas já tiverem linhas que, depois de mudar,
    -- ficavam repetidas (ex.: as duas no mesmo mix).
    FOR u IN SELECT con.conkey FROM pg_constraint con
              WHERE con.conrelid = f.tabela AND con.contype IN ('u', 'p')
                AND f.attnum = ANY (con.conkey) LOOP
      SELECT string_agg(format('r1.%1$I IS NOT DISTINCT FROM r2.%1$I', a.attname), ' AND ')
        INTO v_join
        FROM pg_attribute a
       WHERE a.attrelid = f.tabela AND a.attnum = ANY (u.conkey) AND a.attnum <> f.attnum;
      EXECUTE format('SELECT count(*) FROM %s r1 JOIN %s r2 ON %s WHERE r1.%I = $1 AND r2.%I = $2',
                     f.tabela, f.tabela, COALESCE(v_join, 'TRUE'), f.coluna, f.coluna)
        INTO v_conf USING c_convidado, c_registada;
      IF v_conf > 0 THEN
        RAISE EXCEPTION 'Caso A: as duas contas têm % linha(s) que chocam em %.% (ex.: as duas no mesmo jogo). Não escolho — parar e ver à mão.',
          v_conf, f.tabela, f.coluna;
      END IF;
    END LOOP;

    v_n := arquivo_537.guardar('A', f.tabela, format('%I = %L', f.coluna, c_convidado),
                               jsonb_build_object(f.coluna, c_registada),
                               'passa do convidado para a conta registada');
    IF v_n > 0 THEN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', f.tabela, f.coluna, f.coluna)
        USING c_registada, c_convidado;
      v_resumo := v_resumo || format(E'\n  passa para a registada: %s.%s — %s', f.tabela, f.coluna, v_n);
    END IF;
  END LOOP;

  -- ── 2. Números do clube: somam-se ─────────────────────────────────────
  FOR s IN SELECT * FROM player_stats WHERE user_id = c_convidado LOOP
    SELECT * INTO t FROM player_stats
     WHERE user_id = c_registada AND organization_id = s.organization_id;
    IF t.id IS NULL THEN
      PERFORM arquivo_537.guardar('A', 'public.player_stats', format('id = %L', s.id),
                                  jsonb_build_object('user_id', c_registada), 'números do clube passam');
      UPDATE player_stats SET user_id = c_registada WHERE id = s.id;
      v_resumo := v_resumo || E'\n  números do clube: passam (a registada não tinha)';
    ELSE
      PERFORM arquivo_537.guardar('A', 'public.player_stats', format('id = %L', t.id),
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
      PERFORM arquivo_537.guardar('A', 'public.player_stats', format('id = %L', s.id),
        jsonb_build_object('game_wins', 0, 'game_losses', 0, 'mix_wins', 0,
                           'mixes_played', 0, 'total_points', 0, 'updated_at', now()),
        'o convidado fica a zero (passou para a registada)');
      UPDATE player_stats
         SET game_wins = 0, game_losses = 0, mix_wins = 0, mixes_played = 0,
             total_points = 0, updated_at = now()
       WHERE id = s.id;
      v_resumo := v_resumo || format(E'\n  números do clube: somam-se (+%s mixes, +%s pontos)',
                                     s.mixes_played, s.total_points);
    END IF;
  END LOOP;

  -- ── 3. Clubes: a registada passa a membro; o convidado fica escondido ──
  FOR m IN SELECT * FROM memberships WHERE user_id = c_convidado LOOP
    IF NOT EXISTS (SELECT 1 FROM memberships
                    WHERE user_id = c_registada AND organization_id = m.organization_id) THEN
      INSERT INTO memberships (user_id, organization_id, is_admin, is_guest, level)
      VALUES (c_registada, m.organization_id, false, false, m.level)
      RETURNING id INTO v_novo;
      INSERT INTO arquivo_537.alteracoes (caso, tipo, tabela, chave, nota)
      VALUES ('A', 'inserida', 'public.memberships', jsonb_build_object('id', v_novo),
              'a registada passa a membro do clube do convidado');
      v_resumo := v_resumo || E'\n  a registada passa a membro do clube';
    END IF;
    PERFORM arquivo_537.guardar('A', 'public.memberships', format('id = %L', m.id),
                                jsonb_build_object('is_test', true),
                                'convidado escondido das listas e do ranking');
    UPDATE memberships SET is_test = true WHERE id = m.id;
  END LOOP;

  -- ── 4. A conta: telemóvel e nível ─────────────────────────────────────
  v_delta := CASE WHEN COALESCE(v_de.rating_games, 0) = 0 OR v_de.rating IS NULL THEN 0
                  ELSE v_de.rating - COALESCE(v_de.rating_anchor, 900) END;

  PERFORM arquivo_537.guardar('A', 'public.profiles', format('id = %L', c_registada),
    jsonb_build_object(
      'phone_hash',          COALESCE(v_para.phone_hash, v_de.phone_hash),
      'whatsapp_jid',        COALESCE(v_para.whatsapp_jid, v_de.whatsapp_jid),
      'rating',              CASE WHEN v_para.rating IS NULL THEN v_de.rating ELSE v_para.rating + v_delta END,
      'rating_anchor',       COALESCE(v_para.rating_anchor, v_de.rating_anchor),
      'rating_games',        COALESCE(v_para.rating_games, 0) + COALESCE(v_de.rating_games, 0),
      'rating_onboarded_at', COALESCE(v_para.rating_onboarded_at, v_de.rating_onboarded_at)),
    'recebe o telemóvel e o que o convidado jogou');
  UPDATE profiles
     SET phone_hash          = COALESCE(v_para.phone_hash, v_de.phone_hash),
         whatsapp_jid        = COALESCE(v_para.whatsapp_jid, v_de.whatsapp_jid),
         rating              = CASE WHEN v_para.rating IS NULL THEN v_de.rating ELSE v_para.rating + v_delta END,
         rating_anchor       = COALESCE(v_para.rating_anchor, v_de.rating_anchor),
         rating_games        = COALESCE(v_para.rating_games, 0) + COALESCE(v_de.rating_games, 0),
         rating_onboarded_at = COALESCE(v_para.rating_onboarded_at, v_de.rating_onboarded_at)
   WHERE id = c_registada;

  PERFORM arquivo_537.guardar('A', 'public.profiles', format('id = %L', c_convidado),
    jsonb_build_object('phone_hash', NULL, 'whatsapp_jid', NULL,
                       'name', v_de.name || ' (juntado, #537)'),
    'o convidado fica sem telemóvel e marcado');
  UPDATE profiles
     SET phone_hash = NULL, whatsapp_jid = NULL, name = v_de.name || ' (juntado, #537)'
   WHERE id = c_convidado;

  v_resumo := v_resumo || format(E'\n  nível da registada: %s → %s (%s%s do convidado, %s jogo(s))',
    round(v_para.rating), round(CASE WHEN v_para.rating IS NULL THEN v_de.rating ELSE v_para.rating + v_delta END),
    CASE WHEN v_delta >= 0 THEN '+' ELSE '' END, round(v_delta, 1), COALESCE(v_de.rating_games, 0));

  IF v_trig THEN
    ALTER TABLE public.participants ENABLE TRIGGER participant_events_trigger;
  END IF;

  -- ── 5. Confirmar: em cada clube, UMA conta com aquele telemóvel ─────────
  -- (`mm` e não `m`: `m` é a variável do ciclo do passo 3, e o Postgres
  -- recusava a consulta por não saber qual das duas era — 24 set.)
  IF EXISTS (
    SELECT 1 FROM memberships mm JOIN profiles p ON p.id = mm.user_id
     WHERE p.phone_hash = COALESCE(v_para.phone_hash, v_de.phone_hash)
       AND mm.organization_id IN (SELECT mb.organization_id FROM memberships mb WHERE mb.user_id = c_registada)
     GROUP BY mm.organization_id HAVING count(*) <> 1) THEN
    RAISE EXCEPTION 'Caso A: há um clube com mais de uma conta com este telemóvel — o bot continuava a dar erro. Nada ficou gravado.';
  END IF;

  IF c_so_ver THEN
    RAISE EXCEPTION E'CASO A — SÓ A VER, nada ficou gravado.%\nPara gravar: c_so_ver := FALSE.', v_resumo;
  END IF;
  RAISE NOTICE E'CASO A — feito.%\nDesfazer: SELECT arquivo_537.desfazer(''A'');', v_resumo;
END $caso_a$;


-- ═════════════════════════════════════════════════════════════════════════
-- PARTE 4 — CASO B: duas contas registadas com o mesmo telemóvel no clube
-- ═════════════════════════════════════════════════════════════════════════
-- A proposta para antes do Smash Cup: NÃO juntar. Só se tira o telemóvel da
-- conta que não se usa; a outra (a dos 17 jogos) fica com ele e o bot passa a
-- encontrá-la. Nenhum jogo, ponto ou nível muda de sítio.
-- Se a conta que perde o telemóvel tiver jogos, eles ficam lá — o resumo diz
-- quantos. Juntá-las fica para a função do ponto 1, depois de 13 out.
DO $caso_b$
DECLARE
  -- ↓↓↓ PREENCHER ↓↓↓
  -- Ids tirados de produção pelo Dev 2 a 24 set. A que perde o telemóvel é uma
  -- CONTA DE TESTE (is_test no clube desde 23 set, 12h35, 0 jogos) — não é
  -- uma pessoa com duas contas. Não há histórico para mover.
  c_fica     CONSTANT UUID    := 'e41d6ca8-556d-4361-9e18-9bcab9fbbd99';  -- 17 jogos: fica com o telemóvel
  c_sai      CONSTANT UUID    := '34329a2c-abb8-4456-a22a-cfe6cce36728';  -- conta de teste: perde o telemóvel
  -- clube em comum: 2a025553-528b-49e3-a2e9-f1d1fccf9c20
  c_so_ver   CONSTANT BOOLEAN := TRUE;
  -- ↑↑↑ PREENCHER ↑↑↑
  v_fica profiles%ROWTYPE;
  v_sai  profiles%ROWTYPE;
  v_jogos INTEGER;
  v_resumo TEXT;
BEGIN
  IF c_fica IS NULL OR c_sai IS NULL THEN
    RAISE EXCEPTION 'Caso B: faltam os dois ids no topo.';
  END IF;
  IF EXISTS (SELECT 1 FROM arquivo_537.alteracoes WHERE caso = 'B' AND desfeito_em IS NULL) THEN
    RAISE EXCEPTION 'Caso B: já foi feito.';
  END IF;
  SELECT * INTO v_fica FROM profiles WHERE id = c_fica;
  SELECT * INTO v_sai  FROM profiles WHERE id = c_sai;
  IF v_fica.id IS NULL OR v_sai.id IS NULL THEN
    RAISE EXCEPTION 'Caso B: não encontrei uma das contas.';
  END IF;
  IF v_fica.phone_hash IS NULL OR v_fica.phone_hash IS DISTINCT FROM v_sai.phone_hash THEN
    RAISE EXCEPTION 'Caso B: as duas contas não têm o mesmo telemóvel. Não é este caso.';
  END IF;

  SELECT count(*) INTO v_jogos FROM participants WHERE user_id = c_sai OR partner_id = c_sai;

  PERFORM arquivo_537.guardar('B', 'public.profiles', format('id = %L', c_sai),
                              jsonb_build_object('phone_hash', NULL, 'whatsapp_jid', NULL),
                              'perde o telemóvel repetido');
  UPDATE profiles SET phone_hash = NULL, whatsapp_jid = NULL WHERE id = c_sai;

  IF EXISTS (
    SELECT 1 FROM memberships m JOIN profiles p ON p.id = m.user_id
     WHERE p.phone_hash = v_fica.phone_hash
       AND m.organization_id IN (SELECT organization_id FROM memberships WHERE user_id = c_fica)
     GROUP BY m.organization_id HAVING count(*) <> 1) THEN
    RAISE EXCEPTION 'Caso B: ainda há um clube com mais de uma conta com este telemóvel (um convidado criado entretanto?). Nada ficou gravado — correr a parte 1 outra vez.';
  END IF;

  v_resumo := format(E'\n  «%s» fica com o telemóvel.\n  «%s» perde-o; as %s inscrição(ões) em mixes que tem ficam lá.',
                     v_fica.name, v_sai.name, v_jogos);
  IF c_so_ver THEN
    RAISE EXCEPTION E'CASO B — SÓ A VER, nada ficou gravado.%\nPara gravar: c_so_ver := FALSE.', v_resumo;
  END IF;
  RAISE NOTICE E'CASO B — feito.%\nDesfazer: SELECT arquivo_537.desfazer(''B'');', v_resumo;
END $caso_b$;


-- ═════════════════════════════════════════════════════════════════════════
-- PARTE 5 — DEPOIS
-- ═════════════════════════════════════════════════════════════════════════
-- Ver o que ficou guardado:
--   SELECT caso, tipo, tabela, colunas, nota, feito_em, desfeito_em
--     FROM arquivo_537.alteracoes ORDER BY id;
--
-- Desfazer um caso:
--   SELECT arquivo_537.desfazer('A');
--
-- Correr outra vez a PARTE 1 (1a): cada telemóvel destas pessoas tem de ter
-- uma só conta por clube (o convidado juntado já não tem telemóvel).
--
-- Aviso para o caso B: se a pessoa entrar na conta que perdeu o telemóvel e o
-- voltar a escrever no perfil, o erro volta. Só a função de juntar contas
-- (ponto 1 do cartão, depois de 13 out) resolve isso de vez.
