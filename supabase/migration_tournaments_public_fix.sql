-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 6: QUEM DESISTIU A MEIO NÃO DESAPARECE DA PÁGINA
-- (Dev 3, 22 set 2026)
--
-- CORRER DEPOIS de `migration_tournaments_base.sql`. Pode-se correr outra
-- vez sem estragar. Muda uma vista, não mexe em dados.
--
-- O PROBLEMA, apanhado num ensaio de ponta a ponta:
-- uma dupla que dá falta de comparência passa a `desistiu` (é a
-- `mark_walkover` a dizer «saiu»), e a vista pública dos inscritos
-- escondia toda a gente em `desistiu` (era o Dev 2 a dizer «não mostrar
-- quem nunca entrou»). As duas leituras são razoáveis; juntas davam um
-- ecrã errado:
--   · a dupla sumia da lista de inscritos,
--   · continuava nos jogos e nos grupos,
--   · e no quadro o adversário aparecia EM BRANCO — logo no jogo que
--     explica por que é que o outro passou.
--
-- A DISTINÇÃO que faltava: `desistiu` está a servir para duas coisas
-- diferentes — «não entrou» (ficou de fora ao fechar as inscrições) e
-- «entrou e saiu» (desistiu ou faltou já com o sorteio feito). Quem nunca
-- entrou não tem nada que fazer na lista; quem entrou e saiu tem de lá
-- estar, senão os jogos dela ficam órfãos.
--
-- Distingue-se sem estado novo: quem entrou está num grupo ou num jogo.
-- Um estado novo obrigaria a mexer nas funções das inscrições (Dev 2) e
-- não se faz isso a 17 dias do torneio.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW tournament_public_entries AS
  SELECT e.id, e.category_id, e.team_name, e.status, e.seed_number, e.waitlist_order,
         p1.name AS player1_name, p1.avatar_url AS player1_avatar,
         COALESCE(p2.name, e.guest_name) AS player2_name,
         p2.avatar_url AS player2_avatar,
         (e.player2_id IS NULL AND e.guest_name IS NOT NULL) AS player2_is_guest,
         -- Para o ecrã poder escrever «desistiu» ao lado do nome em vez de
         -- a fazer desaparecer a meio do torneio.
         (e.status = 'desistiu') AS withdrawn
  FROM tournament_entries e
  JOIN tournament_categories c ON c.id = e.category_id
  JOIN tournament_public t ON t.id = c.tournament_id
  LEFT JOIN profiles p1 ON p1.id = e.player1_id
  LEFT JOIN profiles p2 ON p2.id = e.player2_id
  WHERE e.status <> 'desistiu'
     -- Entrou e saiu: fica, marcada. É o que salva os jogos dela de
     -- ficarem com um adversário em branco.
     OR EXISTS (SELECT 1 FROM tournament_group_teams gt WHERE gt.entry_id = e.id)
     OR EXISTS (SELECT 1 FROM tournament_matches m
                 WHERE m.entry_a_id = e.id OR m.entry_b_id = e.id);

GRANT SELECT ON tournament_public_entries TO anon, authenticated;
