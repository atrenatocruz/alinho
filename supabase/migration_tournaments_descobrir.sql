-- ═════════════════════════════════════════════════════════════════════════
-- DESCOBRIR TORNEIOS SEM SABER QUAL SE PROCURA
-- (Dev 3, 23 set 2026) — cartão «#462».
--
-- Pode-se correr outra vez sem estragar. Não altera nem apaga nada do que
-- já existe: acrescenta uma função nova.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE FALTAVA
-- ─────────────────────────────────────────────────────────────────────────
-- Todas as funções de torneios exigem que já se saiba QUAL:
-- `list_club_tournaments(p_organization_id)`, `get_tournament_page(slug)`,
-- `list_tournament_categories_admin(p_tournament_id)`. Nenhuma responde a
-- «que torneios têm inscrições abertas?».
--
-- Não é um ecrã que se esqueceu de chamar uma função — a função nunca foi
-- escrita. Construiu-se o torneio todo e não se construiu caminho nenhum
-- até ele: hoje um torneio só existe para quem já tem o link.
--
-- Serve três sítios (a Comunidade, a Home e a página do clube) e é a
-- dependência dos três. Os ecrãs não são meus.
--
-- ─────────────────────────────────────────────────────────────────────────
-- O QUE CONTA COMO «INSCRIÇÕES ABERTAS» — as três condições, não duas
-- ─────────────────────────────────────────────────────────────────────────
-- Decidido com o PO (23 set): o torneio está em `inscricoes` **E** o prazo
-- ainda não passou **E** há pelo menos uma categoria a aceitar gente.
--
-- Porque as três: um torneio que aparece na Comunidade e onde já não se
-- entra é PIOR do que não aparecer. Quem clica, percebe que está cheio e
-- fica com a ideia de que a app lhe mentiu — e isso custa mais do que o
-- torneio que não mostrámos.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ORDEM: PELO PRAZO A ACABAR, NÃO PELA DATA DO JOGO
-- ─────────────────────────────────────────────────────────────────────────
-- Quem está a ver esta lista está a decidir se se inscreve, e para isso o
-- que conta é **o que fecha primeiro**. Um torneio que só se joga em
-- dezembro mas fecha inscrições amanhã tem de aparecer no topo. A desempatar,
-- pela data de início.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ABRE SEM CONTA, DE PROPÓSITO
-- ─────────────────────────────────────────────────────────────────────────
-- O link de um torneio corre o WhatsApp e chega a gente que não tem conta.
-- Se esta função exigisse sessão, o problema ficava igual para essas
-- pessoas. Lê só das vistas `tournament_public*`, que já deixam de fora os
-- rascunhos e os escondidos (`WHERE t.is_public AND t.status <> 'rascunho'`)
-- — **esse filtro não se toca aqui**, e é por isso que esta função não
-- precisa de o repetir nem pode enganar-se nele.
-- ═════════════════════════════════════════════════════════════════════════

-- As contas de uma categoria, num sítio só, para os três ecrãs não darem
-- números diferentes. Uma categoria aceita gente quando está em `inscricoes`
-- e ainda tem lugar.
--
-- QUEM OCUPA LUGAR: as duplas completas — `validada`, `selecionada` e também
-- `por_validar`. Esta última é a decisão que merece explicação: a dupla está
-- completa e à espera que a organização confirme, e se não contasse, a app
-- anunciava vagas que na prática já têm dono. Ficam de fora as incompletas
-- (`convite`, à espera que o parceiro aceite, e `sem_parceiro`) e quem
-- desistiu.
CREATE OR REPLACE FUNCTION tournament_category_spots(p_category_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM tournament_entries e
   WHERE e.category_id = p_category_id
     AND e.status IN ('validada', 'selecionada', 'por_validar');
$$;

-- ── A lista ───────────────────────────────────────────────────────────────
-- `p_organization_id` serve a página do clube com a MESMA função, em vez de
-- uma segunda a responder à mesma pergunta — duas divergem ao primeiro
-- acerto.
--
-- `p_include_running` junta os que já começaram («está a acontecer agora»).
-- Por omissão fica FALSO: a Comunidade, no separador «Para jogar», mostra só
-- onde se pode entrar, porque a pergunta com que as pessoas lá chegam é
-- «onde é que eu posso jogar?». Um torneio a decorrer não responde a isso, e
-- misturar as duas coisas faz com que nenhuma se perceba. O parâmetro existe
-- porque «está a acontecer agora» vai fazer falta — noutro sítio e com outro
-- desenho.
CREATE OR REPLACE FUNCTION list_open_tournaments(
  p_limit            INTEGER DEFAULT 20,
  p_organization_id  UUID    DEFAULT NULL,
  p_include_running   BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH abertos AS (
    SELECT t.*,
           -- Quantas categorias ainda aceitam gente, e quantos lugares
           -- sobram em todas juntas. Calculado aqui e não em cada ecrã: se
           -- cada um fizesse a conta, os três davam números diferentes ao
           -- primeiro engano.
           (SELECT count(*)::int FROM tournament_public_categories c
             WHERE c.tournament_id = t.id
               AND c.status = 'inscricoes'
               AND (c.slots IS NULL OR tournament_category_spots(c.id) < c.slots)) AS categories_open,
           (SELECT sum(GREATEST(c.slots - tournament_category_spots(c.id), 0))::int
              FROM tournament_public_categories c
             WHERE c.tournament_id = t.id
               AND c.status = 'inscricoes'
               AND c.slots IS NOT NULL) AS spots_left,
           (SELECT count(*)::int FROM tournament_public_categories c
             WHERE c.tournament_id = t.id) AS categories_total
      FROM tournament_public t
     WHERE (p_organization_id IS NULL OR t.organization_id = p_organization_id)
       AND (
         -- Inscrições abertas: as três condições.
         (t.status = 'inscricoes'
          AND (t.entries_deadline IS NULL OR t.entries_deadline > now()))
         -- Ou, se se pedir, os que já estão a acontecer.
         OR (p_include_running AND t.status IN ('sorteado', 'a_decorrer'))
       )
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY
           -- O que fecha primeiro vem primeiro. Os que já começaram não têm
           -- prazo a contar, por isso vão para o fim desta ordem e ordenam-se
           -- entre si pela data de início.
           x.entries_deadline ASC NULLS LAST, x.starts_on ASC), '[]'::jsonb)
    FROM (
      SELECT a.id, a.slug, a.name, a.location, a.poster_url,
             a.starts_on, a.ends_on, a.entries_deadline, a.entry_fee_cents,
             a.status,
             a.organization_id, a.club_name, a.club_logo_url,
             a.day_count, a.court_count,
             a.categories_total, a.categories_open,
             a.spots_left,
             a.entry_count AS entries_confirmed,
             -- Dias que faltam até fechar, arredondado para cima: hoje ao
             -- fim do dia conta como 1, não como 0. Quem lê «fecha em 0
             -- dias» não sabe se ainda dá.
             CASE WHEN a.entries_deadline IS NULL THEN NULL
                  ELSE GREATEST(ceil(EXTRACT(EPOCH FROM (a.entries_deadline - now())) / 86400)::int, 0)
             END AS days_to_deadline
        FROM abertos a
       WHERE a.categories_open > 0
          OR a.status IN ('sorteado', 'a_decorrer')   -- estes entram sem vagas
       LIMIT GREATEST(COALESCE(p_limit, 20), 1)
    ) x;
$$;

-- ── Quem pode chamar ──────────────────────────────────────────────────────
-- Aberta a quem não tem conta, como a página do torneio. É o ponto todo.
REVOKE ALL ON FUNCTION tournament_category_spots(UUID) FROM public;
REVOKE ALL ON FUNCTION list_open_tournaments(INTEGER, UUID, BOOLEAN) FROM public;
GRANT EXECUTE ON FUNCTION tournament_category_spots(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION list_open_tournaments(INTEGER, UUID, BOOLEAN) TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- SE ALGUÉM PRECISAR DE MUDAR A ASSINATURA, LER ISTO PRIMEIRO
-- ═════════════════════════════════════════════════════════════════════════
-- Esta função tem três argumentos com valor por omissão. Acrescentar um
-- quarto com `CREATE OR REPLACE` **não substitui** a antiga: cria uma segunda
-- versão, e a partir daí qualquer chamada que sirva as duas rebenta com
-- `PGRST203` — HTTP 300, antes mesmo de verificar permissões.
--
-- Foi exactamente isso que partiu a `mark_walkover` a 23 set (cartão #465).
-- Quem mudar a assinatura tem de apagar a antiga pelo nome completo, na
-- mesma migração:
--
--   DROP FUNCTION IF EXISTS list_open_tournaments(INTEGER, UUID, BOOLEAN);
--
-- E confirmar no fim que ficou uma só:
--
--   SELECT pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'list_open_tournaments';

-- ═════════════════════════════════════════════════════════════════════════
-- COMO CONFIRMAR QUE FICOU BEM
-- ═════════════════════════════════════════════════════════════════════════
--   SELECT jsonb_pretty(list_open_tournaments(5));
--
-- E o que mais importa, porque é o ponto desta função — que responde a quem
-- não tem conta:
--   SET LOCAL ROLE anon;
--   SELECT jsonb_array_length(list_open_tournaments(5));
--   RESET ROLE;
