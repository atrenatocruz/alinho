-- ════════════════════════════════════════════════════════════════════════
-- PREPARAR UM ENSAIO DE TORNEIO COM CONTAS DE TESTE
-- (Dev 3, 23 set 2026) — cartão «#228 — Ensaio geral do torneio».
--
-- ⚠️  NÃO CORRER EM PRODUÇÃO ANTES DE O «#422» ESTAR FEITO  ⚠️
--
--     O #422 é o que tira as contas de teste do ranking público. Hoje, em
--     produção, o ranking já é liderado por contas de teste com 1900 pontos
--     e zero jogos. Se se criarem aqui mais 300 contas com nível antes
--     disso, o ranking público passa a ser, na maioria, gente que não
--     existe — e isto a duas semanas de centenas de pessoas novas abrirem a
--     app por causa do Smash Cup.
--
--     Por isso este ficheiro RECUSA-SE A CORRER até alguém pôr
--     `v_confirmo_422_feito := TRUE` lá em baixo. É de propósito: a regra
--     não fica só num comentário que se lê por cima.
--
-- ═════════════════════════════════════════════════════════════════════════
-- O QUE O ENSAIO PROVA, E O QUE NÃO PROVA — LER ANTES DE CONFIAR NELE
-- ═════════════════════════════════════════════════════════════════════════
-- Isto é mais importante do que parece: **um ensaio que se acredita ter
-- provado mais do que provou é pior do que não ensaiar.** Quem sai daqui a
-- pensar que está tudo verificado deixa de olhar para o que falta.
--
-- PROVA:
--   · que a app arranca com um torneio a sério lá dentro;
--   · que os ecrãs carregam e aguentam o volume (o ensaio B);
--   · que o sorteio, o quadro e o calendário se comportam com níveis
--     espalhados e com as inscrições estranhas (sem parceiro, com convidado,
--     desistida, por validar).
--
-- NÃO PROVA, e é aqui que se engana quem não ler isto:
--
--   1. **O COMPORTAMENTO DA INSCRIÇÃO, E DO FECHO E DO SORTEIO.** Estas oito
--      funções NÃO são a mesma versão no dev e em produção (medido pelo PO a
--      23 set 2026, `md5` do corpo com espaços normalizados):
--
--        tournament_signup          ← por aqui entra o jogador
--        tournament_admin_signup    ← por aqui inscreve a organização
--        tournament_claim_entry     ← por aqui entra quem vem do link do convite
--        tournament_respond_invite
--        tournament_validate_entry
--        tournament_remove_entry
--        close_category_entries     ← o fecho das inscrições
--        draw_category              ← o sorteio
--
--      E cinco estão iguais ao caráter, para não se desconfiar delas sem
--      razão: `list_my_tournament_invites`, `list_tournament_entries`,
--      `tournament_change_partner`, `tournament_invite_token` e
--      `tournament_withdraw_entry`.
--
--      **O QUE ISTO DIZ E O QUE NÃO DIZ:** diz que não são a mesma versão.
--      NÃO diz que se portam de maneira diferente — um comentário mudado dá
--      igualmente diferente. Quem decide isso é ler os corpos, e isso está
--      com o System Integrator (já encontrou um caso a sério: no dev a
--      `tournament_remove_entry` tem uma trava que impede remover uma dupla
--      já sorteada, e em produção não tem).
--
--      A `tournament_admin_signup` nem tem a mesma assinatura: produção tem
--      nove argumentos e o dev sete — **produção já tem o género (#433) e o
--      dev ainda não.** Aqui é o dev que está atrasado, não o contrário.
--
--      Ou seja: ensaiar a inscrição, o fecho ou o sorteio aqui diz como eles
--      se portam NO DEV. Não diz como se portam no dia 9, em produção. A
--      estrutura das tabelas está alinhada; estas oito funções não.
--
--   2. **NADA DO QUE CORRE SOZINHO.** Confirmei-o eu, a 23 set: o dev **não
--      tem a extensão de agendamento instalada** (`pg_cron` não existe lá).
--      Tudo o que devia acontecer a uma hora marcada sem ninguém carregar em
--      nada — fechos automáticos, avisos, lembretes — **não corre no ensaio,
--      e não corre por não existir, não por estar bem ou mal**. Se o dia do
--      torneio depender de alguma dessas, isso tem de ser verificado noutro
--      sítio.
--
-- Ou seja: o ensaio serve para ver a app a funcionar com gente e com volume.
-- Para a inscrição e para o que corre sozinho, **não vale como garantia**.
-- ═════════════════════════════════════════════════════════════════════════
--
-- ESTE FICHEIRO NÃO É UMA MIGRAÇÃO. Não entra na ordem de migrações, não
-- cria nem altera funções. Só mete dados de ensaio. Corre-se à mão, quando
-- se quer um ensaio, e corre-se outra vez sem estragar nada (cada vez cria
-- um torneio novo, com o seu nome e a sua data).
--
-- ════════════════════════════════════════════════════════════════════════
-- SERVE DOIS ENSAIOS DIFERENTES (separação do PO, 23 set)
-- ════════════════════════════════════════════════════════════════════════
--
-- ENSAIO A — COMPORTAMENTO. Pessoas reais no clube, telemóvel na mão, mas a
--   jogar com contas de teste. É onde aparece o que só se vê com gente a
--   mexer: chegar atrasado, desistir a meio, marcar mal um resultado, ficar
--   sem bateria, wi-fi do clube em baixo.
--       v_categorias := 2;  v_duplas_por_categoria := 8;  v_contas := 0;
--       v_com_casos_estranhos := TRUE;
--       e correr também o bloco «DAR ENTRADA NA APP» (v_ativar := TRUE)
--
-- ENSAIO B — VOLUME. Sem pessoas nenhumas. Para ver se o sorteio, o quadro
--   e os ecrãs aguentam um torneio cheio. Corre sozinho, a qualquer hora.
--       v_categorias := 7;  v_duplas_por_categoria := 16;  v_contas := 300;
--       v_com_casos_estranhos := TRUE;
--       e NÃO correr o bloco «DAR ENTRADA NA APP» — ninguém entra
--
-- ════════════════════════════════════════════════════════════════════════
-- O QUE ISTO FAZ, E O QUE DEIXA DE PROPÓSITO PARA A APP FAZER
-- ════════════════════════════════════════════════════════════════════════
--
-- FAZ: as contas de teste (com níveis espalhados), o torneio escondido do
--   público, os dias, os campos, as categorias e as inscrições — as
--   inscrições ficam em «validada».
--
-- NÃO FAZ, de propósito: fechar as inscrições, sortear, marcar horas,
--   escrever resultados nem fechar categorias. Isso é o que o ensaio existe
--   para testar — feito na app, pelo organizador, pelos botões a sério. Um
--   ficheiro que já entregasse o quadro sorteado estaria a testar o
--   ficheiro, não a app.
--
-- ════════════════════════════════════════════════════════════════════════
-- DUAS COISAS QUE VALE A PENA SABER ANTES
-- ════════════════════════════════════════════════════════════════════════
--
-- 1. NÍVEIS ESPALHADOS, E NÃO PELA ORDEM DE CRIAÇÃO. Uma conta nova não tem
--    nível, e aí o sorteio trata todas as duplas por igual: as cabeças de
--    série saem por ordem de inscrição e o quadro sai plano. Um ensaio que
--    passa assim não provou nada.
--    Mais: os níveis são atribuídos por uma ordem MISTURADA (sempre a
--    mesma, `md5`), de propósito. Se fossem por ordem de criação, um erro
--    que usasse a ordem de inscrição em vez do nível passava sem se ver —
--    que é precisamente o erro que interessa apanhar.
--    Cada categoria recebe gente dentro da SUA banda (M5 = 1000 a 1199,
--    M4 = 1200 a 1399, ...), como num torneio a sério.
--
-- 2. O TORNEIO NASCE ESCONDIDO (`is_public = false`). No meio das
--    inscrições verdadeiras do Smash Cup, um torneio de ensaio à vista
--    confundia quem está a tentar inscrever-se a sério. O organizador
--    continua a vê-lo pela pré-visualização do rascunho.
--
-- A LIMPEZA NO FIM está no fundo do ficheiro, e tem ordem: primeiro
-- devolver os pontos, só depois apagar. Ao contrário perdem-se os pontos
-- pelo caminho.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

DO $ensaio$
DECLARE
  -- ══════════════════════════════════════════════════════════════════════
  -- O QUE SE MUDA AQUI (e mais nada)
  -- ══════════════════════════════════════════════════════════════════════

  -- A trave de segurança do #422. Ver o aviso no topo.
  v_confirmo_422_feito   BOOLEAN := FALSE;

  v_clube                TEXT := 'Clube de teste';        -- nome do clube, tal como está na app
  v_admin_email          TEXT := 'muda-me@exemplo.com';   -- quem vai organizar o ensaio

  v_categorias           INT  := 2;    -- quantas categorias (1 a 7)
  v_duplas_por_categoria INT  := 8;    -- quantas duplas em cada uma
  v_contas               INT  := 0;    -- total de contas de teste; 0 = só as necessárias

  v_com_casos_estranhos  BOOLEAN := TRUE;   -- dupla sem parceiro, com convidado, desistida, por validar

  v_dia                  DATE := CURRENT_DATE + 7;  -- dia do ensaio
  v_campos               INT  := 4;
  v_abre                 TIME := '09:00';
  v_fecha                TIME := '21:00';

  -- ══════════════════════════════════════════════════════════════════════
  -- Daqui para baixo não é preciso mexer
  -- ══════════════════════════════════════════════════════════════════════
  c_dominio     CONSTANT TEXT := 'ensaio.alinho.test';  -- marca das contas de teste, ver nota no fim

  v_org         UUID;
  v_admin       UUID;
  v_torneio     UUID;
  v_slug        TEXT;
  v_cat         UUID;
  v_i           INT;
  v_n           INT;     -- quantas pessoas nesta categoria
  v_code        TEXT;
  v_nome_cat    TEXT;
  v_genero      TEXT;
  v_nivel       INT;
  v_min         INT;     -- fundo da banda de nível
  v_par         INT;
  v_criadas     INT := 0;
  v_inscricoes  INT := 0;
  v_p1          UUID;
  v_p2          UUID;

  -- As sete categorias, pela ordem em que entram. `v_categorias := 1` dá só
  -- Masculinos 5; `:= 2` acrescenta Mistos 4, que é o que põe à prova a
  -- regra de a dupla mista ter de ser um de cada.
  -- As bandas são as do ranking (src/lib/elo.js): 6 = 700, 5 = 1000,
  -- 4 = 1200, 3 = 1400, 2 = 1600, 1 = 1800.
  v_plano JSONB := '[
    {"code":"M5",  "nome":"Masculinos 5", "genero":"masculino", "nivel":5, "min":1000},
    {"code":"MX4", "nome":"Mistos 4",     "genero":"misto",     "nivel":4, "min":1200},
    {"code":"F5",  "nome":"Femininos 5",  "genero":"feminino",  "nivel":5, "min":1000},
    {"code":"M4",  "nome":"Masculinos 4", "genero":"masculino", "nivel":4, "min":1200},
    {"code":"MX5", "nome":"Mistos 5",     "genero":"misto",     "nivel":5, "min":1000},
    {"code":"F4",  "nome":"Femininos 4",  "genero":"feminino",  "nivel":4, "min":1200},
    {"code":"M3",  "nome":"Masculinos 3", "genero":"masculino", "nivel":3, "min":1400}
  ]'::jsonb;
BEGIN
  -- ── A trave do #422 ───────────────────────────────────────────────────
  IF NOT v_confirmo_422_feito THEN
    RAISE EXCEPTION E'Parado de proposito.\n\nEste ficheiro cria contas com nivel, e isso mexe no ranking publico. O #422 (tirar as contas de teste do ranking) tem de estar feito primeiro.\n\nSe ja esta: poe `v_confirmo_422_feito := TRUE` no topo e corre outra vez.';
  END IF;

  IF v_categorias < 1 OR v_categorias > jsonb_array_length(v_plano) THEN
    RAISE EXCEPTION 'v_categorias tem de ser entre 1 e %', jsonb_array_length(v_plano);
  END IF;
  IF v_duplas_por_categoria < 2 THEN
    RAISE EXCEPTION 'Com menos de 2 duplas não há jogo nenhum para ensaiar';
  END IF;

  -- ── O clube e quem organiza ───────────────────────────────────────────
  SELECT id INTO v_org FROM organizations WHERE name = v_clube;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Não há nenhum clube com o nome %. Confirma o nome tal como aparece na app.', v_clube;
  END IF;

  SELECT id INTO v_admin FROM profiles WHERE lower(email) = lower(v_admin_email);
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Não há conta nenhuma com o email %', v_admin_email;
  END IF;
  -- Sem isto, quem organiza chega ao ensaio e os botões de fechar
  -- inscrições e sortear recusam-se a funcionar — e descobre-se no dia.
  IF NOT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.organization_id = v_org AND m.user_id = v_admin AND m.is_admin)
     AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_admin AND p.is_platform_admin) THEN
    RAISE EXCEPTION '% não é admin de %. Sem isso não consegue fechar inscrições nem sortear.', v_admin_email, v_clube;
  END IF;

  -- ── O torneio ─────────────────────────────────────────────────────────
  v_slug := 'ensaio-' || to_char(now(), 'YYYYMMDD-HH24MI');
  INSERT INTO tournaments (organization_id, name, slug, location, starts_on, ends_on,
                           entries_deadline, entry_fee_cents, organizer_text,
                           status, is_public, created_by)
  VALUES (v_org,
          'Ensaio — ' || to_char(v_dia, 'DD/MM'),
          v_slug,
          v_clube,
          v_dia, v_dia,
          (v_dia - 1)::timestamptz + TIME '23:59',
          2500,
          'Torneio de ensaio. Não é a sério.',
          'inscricoes',
          FALSE,          -- escondido do público, ver nota 2 no topo
          v_admin)
  RETURNING id INTO v_torneio;

  INSERT INTO tournament_days (tournament_id, date, starts_at, ends_at, courts)
  VALUES (v_torneio, v_dia, v_abre, v_fecha, v_campos);

  INSERT INTO tournament_courts (tournament_id, name, position)
  SELECT v_torneio, 'Campo ' || k, k FROM generate_series(1, v_campos) k;

  -- A tabela de apoio com as pessoas do ensaio. Vive só durante esta
  -- ligação e desaparece no fim (`ON COMMIT DROP`).
  DROP TABLE IF EXISTS ensaio_gente;
  CREATE TEMP TABLE ensaio_gente (
    cat_code TEXT, k INT, id UUID, rating NUMERIC(7,2), genero TEXT
  ) ON COMMIT DROP;

  -- ── Categoria a categoria ─────────────────────────────────────────────
  FOR v_i IN 0 .. v_categorias - 1 LOOP
    v_code     := v_plano -> v_i ->> 'code';
    v_nome_cat := v_plano -> v_i ->> 'nome';
    v_genero   := v_plano -> v_i ->> 'genero';
    v_nivel    := (v_plano -> v_i ->> 'nivel')::int;
    v_min      := (v_plano -> v_i ->> 'min')::int;
    v_n        := v_duplas_por_categoria * 2;

    INSERT INTO tournament_categories (tournament_id, code, name, gender, level,
                                       slots, price_cents, day_date, start_time,
                                       third_place_match, status, position,
                                       prize_first, prize_second)
    VALUES (v_torneio, v_code, v_nome_cat, v_genero, v_nivel::text,
            v_duplas_por_categoria, 2500, v_dia, v_abre,
            TRUE, 'inscricoes', v_i + 1,
            'Troféu + material', 'Troféu')
    RETURNING id INTO v_cat;

    -- As pessoas desta categoria. `k` é a ordem de criação; o nível vem de
    -- uma ordem MISTURADA (ver nota 1 no topo), para que a ordem de
    -- inscrição não coincida com a força.
    INSERT INTO ensaio_gente (cat_code, k, id, rating, genero)
    SELECT v_code,
           ord.k,
           gen_random_uuid(),
           -- Espalhados dentro da banda: 1000 a 1194 num M5, com folga no
           -- topo para não tocar na banda seguinte.
           v_min + round((194.0 * (ord.pos - 1)) / GREATEST(v_n - 1, 1)),
           CASE WHEN v_genero = 'misto'    THEN CASE WHEN ord.k % 2 = 1 THEN 'masculino' ELSE 'feminino' END
                WHEN v_genero = 'feminino' THEN 'feminino'
                ELSE 'masculino' END
      FROM (
        SELECT k, row_number() OVER (ORDER BY md5(k::text || v_code)) AS pos
          FROM generate_series(1, v_n) k
      ) ord;

    INSERT INTO profiles (id, name, email, gender, birthday, preferred_side,
                          rating, rating_anchor, rating_games, rating_onboarded_at)
    SELECT g.id,
           format('Ensaio %s %s', g.cat_code, lpad(g.k::text, 2, '0')),
           format('ensaio-%s-%s@%s', lower(g.cat_code), lpad(g.k::text, 2, '0'), c_dominio),
           g.genero,
           DATE '1992-06-15' + (g.k * 37),
           (ARRAY['left','right','both'])[1 + (g.k % 3)],
           g.rating,
           g.rating::int,
           -- Jogos variados de propósito: abaixo de 8 o nível ainda é
           -- provisório e mexe mais. Um ensaio só com contas assentes não
           -- testa isso.
           (ARRAY[5, 12, 24, 40])[1 + (g.k % 4)],
           now()
      FROM ensaio_gente g
     WHERE g.cat_code = v_code AND g.k < 1000;
    v_criadas := v_criadas + v_n;

    -- As duplas: a pessoa 1 com a 2, a 3 com a 4, e por aí. Numa categoria
    -- mista isso dá sempre um de cada, porque os ímpares são masculinos.
    FOR v_par IN 1 .. v_duplas_por_categoria LOOP
      SELECT id INTO v_p1 FROM ensaio_gente WHERE cat_code = v_code AND k = v_par * 2 - 1;
      SELECT id INTO v_p2 FROM ensaio_gente WHERE cat_code = v_code AND k = v_par * 2;
      INSERT INTO tournament_entries (category_id, player1_id, player2_id, status,
                                      created_at, validated_at, validated_by)
      VALUES (v_cat, v_p1, v_p2, 'validada',
              now() - ((v_duplas_por_categoria - v_par) || ' minutes')::interval,
              now(), v_admin);
      v_inscricoes := v_inscricoes + 1;
    END LOOP;

    -- ── Os casos estranhos, só na primeira categoria ────────────────────
    -- São os que costumam partir as coisas: a inscrição que ficou a meio, a
    -- dupla com alguém sem conta, quem desistiu antes de começar e quem
    -- ainda não foi validado. Cada um precisa de uma pessoa nova, porque
    -- não se pode estar duas vezes na mesma categoria.
    IF v_com_casos_estranhos AND v_i = 0 THEN
      INSERT INTO ensaio_gente (cat_code, k, id, rating, genero)
      SELECT v_code, 1000 + k, gen_random_uuid(),
             v_min + 40 + k * 17,
             CASE WHEN v_genero = 'feminino' THEN 'feminino' ELSE 'masculino' END
        FROM generate_series(1, 5) k;

      INSERT INTO profiles (id, name, email, gender, preferred_side,
                            rating, rating_anchor, rating_games, rating_onboarded_at)
      SELECT g.id,
             format('Ensaio caso %s', g.k - 1000),
             format('ensaio-caso-%s@%s', g.k - 1000, c_dominio),
             g.genero, 'both', g.rating, g.rating::int, 15, now()
        FROM ensaio_gente g WHERE g.cat_code = v_code AND g.k > 1000;
      v_criadas := v_criadas + 5;

      -- 1. Ficou à espera de parceiro e nunca arranjou.
      SELECT id INTO v_p1 FROM ensaio_gente WHERE cat_code = v_code AND k = 1001;
      INSERT INTO tournament_entries (category_id, player1_id, status)
      VALUES (v_cat, v_p1, 'sem_parceiro');

      -- 2. Inscreveu-se com alguém que não tem conta na app. É esta que
      --    apanha os erros de pontos com convidados.
      SELECT id INTO v_p1 FROM ensaio_gente WHERE cat_code = v_code AND k = 1002;
      INSERT INTO tournament_entries (category_id, player1_id, guest_name, guest_email, status,
                                      validated_at, validated_by)
      VALUES (v_cat, v_p1, 'Convidado do Ensaio', format('convidado@%s', c_dominio),
              'validada', now(), v_admin);

      -- 3. Desistiu antes de começar.
      SELECT id INTO v_p1 FROM ensaio_gente WHERE cat_code = v_code AND k = 1003;
      INSERT INTO tournament_entries (category_id, player1_id, status)
      VALUES (v_cat, v_p1, 'desistiu');

      -- 4. Uma dupla completa que ainda não foi validada — para o
      --    organizador ter o que validar no dia.
      SELECT id INTO v_p1 FROM ensaio_gente WHERE cat_code = v_code AND k = 1004;
      SELECT id INTO v_p2 FROM ensaio_gente WHERE cat_code = v_code AND k = 1005;
      INSERT INTO tournament_entries (category_id, player1_id, player2_id, status)
      VALUES (v_cat, v_p1, v_p2, 'por_validar');

      v_inscricoes := v_inscricoes + 4;
    END IF;
  END LOOP;

  -- ── Contas a mais, se se pediram (ensaio de volume) ───────────────────
  -- Não jogam nada. Servem para ver como se portam as listas, a procura de
  -- parceiro e o ranking com muita gente lá dentro.
  IF v_contas > v_criadas THEN
    INSERT INTO profiles (id, name, email, gender, preferred_side,
                          rating, rating_anchor, rating_games, rating_onboarded_at)
    SELECT gen_random_uuid(),
           format('Ensaio extra %s', lpad(k::text, 3, '0')),
           format('ensaio-extra-%s@%s', lpad(k::text, 3, '0'), c_dominio),
           CASE WHEN k % 2 = 0 THEN 'feminino' ELSE 'masculino' END,
           'both',
           700 + ((k * 137) % 900),     -- espalhados por todas as bandas
           700 + ((k * 137) % 900),
           (ARRAY[5, 12, 24, 40])[1 + (k % 4)],
           now()
      FROM generate_series(1, v_contas - v_criadas) k;
    v_criadas := v_contas;
  END IF;

  -- ── O que ficou feito ─────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE 'Ensaio pronto.';
  RAISE NOTICE '  Torneio ......... % (escondido do público)', 'Ensaio — ' || to_char(v_dia, 'DD/MM');
  RAISE NOTICE '  Endereço ........ /torneio/%', v_slug;
  RAISE NOTICE '  id .............. %', v_torneio;
  RAISE NOTICE '  Categorias ...... %', v_categorias;
  RAISE NOTICE '  Inscrições ...... % (em «validada», por fechar na app)', v_inscricoes;
  RAISE NOTICE '  Contas criadas .. % (todas em @%)', v_criadas, c_dominio;
  RAISE NOTICE '  Entrar na app ... só se correres o bloco «DAR ENTRADA NA APP» (ensaio A)';
  RAISE NOTICE '';
  RAISE NOTICE 'A seguir, na app e à mão: validar o que falta, fechar inscrições, sortear, marcar horas.';
  RAISE NOTICE '';
END
$ensaio$;

-- ════════════════════════════════════════════════════════════════════════
-- DAR ENTRADA NA APP ÀS CONTAS DE TESTE (só o ensaio A precisa)
-- ════════════════════════════════════════════════════════════════════════
-- Isto escreve no `auth`, que é a parte da base de dados onde vivem as
-- entradas na app. Corre-se depois do bloco de cima, e só se as pessoas
-- tiverem de entrar de telemóvel. No ensaio B salta-se.
--
-- Porque é que está à parte e não lá dentro: o bloco de cima só mexe em
-- tabelas nossas e desfaz-se todo apagando as contas. Este mexe no `auth`,
-- e convém ver-se que se está a mexer nele.
--
-- `extensions.crypt`: o pgcrypto não vive no `public` nesta base de dados
-- (ver Alinho/notas-entre-devs/2026-09-23-pgcrypto-esta-no-esquema-extensions.md).
-- Sem o `extensions.` à frente dá «function crypt does not exist».
--
-- MUDA A SENHA se for para correr com pessoas de fora a escrevê-la.
DO $login$
DECLARE
  v_ativar  BOOLEAN := FALSE;          -- <- põe TRUE para dar entrada às contas
  v_senha   TEXT    := 'ensaio2026';
  v_quantas INT;
BEGIN
  IF NOT v_ativar THEN
    RAISE NOTICE 'Entrada na app: saltado (v_ativar = FALSE). É o que o ensaio B quer.';
    RETURN;
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT '00000000-0000-0000-0000-000000000000',
         p.id, 'authenticated', 'authenticated', p.email,
         extensions.crypt(v_senha, extensions.gen_salt('bf')),
         now(),                                   -- já confirmado: não há email para abrir
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('name', p.name),
         now(), now()
    FROM profiles p
   WHERE p.email LIKE '%@ensaio.alinho.test'
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

  GET DIAGNOSTICS v_quantas = ROW_COUNT;

  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  SELECT p.id::text, p.id,
         jsonb_build_object('sub', p.id::text, 'email', p.email, 'email_verified', true),
         'email', now(), now()
    FROM profiles p
   WHERE p.email LIKE '%@ensaio.alinho.test'
     AND NOT EXISTS (SELECT 1 FROM auth.identities i
                      WHERE i.user_id = p.id AND i.provider = 'email');

  RAISE NOTICE '% contas de teste podem agora entrar na app, com a senha «%».', v_quantas, v_senha;
END
$login$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- A FOTOGRAFIA DOS NÍVEIS — correr ANTES e DEPOIS do ensaio
-- ════════════════════════════════════════════════════════════════════════
-- Só das pessoas a sério. As duas fotografias têm de dar o mesmo número: se
-- derem, o ensaio não tocou no nível de ninguém. Se não derem, alguém
-- entrou no ensaio com a conta verdadeira.
--
--   SELECT count(*) AS pessoas,
--          round(sum(rating), 2) AS soma_dos_niveis
--     FROM profiles
--    WHERE email NOT LIKE '%@ensaio.alinho.test' AND rating IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- A LIMPEZA, NO FIM — E A ORDEM IMPORTA
-- ════════════════════════════════════════════════════════════════════════
-- Ao contrário não dá: apagar o torneio leva atrás as categorias e os
-- jogos, e é deles que se sabe quantos pontos cada pessoa levou. Apagado o
-- torneio, os pontos ficam nas contas e já não há como os devolver.
--
-- Está comentado de propósito. Descomenta-se quando o ensaio acabar, depois
-- de trocar o `ensaio-AAAAMMDD-HHMM` pelo endereço que apareceu acima.
--
-- BEGIN;
--
-- -- 1. Devolver os pontos de cada categoria que tenha fechado.
-- --    `undo_tournament_elo` devolve a cada pessoa exactamente o que levou.
-- --    ⚠️ Esta função vem na `migration_tournaments_recalc.sql`. Se ainda
-- --    não correu, isto falha — e aí não se apaga nada até ela correr.
-- DO $limpar$
-- DECLARE c RECORD;
-- BEGIN
--   FOR c IN SELECT ct.id, ct.code FROM tournament_categories ct
--            JOIN tournaments t ON t.id = ct.tournament_id
--            WHERE t.slug = 'ensaio-AAAAMMDD-HHMM'
--              AND ct.status = 'terminada'
--   LOOP
--     PERFORM undo_tournament_elo(c.id);
--     RAISE NOTICE 'Pontos devolvidos: %', c.code;
--   END LOOP;
-- END
-- $limpar$;
--
-- -- 2. Só agora apagar o torneio (leva categorias, inscrições e jogos).
-- DELETE FROM tournaments WHERE slug = 'ensaio-AAAAMMDD-HHMM';
--
-- -- 3. E as contas de teste. O `auth` primeiro, o perfil depois.
-- DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM profiles WHERE email LIKE '%@ensaio.alinho.test');
-- DELETE FROM auth.users      WHERE id      IN (SELECT id FROM profiles WHERE email LIKE '%@ensaio.alinho.test');
-- DELETE FROM profiles        WHERE email LIKE '%@ensaio.alinho.test';
--
-- COMMIT;
--
-- -- 4. E confirmar com a fotografia de cima que a soma ficou igual à do
-- --    início, ao cêntimo.

-- ════════════════════════════════════════════════════════════════════════
-- A MARCA DAS CONTAS DE TESTE: @ensaio.alinho.test
-- ════════════════════════════════════════════════════════════════════════
-- Escolhido de propósito. O `.test` é um terminal reservado — nunca pode
-- existir um endereço verdadeiro acabado assim, portanto uma conta com este
-- email é de teste com certeza, e não por acaso.
--
-- Serve também ao #422: para tirar as contas de teste do ranking basta
-- `email NOT LIKE '%@ensaio.alinho.test'`. As 7 contas de teste que já
-- existem em produção têm emails normais e vão ter de ser marcadas à mão;
-- destas, não.
