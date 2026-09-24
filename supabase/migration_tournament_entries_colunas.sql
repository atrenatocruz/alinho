-- ═════════════════════════════════════════════════════════════════════════
-- SEGURANÇA: DEIXA DE SE PODER LER O CÓDIGO DO CONVITE DAS INSCRIÇÕES
-- (Dev 3, 24 set 2026) — cartão «#483», P0.
--
-- Pode-se correr outra vez sem estragar. Não altera nenhuma função nem
-- nenhuma vista.
--
-- ─────────────────────────────────────────────────────────────────────────
-- A FALHA
-- ─────────────────────────────────────────────────────────────────────────
-- Em produção, quem tem sessão pode ler a `tournament_entries` diretamente,
-- com TODAS as colunas — incluindo `invite_token` e `guest_email`. Com o
-- token, chama `tournament_claim_entry` e fica com o lugar do convidado na
-- dupla de outra pessoa, mesmo numa inscrição já validada ou paga.
-- (Apanhado pelos agentes do Renato, 24 set.)
--
-- Medido em produção pelo PO a 24 set: é pior — **nem é preciso conta**,
-- `anon` também lê a tabela inteira. A regra de leitura (RLS) só deixa ver
-- inscrições de torneios públicos e fora de rascunho, por isso **a
-- exposição está aberta desde que exista um torneio público.** A 24 set
-- havia um: o «TESTE — ignorar (organizador)», público e a decorrer, criado
-- de manhã pelos agentes do Renato — as 7 inscrições dele liam-se sem conta
-- (apanhado pelo System Integrator). Uma versão anterior deste cabeçalho
-- dizia «zero linhas expostas»; estava errada.
--
-- ⚠️ NO `alinho-dev` A FALHA NÃO EXISTE: lá ninguém tem permissão de leitura
-- nesta tabela. As duas bases estão diferentes. Não se pode confirmar a
-- correção no dev — a verificação no fim deste ficheiro é o que a confirma,
-- na base de dados onde correr.
--
-- ─────────────────────────────────────────────────────────────────────────
-- A CORREÇÃO: LER SÓ AS CINCO COLUNAS QUE A APP PRECISA
-- ─────────────────────────────────────────────────────────────────────────
-- Quem lê a tabela diretamente, medido em `origin/dev` a 24 set:
--   · a app, UM sítio: `src/lib/tournamentAgenda.js` (a Home), que pede
--     `id, category_id, status` e filtra por `player1_id` / `player2_id`.
--     Filtrar por uma coluna também precisa de a poder ler, por isso são
--     cinco;
--   · as vistas `tournament_public*` — correm como DONAS, não dependem disto;
--   · as funções que tocam na tabela — no dev, TODAS correm como donas
--     (SECURITY DEFINER), não dependem disto. ⚠️ Em produção pode haver
--     outras: a consulta 2 no fim diz se há alguma que corra com os poderes
--     de quem chama. Se houver, PARAR e ver antes de correr isto.
--
-- Tudo o resto — `invite_token`, `guest_email`, `guest_phone_hash`,
-- `guest_name`, quem validou, etc. — deixa de se poder ler diretamente. A
-- página do torneio continua a mostrar o que mostrava, porque vem das vistas.
--
-- ─────────────────────────────────────────────────────────────────────────
-- E OS CÓDIGOS QUE JÁ PODEM TER SIDO LIDOS?
-- ─────────────────────────────────────────────────────────────────────────
-- Fechar a leitura não invalida os códigos que alguém já tenha copiado. Para
-- isso é preciso gerar códigos novos (parte 3). Mas isso tem um custo:
-- **os links de convite já partilhados deixam de funcionar.** Não há envio
-- automático de emails de convite (medido no repositório a 24 set) — os links
-- são partilhados pelos próprios jogadores, por WhatsApp. Quem convidou tem de
-- voltar a partilhar o link novo.
--
-- A 24 set, em produção, havia 21 convites com código, em quatro torneios —
-- TODOS de ensaio, incluindo o Smash Cup da app (confirmado pelo
-- Francisco). Renovar não matava nenhum convite real, por isso a parte 3 vai
-- LIGADA. Se este ficheiro
-- for corrido mais tarde, com torneios a sério, correr primeiro a consulta 3
-- e decidir antes se se desliga a trava.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. Fechar a leitura ─────────────────────────────────────────────────
-- Tirar a leitura da tabela inteira, e também de qualquer coluna que tenha
-- sido dada à parte — senão uma permissão antiga numa coluna sobrevivia.
REVOKE SELECT ON public.tournament_entries FROM anon, authenticated;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tournament_entries' LOOP
    EXECUTE format('REVOKE SELECT (%I) ON public.tournament_entries FROM anon, authenticated', c.column_name);
  END LOOP;
END $$;

-- E dar só as cinco. A regra de leitura (RLS) continua a ser a mesma: estas
-- colunas, das inscrições que ela já deixava ver.
GRANT SELECT (id, category_id, player1_id, player2_id, status)
   ON public.tournament_entries TO authenticated;

-- ── 2. Confirmar que ficou fechada ──────────────────────────────────────
-- Se alguma destas falhar, a correção não pegou e isto rebenta — em vez de
-- nos deixar pensar que está resolvido.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.tournament_entries', 'invite_token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.tournament_entries', 'guest_email', 'SELECT')
     OR has_column_privilege('authenticated', 'public.tournament_entries', 'guest_phone_hash', 'SELECT')
     OR has_column_privilege('anon', 'public.tournament_entries', 'invite_token', 'SELECT') THEN
    RAISE EXCEPTION 'Ainda se consegue ler o invite_token ou o guest_email. A correção NÃO pegou — ver se há um papel com permissões herdadas.';
  END IF;

  IF NOT (has_column_privilege('authenticated', 'public.tournament_entries', 'id', 'SELECT')
      AND has_column_privilege('authenticated', 'public.tournament_entries', 'category_id', 'SELECT')
      AND has_column_privilege('authenticated', 'public.tournament_entries', 'status', 'SELECT')
      AND has_column_privilege('authenticated', 'public.tournament_entries', 'player1_id', 'SELECT')
      AND has_column_privilege('authenticated', 'public.tournament_entries', 'player2_id', 'SELECT')) THEN
    RAISE EXCEPTION 'As cinco colunas que a Home usa ficaram sem leitura — a agenda de torneios da Home deixava de mostrar as inscrições.';
  END IF;

  RAISE NOTICE 'Fechado: o código do convite e o email do convidado já não se leem. A Home continua a ler o que precisa.';
END $$;

-- ── 3. Gerar códigos novos ─────────────────────────────────────────────
-- Ver «E os códigos que já podem ter sido lidos?» no topo. Ligado porque, a
-- 24 set, todos os convites eram de torneios de teste. Com convites reais
-- pendentes, desligar e avisar quem convidou antes de renovar.
DO $$
DECLARE
  v_rodar  BOOLEAN := TRUE;    -- ← ver a consulta 3 antes, se houver torneios a sério
  v_quantos INTEGER;
BEGIN
  SELECT count(*) INTO v_quantos FROM public.tournament_entries
   WHERE invite_token IS NOT NULL AND status <> 'desistiu';

  IF NOT v_rodar THEN
    RAISE NOTICE '⚠️ Códigos NÃO renovados (trava desligada). Há % convites com código; quem já tenha copiado um ainda o pode usar enquanto as inscrições estiverem abertas.', v_quantos;
    RETURN;
  END IF;

  UPDATE public.tournament_entries
     SET invite_token = md5(gen_random_uuid()::text || gen_random_uuid()::text)
   WHERE invite_token IS NOT NULL AND status <> 'desistiu';

  RAISE NOTICE 'Renovados % códigos de convite. Os links antigos já não funcionam — quem convidou tem de voltar a partilhar.', v_quantos;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- CONSULTAS PARA CORRER EM PRODUÇÃO ANTES (só leitura)
-- ═════════════════════════════════════════════════════════════════════════
-- 1. O que está exposto hoje:
--
--   SELECT r.rolname,
--          has_table_privilege(r.rolname, 'public.tournament_entries', 'SELECT') AS le_a_tabela,
--          has_column_privilege(r.rolname, 'public.tournament_entries', 'invite_token', 'SELECT') AS le_token,
--          has_column_privilege(r.rolname, 'public.tournament_entries', 'guest_email', 'SELECT') AS le_email
--     FROM pg_roles r WHERE r.rolname IN ('anon','authenticated');
--
-- 2. Há alguma função que leia a tabela com os poderes de quem chama? Se
--    vier alguma linha, PARAR: essa função parte com esta correção.
--
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND NOT p.prosecdef AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) ILIKE '%tournament_entries%';
--
--    E vistas que corram com os poderes de quem vê (também partiam):
--
--   SELECT c.relname FROM pg_class c
--    WHERE c.relkind = 'v' AND c.reloptions::text LIKE '%security_invoker=true%'
--      AND pg_get_viewdef(c.oid) ILIKE '%tournament_entries%';
--
-- 3. Quantos convites a renovação dos códigos afetaria:
--
--   SELECT count(*) AS convites_com_codigo,
--          count(*) FILTER (WHERE c.status = 'inscricoes') AS em_inscricoes_abertas
--     FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id
--    WHERE e.invite_token IS NOT NULL AND e.status <> 'desistiu';
