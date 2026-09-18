-- ════════════════════════════════════════════════════════════════════════
-- Migration: a próxima ocorrência de um mix recorrente não conta para o
-- limite de mixes ativos do plano (Trello #307).
--
-- Francisco, 18 set 2026: "o mix era recorrente. não é mais um mix. é o
-- mesmo". Proposta do Dev 2, por acordar com o Renato.
--
-- O problema (visto nos logs de produção, 18 set 14:59 UTC, grupo Free):
-- ligar "Mix recorrente" cria o mix e, logo a seguir, a próxima ocorrência
-- com status 'pending'. A policy de INSERT aplicava o limite de mixes ativos
-- a TODAS as linhas novas — com 1 mix aberto e limite 1 (Free), a linha
-- 'pending' era recusada ("new row violates row-level security policy") e
-- a app mostrava "não tens permissão". Em qualquer grupo Free, o "Mix
-- recorrente" falhava sempre. A policy de UPDATE tinha o mesmo defeito ao
-- editar essa ocorrência pendente.
--
-- self_serve_active_mix_count() já não conta linhas 'pending'
-- (migration_recurring_mix_everywhere.sql); aqui as duas policies deixam de
-- aplicar o limite de mixes à própria linha quando ela é 'pending'. O limite
-- de campos continua a valer para todas. Uma ocorrência pendente só abre
-- pelo process_due_game_recurrences, que espera que o mix anterior da série
-- acabe — a série continua a ter um mix aberto de cada vez.
--
-- Mesmas policies de migration_plan_limits.sql (confirmadas iguais às que
-- estão em produção a 18 set); só muda o que está marcado com "← novo".
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Org admins can create games" ON games;
CREATE POLICY "Org admins can create games"
  ON games FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin
    )
    AND (
      org_max_courts(games.organization_id) IS NULL
      OR num_courts <= org_max_courts(games.organization_id)
    )
    AND (
      org_max_active_mixes(games.organization_id) IS NULL
      OR COALESCE(games.status, 'open') = 'pending'   -- ← novo
      OR self_serve_active_mix_count(games.organization_id) < org_max_active_mixes(games.organization_id)
    )
  );

DROP POLICY IF EXISTS "Org admins can update games" ON games;
CREATE POLICY "Org admins can update games"
  ON games FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin
    )
    AND (
      org_max_courts(games.organization_id) IS NULL
      OR num_courts <= org_max_courts(games.organization_id)
    )
    AND (
      org_max_active_mixes(games.organization_id) IS NULL
      OR (
        self_serve_active_mix_count(games.organization_id, games.id)
        -- ← novo: 'pending' também não conta, como 'finished'/'cancelled'
        + (CASE WHEN COALESCE(games.status, 'open') NOT IN ('finished', 'cancelled', 'pending') THEN 1 ELSE 0 END)
      ) <= org_max_active_mixes(games.organization_id)
    )
  );

-- ── Revisão (Renato) ──────────────────────────────────────────────────────
-- Séries que ficaram sem a próxima ocorrência por causa deste erro (mix de
-- origem ligado a uma série ativa, sem nenhuma linha 'pending'):
-- SELECT o.name, g.title, g.date, r.id AS recurrence_id
-- FROM game_recurrences r
-- JOIN games g ON g.recurrence_id = r.id AND g.is_recurrence_origin
-- JOIN organizations o ON o.id = r.organization_id
-- WHERE r.is_active
--   AND NOT EXISTS (SELECT 1 FROM games p WHERE p.recurrence_id = r.id AND p.status = 'pending');
-- Para essas: no Gerir, desligar e voltar a ligar o "Mix recorrente" do mix.
