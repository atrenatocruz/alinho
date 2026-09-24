-- ═════════════════════════════════════════════════════════════════════════
-- ENSAIO DO NÍVEL: 20 JOGADORES, 6 MESES, VER ONDE CADA UM VAI PARAR
-- (Dev 3, 23 set 2026) — cartão «#475».
--
-- Pedido do Francisco: «testar o ELO, pega em 10-20 contas que a gente crie,
-- para ver ao fim de 1, 2, 3, 6 meses com que nível alguém fica a ganhar ou a
-- perder».
--
-- ESTE FICHEIRO NÃO É UMA MIGRAÇÃO e não entra na ordem de migrações. É um
-- ensaio: cria um esquema à parte, corre, responde, e apaga-se no fim.
--
-- ⚠️ NUNCA CORRER EM PRODUÇÃO. Nem é preciso: não lê nada de lá.
--
-- ─────────────────────────────────────────────────────────────────────────
-- DUAS COISAS QUE DECIDEM SE ESTE ENSAIO VALE ALGO
-- ─────────────────────────────────────────────────────────────────────────
--
-- 1. **AS CONTAS DO NÍVEL NÃO ESTÃO NO `src/lib/elo.js`.** Esse ficheiro tem
--    testes e parece ser o sítio, mas só converte um número numa etiqueta
--    (M5, F4). Quem decide o nível de alguém são funções da base de dados —
--    a `apply_mix_elo` é o caminho normal. Simular pelo `elo.js` dava um
--    resultado bonito e falso.
--
-- 2. **O ENSAIO TEM DE CORRER CONTRA O CORPO VIVO DE PRODUÇÃO.** As versões
--    do `dev` divergem das de produção (medido a 23 set), por isso correr
--    contra o `dev` responderia a uma pergunta que ninguém fez. O corpo vai
--    para o esquema `ensaio_elo`, COPIADO DE PRODUÇÃO — ver o passo 2.
--
-- ─────────────────────────────────────────────────────────────────────────
-- COMO É QUE ISTO NÃO TOCA EM DADOS DE NINGUÉM
-- ─────────────────────────────────────────────────────────────────────────
-- A `apply_mix_elo` escreve na `profiles` — a real. Copiá-la para outro
-- esquema não bastava: ela leva `SET search_path TO 'public'` colado, e
-- continuaria a escrever nas tabelas verdadeiras.
--
-- Por isso a cópia leva **`SET search_path TO 'ensaio_elo'`**, e mais nada.
-- Sem o `public` no caminho.
--
-- Isso dá uma propriedade que vale mais do que parece: **se me esquecer de
-- copiar uma tabela que a função usa, ela REBENTA em vez de ir buscá-la ao
-- `public`.** Um `search_path` com `public` no fim seria pior do que não ter
-- rede nenhuma — falhava em silêncio e escrevia nos dados verdadeiros.
--
-- ═════════════════════════════════════════════════════════════════════════
-- PASSO 1: O ESQUEMA DO ENSAIO
-- ═════════════════════════════════════════════════════════════════════════

-- ⚠️ NÃO COMEÇA POR APAGAR O ESQUEMA, E ISSO É DE PROPÓSITO.
--
-- A primeira versão deste ficheiro começava por `DROP SCHEMA IF EXISTS
-- ensaio_elo CASCADE`. Quando fui a correr, o esquema **já existia** — o
-- System Integrator estava a copiar para lá o corpo de produção da
-- `apply_mix_elo`, que é a peça que dá valor a este ensaio e que eu não
-- consigo ir buscar sozinho. O `DROP` tinha-lhe apagado o trabalho, e eu
-- ficava sem saber porque é que a cópia desaparecera.
--
-- Por isso: se o esquema já existir, isto PARA e pergunta. Apagar o trabalho
-- de outra pessoa não pode ser o primeiro efeito de um ficheiro de ensaio.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ensaio_elo') THEN
    RAISE EXCEPTION E'Parado: o esquema `ensaio_elo` já existe.\n\nPode ter lá a cópia do corpo de produção da apply_mix_elo, que é o que dá valor a este ensaio.\n\nSe for teu e já não precisares dele, apaga-o à mão primeiro:\n    DROP SCHEMA ensaio_elo CASCADE;\nSe não souberes de quem é, PERGUNTA antes de apagar.';
  END IF;
END $$;

CREATE SCHEMA ensaio_elo;

-- Só as colunas que a função toca. Uma cópia fiel da tabela inteira seria
-- mais código e mais sítios para divergir sem se notar.
--
-- `numeric(7,2)` de propósito, igual ao `public.profiles.rating`: este ensaio
-- é sobre ACUMULAÇÃO ao longo de seis meses, e é aí que o arredondamento
-- aparece. Com `numeric` livre, o resultado seria mais limpo do que a app.
CREATE TABLE ensaio_elo.profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  rating        NUMERIC(7,2),
  rating_games  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ensaio_elo.teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID,
  player1_id  UUID REFERENCES ensaio_elo.profiles(id),
  player2_id  UUID REFERENCES ensaio_elo.profiles(id)
);

CREATE TABLE ensaio_elo.matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL,
  team_a_id       UUID REFERENCES ensaio_elo.teams(id),
  team_b_id       UUID REFERENCES ensaio_elo.teams(id),
  score_a         INTEGER,
  score_b         INTEGER,
  winner_team_id  UUID,
  round_number    INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ensaio_elo.mix_player_stats (
  game_id       UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES ensaio_elo.profiles(id),
  rating_delta  NUMERIC(7,2),
  rating_after  NUMERIC(7,2),
  PRIMARY KEY (game_id, user_id)
);

-- Quem é quem no ensaio. `forca` é a probabilidade de a pessoa ganhar um
-- jogo equilibrado — é o que faz dela «a que ganha sempre» ou «a que perde
-- sempre». NÃO é o nível: o nível é o que o ensaio vai descobrir.
CREATE TABLE ensaio_elo.jogadores (
  id        UUID PRIMARY KEY REFERENCES ensaio_elo.profiles(id),
  papel     TEXT NOT NULL,
  forca     NUMERIC NOT NULL
);

-- Uma fotografia do nível de todos, semana a semana. É daqui que saem as
-- respostas e o gráfico.
CREATE TABLE ensaio_elo.historico (
  semana        INTEGER NOT NULL,
  id            UUID NOT NULL REFERENCES ensaio_elo.profiles(id),
  rating        NUMERIC(7,2),
  rating_games  INTEGER,
  jogos_semana  INTEGER,
  PRIMARY KEY (semana, id)
);

-- O escalão público de um nível. As fronteiras são as do `src/lib/elo.js`
-- (M1 ≥ 1800, M2 ≥ 1600, M3 ≥ 1400, M4 ≥ 1200, M5 ≥ 1000, M6 ≥ 700, abaixo
-- disso Iniciante). Copiadas à mão porque são de um ficheiro de JavaScript e
-- não de uma função da base de dados — **se alguém mudar as bandas no
-- `elo.js`, isto fica desactualizado e não avisa.** Confirmar antes de
-- correr outra vez.
--
-- Isto NÃO é a discussão das escalas (há três na app). Isso está decidido
-- como assunto para depois de 13 de outubro. Aqui serve só para responder à
-- pergunta «esta noite mudou o escalão da pessoa?».
CREATE FUNCTION ensaio_elo.banda(p_rating NUMERIC) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_rating IS NULL THEN NULL
    WHEN p_rating >= 1800 THEN 'M1'
    WHEN p_rating >= 1600 THEN 'M2'
    WHEN p_rating >= 1400 THEN 'M3'
    WHEN p_rating >= 1200 THEN 'M4'
    WHEN p_rating >= 1000 THEN 'M5'
    WHEN p_rating >=  700 THEN 'M6'
    ELSE 'Iniciante' END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- PASSO 2: O CORPO VIVO DA `apply_mix_elo`, COPIADO DE PRODUÇÃO
-- ═════════════════════════════════════════════════════════════════════════
-- ⚠️ ESTE PASSO NÃO ESTÁ FEITO NESTE FICHEIRO, E É DE PROPÓSITO.
--
-- Eu (Dev 3) não leio produção. O corpo tem de vir de quem tem acesso. Quem
-- o for buscar corre isto EM PRODUÇÃO (é só leitura):
--
--   SELECT pg_get_functiondef(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'apply_mix_elo';
--
-- E cola-se aqui com DUAS alterações, só duas:
--   1. `CREATE OR REPLACE FUNCTION ensaio_elo.apply_mix_elo(...)`
--   2. `SET search_path TO 'ensaio_elo'`   ← sem o `public`, ver o topo
--
-- Mais nada. Uma vírgula mudada no corpo e o ensaio deixa de dizer o que a
-- app faz.
--
-- ENQUANTO ISSO NÃO CHEGAR: para provar que a máquina funciona, pode
-- copiar-se o corpo do `dev` com a linha abaixo. **Os números que saem dessa
-- volta NÃO SÃO RESPOSTA A NADA** — as versões divergem, e apresentá-los
-- seria o «bonito e falso» que este ficheiro existe para evitar. Servem só
-- para ver a máquina andar.
--
DO $copiar_do_dev$
DECLARE v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_mix_elo';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Não há apply_mix_elo no public desta base de dados. Cola o corpo de produção à mão (passo 2).';
  END IF;

  v_def := replace(v_def, 'FUNCTION public.apply_mix_elo', 'FUNCTION ensaio_elo.apply_mix_elo');
  v_def := replace(v_def, 'SET search_path TO ''public''', 'SET search_path TO ''ensaio_elo''');

  IF position('ensaio_elo.apply_mix_elo' IN v_def) = 0
     OR position('SET search_path TO ''ensaio_elo''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'A cópia não ficou apontada ao esquema do ensaio. Não corro assim: escreveria nos dados verdadeiros.';
  END IF;

  EXECUTE v_def;
  RAISE NOTICE '⚠️  A correr com o corpo do DEV. Os números NÃO são resposta — é só a máquina a andar.';
END
$copiar_do_dev$;

-- ═════════════════════════════════════════════════════════════════════════
-- PASSO 3: OS 20 JOGADORES
-- ═════════════════════════════════════════════════════════════════════════
-- Todos começam NO MESMO NÍVEL, de propósito. A pergunta do Francisco é
-- «quanto tempo leva quem ganha sempre a chegar ao topo?», e isso só se mede
-- se todos partirem do mesmo sítio. Começar com níveis espalhados
-- responderia a outra pergunta.
--
-- 1000 é o fundo do M5, o meio da escala — dá espaço para subir e para cair.
INSERT INTO ensaio_elo.profiles (name, rating, rating_games)
SELECT 'Jogador ' || lpad(k::text, 2, '0'), 1000.00, 0 FROM generate_series(1, 20) k;

-- Os papéis. A `forca` é a probabilidade de ganhar um jogo equilibrado.
-- Dois extremos de cada lado, porque é deles que o Francisco quer saber, e
-- o meio-campo para eles terem contra quem jogar.
INSERT INTO ensaio_elo.jogadores (id, papel, forca)
SELECT p.id,
       CASE
         WHEN n <= 2  THEN 'ganha quase sempre'
         WHEN n <= 4  THEN 'perde quase sempre'
         WHEN n <= 8  THEN 'forte'
         WHEN n <= 12 THEN 'fraco'
         ELSE              'médio'
       END,
       CASE
         WHEN n <= 2  THEN 0.95
         WHEN n <= 4  THEN 0.05
         WHEN n <= 8  THEN 0.70
         WHEN n <= 12 THEN 0.30
         ELSE              0.50
       END
  FROM (SELECT id, row_number() OVER (ORDER BY name) AS n FROM ensaio_elo.profiles) p;

-- ═════════════════════════════════════════════════════════════════════════
-- PASSO 4: SEIS MESES DE MIXES
-- ═════════════════════════════════════════════════════════════════════════
-- Ritmo medido nos mixes a sério (PO, 23 set): 1 a 2 por semana. Cada mix
-- leva 8 jogadores (4 duplas, todos contra todos = 6 jogos), que é o
-- tamanho normal de um mix de duas horas em dois campos.
--
-- 8 de 20 é 40% do grupo em cada mix, acima dos ~25% medidos. É de
-- propósito: com 25% (5 jogadores) não se formam 4 duplas e o mix deixava de
-- ser um mix. O efeito é o ensaio comprimir o tempo — cada pessoa joga mais
-- vezes em 26 semanas do que jogaria na vida real. **Ler o resultado como
-- «depois de N jogos», não «depois de N semanas».** A coluna
-- `rating_games` do histórico é a que não engana.
--
-- `setseed` fixo: o mesmo ensaio dá sempre o mesmo resultado, e dois ensaios
-- comparam-se.
DO $simular$
DECLARE
  c_semanas   CONSTANT INTEGER := 26;   -- seis meses
  c_por_mix   CONSTANT INTEGER := 8;

  -- Quanto é que o melhor da dupla decide o jogo. 0.5 = conta tanto como o
  -- parceiro (e aí a força individual dilui-se — ver a nota grande lá
  -- abaixo); 1.0 = o jogo decide-se só pelo melhor dos quatro.
  --   0.65 → um mix a sério: o parceiro conta, mas o melhor conta mais.
  --   1.00 → responde à pergunta pura «e quem ganha SEMPRE?», ignorando a
  --          sorte do parceiro.
  -- Correr os dois e comparar é o que dá a resposta honesta.
  c_peso_melhor CONSTANT NUMERIC := 0.65;

  -- Quantos pontos de força fazem a diferença entre igual e vitória quase
  -- certa. 0.35 dá: meia unidade de força à frente ≈ 80% de vitórias.
  c_escala      CONSTANT NUMERIC := 0.35;
  v_semana    INTEGER;
  v_mixes     INTEGER;
  v_mix       INTEGER;
  v_game      UUID;
  v_presentes UUID[];
  v_duplas    UUID[];
  v_t         RECORD;
  v_u         RECORD;
  v_fa        NUMERIC;
  v_fb        NUMERIC;
  v_p         NUMERIC;
  v_a_ganha   BOOLEAN;
  v_ronda     INTEGER;
  v_campeao   UUID;
BEGIN
  PERFORM setseed(0.4242);

  FOR v_semana IN 1 .. c_semanas LOOP
    -- 1 mix nas semanas ímpares, 2 nas pares: dá 1,5 por semana.
    v_mixes := CASE WHEN v_semana % 2 = 0 THEN 2 ELSE 1 END;

    FOR v_mix IN 1 .. v_mixes LOOP
      v_game := gen_random_uuid();

      -- Quem aparece: 8 ao acaso. Ninguém tem presença garantida, como na
      -- vida real.
      SELECT array_agg(id) INTO v_presentes FROM (
        SELECT id FROM ensaio_elo.profiles ORDER BY random() LIMIT c_por_mix
      ) x;

      INSERT INTO ensaio_elo.mix_player_stats (game_id, user_id)
      SELECT v_game, unnest(v_presentes);

      -- As duplas saem ao acaso — é o que faz de um mix um mix, e é também
      -- o que põe à prova a redistribuição por parceiro.
      INSERT INTO ensaio_elo.teams (game_id, player1_id, player2_id)
      SELECT v_game, a, b FROM (
        SELECT v_presentes[2*i-1] AS a, v_presentes[2*i] AS b
          FROM generate_series(1, c_por_mix/2) i
      ) y;

      -- Todos contra todos entre as duplas.
      v_ronda := 0;
      FOR v_t IN SELECT id, player1_id, player2_id FROM ensaio_elo.teams
                  WHERE game_id = v_game ORDER BY id LOOP
        FOR v_u IN SELECT id, player1_id, player2_id FROM ensaio_elo.teams
                    WHERE game_id = v_game AND id > v_t.id ORDER BY id LOOP
          v_ronda := v_ronda + 1;

          -- Quem ganha sai da FORÇA, não do nível. É isto que torna o ensaio
          -- honesto: o nível é a consequência que estamos a medir, não a
          -- causa. Se o vencedor saísse do nível, o ensaio confirmava-se a si
          -- mesmo.
          --
          -- ── PORQUE É QUE ISTO NÃO É UMA MÉDIA SIMPLES ──────────────────
          -- A primeira versão fazia `p = somaA / (somaA + somaB)`. Corri-a e
          -- MEDI o que saiu: quem eu tinha marcado como «ganha quase sempre»
          -- (0.95) ganhou **65%** dos jogos, e o «fraco» (0.30) ganhou 48% —
          -- praticamente igual ao «médio».
          --
          -- A razão é real e não era um erro de programação: com as duplas
          -- sorteadas a cada mix, uma força de 0.95 ao lado de uma de 0.05 dá
          -- exactamente a mesma soma que 0.70 com 0.30. **A força individual
          -- desaparecia na média.** E um ensaio assim não responde à pergunta
          -- do Francisco, que é sobre alguém que GANHA — se o «ganha sempre»
          -- só ganha 65%, os números dele são sobre outra pessoa.
          --
          -- Duas mudanças:
          --   · o melhor da dupla pesa mais do que o pior (`c_peso_melhor`),
          --     que é o que acontece num campo de padel: o mais forte agarra
          --     mais bolas;
          --   · a probabilidade sai de uma curva sobre a DIFERENÇA, não de uma
          --     proporção. A proporção comprime tudo para perto dos 50% e
          --     nenhuma dupla domina nunca.
          --
          -- A prova de que ficou bem é a consulta das «% que ganhou de facto»
          -- no passo 5: se a etiqueta não corresponder ao que a pessoa fez em
          -- campo, o resto do ensaio não vale nada. **Ler essa consulta antes
          -- de ler qualquer outra.**
          SELECT c_peso_melhor * max(j.forca) + (1 - c_peso_melhor) * min(j.forca)
            INTO v_fa FROM ensaio_elo.jogadores j
           WHERE j.id IN (v_t.player1_id, v_t.player2_id);
          SELECT c_peso_melhor * max(j.forca) + (1 - c_peso_melhor) * min(j.forca)
            INTO v_fb FROM ensaio_elo.jogadores j
           WHERE j.id IN (v_u.player1_id, v_u.player2_id);

          -- Mesma forma da curva do Elo, mas sobre a força: 1 ponto de força
          -- de diferença é uma vitória quase certa.
          v_p := 1 / (1 + power(10::numeric, (v_fb - v_fa) / c_escala));
          v_a_ganha := random() < COALESCE(v_p, 0.5);

          INSERT INTO ensaio_elo.matches
            (game_id, team_a_id, team_b_id, score_a, score_b, winner_team_id, round_number)
          VALUES (v_game, v_t.id, v_u.id,
                  CASE WHEN v_a_ganha THEN 9 ELSE 5 END,
                  CASE WHEN v_a_ganha THEN 5 ELSE 9 END,
                  CASE WHEN v_a_ganha THEN v_t.id ELSE v_u.id END,
                  v_ronda);
        END LOOP;
      END LOOP;

      -- A dupla vencedora do mix: a que ganhou mais jogos. É quem leva o
      -- bónus de mérito de 1%.
      SELECT winner_team_id INTO v_campeao FROM ensaio_elo.matches
       WHERE game_id = v_game
       GROUP BY winner_team_id ORDER BY count(*) DESC, winner_team_id LIMIT 1;

      -- E agora o que interessa: as contas a sério, tal como na app.
      PERFORM ensaio_elo.apply_mix_elo(v_game, v_campeao);
    END LOOP;

    -- Fotografia do fim da semana.
    INSERT INTO ensaio_elo.historico (semana, id, rating, rating_games, jogos_semana)
    SELECT v_semana, p.id, p.rating, p.rating_games,
           (SELECT count(*) FROM ensaio_elo.mix_player_stats s
             WHERE s.user_id = p.id)
      FROM ensaio_elo.profiles p;
  END LOOP;

  RAISE NOTICE 'Simuladas % semanas.', c_semanas;
END
$simular$;

-- ═════════════════════════════════════════════════════════════════════════
-- PASSO 5: AS RESPOSTAS
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0. LER ESTA PRIMEIRO: as etiquetas correspondem ao que aconteceu? ───
-- Se o «ganha quase sempre» não ganhou quase sempre, todo o resto deste
-- ficheiro está a responder sobre outra pessoa. Foi assim que a primeira
-- versão do ensaio se enganou — e só se apanhou por se ter medido isto.
WITH jogos AS (
  SELECT m.winner_team_id, t.id AS team_id, t.player1_id AS p1, t.player2_id AS p2
    FROM ensaio_elo.matches m
    JOIN ensaio_elo.teams t ON t.id IN (m.team_a_id, m.team_b_id)
), porjogador AS (
  SELECT unnest(ARRAY[p1, p2]) AS pid, (team_id = winner_team_id) AS ganhou FROM jogos
)
SELECT j.papel,
       round(avg(j.forca), 2)                                            AS "força que lhe dei",
       count(*)                                                          AS jogos,
       round(100.0 * count(*) FILTER (WHERE pj.ganhou) / count(*), 1)    AS "% que ganhou de facto"
  FROM porjogador pj
  JOIN ensaio_elo.jogadores j ON j.id = pj.pid
 GROUP BY j.papel ORDER BY 4 DESC;

-- ── 1, 2, 3 e 6 meses: onde está cada papel ──────────────────────────────
-- É a resposta direta ao que o Francisco pediu.
SELECT j.papel,
       round(avg(h1.rating), 0)  AS "1 mês",
       round(avg(h2.rating), 0)  AS "2 meses",
       round(avg(h3.rating), 0)  AS "3 meses",
       round(avg(h6.rating), 0)  AS "6 meses",
       round(avg(h6.rating_games), 0) AS "jogos em 6 meses"
  FROM ensaio_elo.jogadores j
  JOIN ensaio_elo.historico h1 ON h1.id = j.id AND h1.semana = 4
  JOIN ensaio_elo.historico h2 ON h2.id = j.id AND h2.semana = 9
  JOIN ensaio_elo.historico h3 ON h3.id = j.id AND h3.semana = 13
  JOIN ensaio_elo.historico h6 ON h6.id = j.id AND h6.semana = 26
 GROUP BY j.papel
 ORDER BY 5 DESC;

-- ── 2. Quem ganha sempre: em que semana chega ao topo? ───────────────────
-- «Topo» = 1800, o fundo do M1 (src/lib/elo.js). Se vier NULL, não chegou lá
-- em seis meses — e isso é uma resposta tão boa como um número.
SELECT p.name, j.papel,
       min(h.semana) FILTER (WHERE h.rating >= 1800) AS "semana em que chega a M1",
       min(h.semana) FILTER (WHERE h.rating >= 1600) AS "semana em que chega a M2",
       max(h.rating) AS "nível mais alto",
       (SELECT rating FROM ensaio_elo.historico WHERE id = p.id AND semana = 26) AS "nível aos 6 meses"
  FROM ensaio_elo.profiles p
  JOIN ensaio_elo.jogadores j ON j.id = p.id
  JOIN ensaio_elo.historico h ON h.id = p.id
 WHERE j.papel = 'ganha quase sempre'
 GROUP BY p.id, p.name, j.papel;

-- ── 3. Quem perde sempre: fica encalhado num fundo? ─────────────────────
-- A pergunta a sério é se o número PARA de descer, e a partir de quando. Se
-- as últimas oito semanas mexerem menos de 10 pontos, encalhou.
SELECT p.name, j.papel,
       min(h.rating) AS "nível mais baixo",
       (SELECT rating FROM ensaio_elo.historico WHERE id = p.id AND semana = 13) AS "aos 3 meses",
       (SELECT rating FROM ensaio_elo.historico WHERE id = p.id AND semana = 26) AS "aos 6 meses",
       (SELECT rating FROM ensaio_elo.historico WHERE id = p.id AND semana = 18)
         - (SELECT rating FROM ensaio_elo.historico WHERE id = p.id AND semana = 26) AS "quanto desceu nas últimas 8 semanas"
  FROM ensaio_elo.profiles p
  JOIN ensaio_elo.jogadores j ON j.id = p.id
  JOIN ensaio_elo.historico h ON h.id = p.id
 WHERE j.papel = 'perde quase sempre'
 GROUP BY p.id, p.name, j.papel;

-- ── 4. O grupo todo continua a somar zero? ──────────────────────────────
-- O bónus de mérito é pago pelos outros participantes, por isso a soma do
-- grupo devia mexer-se pouco. Se estiver a crescer, há pontos a nascer do
-- nada — foi o erro do #440 com convidados, e vale a pena confirmar que não
-- acontece aqui.
SELECT h.semana,
       round(sum(h.rating), 2) AS "soma de todos",
       round(sum(h.rating) - 20000, 2) AS "diferença para o início (20 × 1000)"
  FROM ensaio_elo.historico h
 WHERE h.semana IN (1, 4, 9, 13, 18, 26)
 GROUP BY h.semana ORDER BY h.semana;

-- ── 5. Quanto é que o nível oscila numa noite normal? ───────────────────
-- Pergunta do PO, e é a que decide se as pessoas confiam no número: se
-- alguém que joga bem perder uma noite e isso o fizer MUDAR DE ESCALÃO, ele
-- vê M4 a virar M5 na app e conclui que aquilo é aleatório. Um número em que
-- não se confia é pior do que não ter número.
SELECT round(avg(abs(s.rating_delta)), 1)                         AS "mexe em média (pontos)",
       round(max(abs(s.rating_delta)), 1)                         AS "maior salto numa noite",
       round(percentile_cont(0.95) WITHIN GROUP
             (ORDER BY abs(s.rating_delta))::numeric, 1)          AS "salto no pior 5% das noites",
       count(*) FILTER (
         WHERE ensaio_elo.banda(s.rating_after)
            <> ensaio_elo.banda(s.rating_after - s.rating_delta)) AS "noites que mudaram o escalão",
       count(*)                                                   AS "noites no total",
       round(100.0 * count(*) FILTER (
         WHERE ensaio_elo.banda(s.rating_after)
            <> ensaio_elo.banda(s.rating_after - s.rating_delta)) / count(*), 1) AS "% das noites"
  FROM ensaio_elo.mix_player_stats s
 WHERE s.rating_delta IS NOT NULL;

-- E as mudanças de escalão vistas uma a uma, que é o que se mostra ao
-- Francisco: quem, de que para que, e por causa de quanto.
SELECT p.name, j.papel,
       ensaio_elo.banda(s.rating_after - s.rating_delta) AS "estava em",
       ensaio_elo.banda(s.rating_after)                  AS "passou a",
       s.rating_delta                                    AS "por causa de",
       s.rating_after                                    AS "ficou com"
  FROM ensaio_elo.mix_player_stats s
  JOIN ensaio_elo.profiles p ON p.id = s.user_id
  JOIN ensaio_elo.jogadores j ON j.id = s.user_id
 WHERE s.rating_delta IS NOT NULL
   AND ensaio_elo.banda(s.rating_after) <> ensaio_elo.banda(s.rating_after - s.rating_delta)
 ORDER BY abs(s.rating_delta) DESC
 LIMIT 15;

-- ── 6. A tabela toda aos 6 meses, para o print ──────────────────────────
SELECT row_number() OVER (ORDER BY h.rating DESC) AS "#",
       p.name, j.papel, h.rating AS nivel, h.rating_games AS jogos
  FROM ensaio_elo.historico h
  JOIN ensaio_elo.profiles p ON p.id = h.id
  JOIN ensaio_elo.jogadores j ON j.id = h.id
 WHERE h.semana = 26 ORDER BY h.rating DESC;

-- ═════════════════════════════════════════════════════════════════════════
-- NO FIM: APAGAR
-- ═════════════════════════════════════════════════════════════════════════
-- O esquema não é para ficar. Enquanto existir, tem uma cópia de uma função
-- da app que ninguém mantém — e daqui a um mês alguém encontra-a e não sabe
-- se é a boa.
--
--   DROP SCHEMA ensaio_elo CASCADE;
