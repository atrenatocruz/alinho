-- ════════════════════════════════════════════════════════════════════════
-- Migration: só membros do grupo podem ser inscritos pelo admin
-- (Trello #534 — plano aprovado pelo Francisco a 24 set 2026).
-- PROPOSTA, POR ACORDAR COM O RENATO: mexe na política dos admins em
-- `participants`, que vem da migração multi-tenant.
--
-- O que faz: a política FOR ALL «Org admins can manage participants»
-- divide-se em quatro. Ver, mudar e tirar ficam exatamente como estavam
-- (nada trava tirar pessoas nem mexer em quem já lá está). Só o INSERIR do
-- admin ganha uma trava: a pessoa — e o parceiro, se houver — tem de ser
-- membro do clube/grupo do mix. Convidados (is_guest), contas de teste e
-- contas por reclamar são membros, por isso passam. O sexo e a idade do mix
-- NÃO travam o admin: decisão do Francisco (24 set), igual ao «Adicionar
-- jogador» do #292 — o ecrã avisa, o admin decide. Um jogador normal
-- continua a só poder inscrever-se a si próprio (política «Users can join
-- games in their org», que não muda).
--
-- Independente de migration_mix_notices_open_mix.sql (a outra metade do
-- #534, que avisa a pessoa inscrita) — podem correr em qualquer ordem.
-- Quem inscreveu já fica registado hoje, sem nada novo:
-- participant_events.actor_id (trigger log_participant_event).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Tudo numa transação: entre o DROP da política antiga e a criação das
-- novas, os admins não podem ficar um instante sem política.
BEGIN;

-- ── 1. Políticas dos admins em participants ───────────────────────────────
DROP POLICY IF EXISTS "Org admins can manage participants" ON participants;
DROP POLICY IF EXISTS "Org admins can view participants" ON participants;
DROP POLICY IF EXISTS "Org admins can update participants" ON participants;
DROP POLICY IF EXISTS "Org admins can remove participants" ON participants;
DROP POLICY IF EXISTS "Org admins can add members to their games" ON participants;

CREATE POLICY "Org admins can view participants"
  ON participants FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = participants.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can update participants"
  ON participants FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = participants.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = participants.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can remove participants"
  ON participants FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = participants.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can add members to their games"
  ON participants FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
      WHERE games.id = participants.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
    )
    AND EXISTS (
      SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
      WHERE games.id = participants.game_id AND memberships.user_id = participants.user_id
    )
    AND (
      participants.partner_id IS NULL
      OR EXISTS (
        SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
        WHERE games.id = participants.game_id AND memberships.user_id = participants.partner_id
      )
    )
  );

COMMIT;
