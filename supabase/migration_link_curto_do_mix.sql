-- ═════════════════════════════════════════════════════════════════════════
-- Link curto do mix: alinho.pt/m/<código>
--
-- PORQUÊ. Ideia do Ruben, aprovada pelo Francisco a 6 out (design-handoff/
-- 2026-10-01-mensagens-whatsapp/link-do-mix/): no robô, «🔗 Ver o mix:
-- alinho.pt/m/5560eb12» em vez do endereço comprido. Ecrã e robô: Bugs e
-- Ruben.
--
-- O QUE FAZ. resolve_game_link(p_code) → o id do jogo, ou NULL.
--   · O código são os 8 primeiros caracteres do id do jogo (hexadecimal,
--     sem hífen). 8 e não 6: hoje nenhum dos dois colide, mas com 6 a
--     probabilidade de dois mixes partilharem o código passa a ser real ao
--     fim de uns milhares de mixes (o link deixava de abrir); com 8 fica
--     desprezável durante anos. Maiúsculas e minúsculas valem o mesmo.
--   · Devolve o id SÓ se houver exatamente um jogo com esse começo. Com
--     zero ou mais do que um, NULL: nunca abre o jogo errado.
--   · Funciona sem sessão (o link abre-se antes de entrar), mas só responde
--     a um código de 8 caracteres de cada vez: não lista jogos nem diz nada
--     sobre eles além do id. O que a página mostra depois continua a ser
--     decidido pelas regras de sempre.
--   · Usa o índice da chave (procura por intervalo), não percorre a tabela.
--
-- Dev 3, 6 out 2026 · robô e ecrã: Bugs e Ruben
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_game_link(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code TEXT := lower(btrim(COALESCE(p_code, '')));
  v_ids  UUID[];
BEGIN
  IF v_code !~ '^[0-9a-f]{8}$' THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM games
     WHERE id BETWEEN (v_code || '-0000-0000-0000-000000000000')::uuid
                  AND (v_code || '-ffff-ffff-ffff-ffffffffffff')::uuid
     LIMIT 2
  ) x;
  IF array_length(v_ids, 1) = 1 THEN
    RETURN v_ids[1];
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_game_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_game_link(TEXT) TO anon, authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT resolve_game_link(left(replace(id::text, '-', ''), 8)) = id FROM games LIMIT 1;  -- true
--   SELECT resolve_game_link('zzzzzzzz');  -- NULL
