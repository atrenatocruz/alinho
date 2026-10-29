// «Pedir correção» nos mixes (Francisco, 23 out; design-handoff/2026-10-23-
// mix-pedir-correcao): quem jogou pede ao organizador o resultado certo de um
// jogo e o organizador aceita ou recusa. Base do Dev 3
// (migration_mix_pedir_correcao.sql). Aceitar faz o mesmo que o «Corrigir
// resultado» de hoje (correct_finished_mix_match ou save_mix_match_result).
import { supabase } from './supabase'

/** Pede a correção. Devolve o id do pedido. */
export async function requestMixCorrection(matchId, { scoreA, scoreB, note = null, sets = null }) {
  const { data, error } = await supabase.rpc('request_mix_match_correction', {
    p_match_id: matchId, p_score_a: scoreA, p_score_b: scoreB, p_note: note, p_sets: sets,
  })
  if (error) throw error
  return data
}

/** O organizador aceita ou recusa. Com o mix terminado, aceitar precisa do
 *  vencedor novo (como o «Corrigir resultado»; no Americano vai null). */
export async function resolveMixCorrection(correctionId, accept, { reason = null, newWinnerTeamId = null } = {}) {
  const { data, error } = await supabase.rpc('resolve_mix_match_correction', {
    p_correction_id: correctionId, p_accept: !!accept, p_reason: reason, p_new_winner_team_id: newWinnerTeamId,
  })
  if (error) throw error
  return data || {}
}

/** Os pedidos do mix (pendentes e já respondidos), para quem vê o mix. */
export async function listMixCorrections(gameId) {
  const { data, error } = await supabase.rpc('list_mix_match_corrections', { p_game_id: gameId })
  if (error) throw error
  return data || []
}

export const MIX_CORRECTION_ERRORS = ['no_session', 'not_found', 'not_scored', 'not_a_player', 'is_organizer', 'too_late',
  'already_requested', 'bad_score', 'same_score', 'draw_not_allowed', 'not_allowed', 'not_pending']

/** O código de erro da base (ou null), para escolher a frase. */
export const mixCorrectionErrorCode = (err) =>
  MIX_CORRECTION_ERRORS.find((c) => String(err?.message || '').includes(c)) || null

/** Por jogo, o pedido (há no máximo um por jogo, para sempre). */
export function correctionsByMatch(list) {
  const out = {}
  for (const c of list || []) out[c.match_id] = c
  return out
}

export const CORRECTION_WINDOW_HOURS = 48

/** Pode pedir a correção deste jogo? Os 4 jogadores com conta, com resultado,
 *  sem pedido nesse jogo, com o mix a decorrer ou até 48 h depois de acabar.
 *  Quem organiza não pede (corrige diretamente). A base volta a verificar. */
export function canAskCorrection({ game, match, isMine, isAdmin, existing, now = Date.now() }) {
  if (!game || !match || isAdmin || !isMine || existing) return false
  if (match.score_a == null || match.score_b == null) return false
  if (game.status === 'in_progress') return true
  if (game.status !== 'finished') return false
  const end = new Date(game.finished_at || game.updated_at || 0).getTime()
  return Number.isFinite(end) && end > 0 && now - end < CORRECTION_WINDOW_HOURS * 3600 * 1000
}
