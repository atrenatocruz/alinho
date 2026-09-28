// Mix em rascunho (Trello #544; desenho aprovado a 25 set em
// design-handoff/2026-09-24-mix-em-rascunho/SPEC.md).
//
// Um rascunho é um mix com status `draft`: só os admins do clube/grupo o
// veem e ninguém se inscreve (garantido na base de dados,
// migration_mix_draft.sql). É um estado à parte do `pending` das séries,
// porque o cron abre os `pending` sozinho e um rascunho nunca abre sozinho.
//
// Série criada em rascunho: a regra da série fica gravada, mas a data
// seguinte só se prepara quando o rascunho é publicado (PO, 25 set).
// Publicar faz o mesmo que criar um mix aberto hoje — o robô anuncia-o,
// porque só olha para `open`.
import { supabase } from './supabase'

export const DRAFT = 'draft'
export const isDraftMix = (game) => game?.status === DRAFT

/** A data a seguir numa série — a mesma conta do cron
 *  (process_due_game_recurrences). */
export function advanceByFrequency(date, frequency) {
  const d = new Date(date)
  if (frequency === 'daily') d.setDate(d.getDate() + 1)
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7)
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1)
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1)
  return d
}

/** O próximo mix de uma série a partir da linha de game_recurrences, com a
 *  regra «termina» do cron: depois da data de fim, ou já com as vezes todas
 *  criadas, não há próximo. */
export function nextOccurrencePlan(gameDate, recurrence) {
  const nextDate = advanceByFrequency(new Date(gameDate), recurrence.frequency)
  const created = recurrence.occurrences_created ?? 1
  const pastEnd =
    (recurrence.ends_type === 'on_date' && recurrence.ends_on && nextDate > new Date(recurrence.ends_on)) ||
    (recurrence.ends_type === 'after_occurrences' && created >= Number(recurrence.ends_after_occurrences))
  const launchAt = new Date(nextDate.getTime() - (recurrence.mix_offset_seconds || 0) * 1000)
  return { nextDate, launchAt, pastEnd }
}

/** A linha do próximo mix de uma série (`pending`), igual à que o cron cria:
 *  as mesmas escolhas do mix de origem. As colunas opcionais só vão quando
 *  não são o valor por omissão, para não rebentar antes das migrações que
 *  as criam. */
export function pendingOccurrenceRow(game, { nextDate, launchAt, userId, recurrenceId, organizationId }) {
  return {
    organization_id: organizationId || game.organization_id,
    title: game.title,
    date: nextDate.toISOString(),
    location: game.location,
    price_per_player: game.price_per_player,
    prize: game.prize,
    has_voucher: game.has_voucher,
    num_courts: game.num_courts,
    max_players: (game.num_courts || 1) * 4,
    court_time_minutes: game.court_time_minutes,
    game_time_minutes: game.game_time_minutes,
    format: game.format,
    gender_restriction: game.gender_restriction,
    age_restriction: game.age_restriction ?? null,
    level: game.level,
    auto_start_hours_before: game.auto_start_hours_before,
    ...(game.pairing_mode && game.pairing_mode !== 'por_nivel' ? { pairing_mode: game.pairing_mode } : {}),
    ...(game.rotate_partners ? { rotate_partners: true } : {}),
    ...(game.ranked === false ? { ranked: false } : {}),
    ...(game.allow_pair_signup ? { allow_pair_signup: true } : {}),
    // A contagem, o tamanho dos grupos e o 8-8 (#580) — só quando não são
    // os de omissão, como os outros acima.
    ...(game.scoring_format && game.scoring_format !== 'pontos_simples' ? { scoring_format: game.scoring_format } : {}),
    ...(game.format === 'grupos_eliminatorias' && game.pool_size ? { pool_size: game.pool_size } : {}),
    ...(game.tiebreak_8_8 === 'super_tiebreak' ? { tiebreak_8_8: 'super_tiebreak' } : {}),
    status: 'pending',
    created_by: userId,
    recurrence_id: recurrenceId,
    is_recurrence_origin: false,
    launch_at: launchAt.toISOString(),
  }
}

/** A regra da série de um rascunho (para a pergunta «Abrem as inscrições»
 *  ao publicar): a frequência e os segundos entre a abertura e o mix. */
export async function draftRecurrence(recurrenceId) {
  if (!recurrenceId) return null
  const { data, error } = await supabase
    .from('game_recurrences').select('id, frequency, mix_offset_seconds').eq('id', recurrenceId).single()
  if (error) throw error
  return data
}

/** Publica um rascunho: passa a `open` (o robô anuncia) e, se for o início
 *  de uma série, prepara a data seguinte como `pending`, como faz o criar
 *  de hoje. Devolve o mix publicado. Um erro de limite do plano vem da
 *  política de UPDATE e sobe tal e qual, para o ecrã o explicar.
 *
 *  «Abrem as inscrições» ao publicar (Francisco, 28 set): com `launchAt` no
 *  futuro fica `pending` com launch_at e abre sozinho a essa hora, como o
 *  mix único; numa série, `offsetSeconds` passa a ser a regra das datas
 *  seguintes (mix_offset_seconds, a do process_due_game_recurrences). */
export async function publishDraftMix(game, userId, { launchAt = null, offsetSeconds = null } = {}) {
  const later = launchAt && launchAt.getTime() > Date.now()
  const { data, error } = await supabase
    .from('games')
    .update(later ? { status: 'pending', launch_at: launchAt.toISOString() } : { status: 'open' })
    .eq('id', game.id)
    .eq('status', DRAFT)
    .select()
  if (error) throw error
  const published = data?.[0]
  if (!published) throw new Error('not_a_draft')

  if (!published.recurrence_id || !published.is_recurrence_origin) return published

  const { data: recurrence, error: recError } = await supabase
    .from('game_recurrences')
    .select('id, is_active, frequency, ends_type, ends_on, ends_after_occurrences, occurrences_created, mix_offset_seconds')
    .eq('id', published.recurrence_id)
    .single()
  if (recError) throw recError
  if (!recurrence?.is_active) return published
  if (offsetSeconds != null && offsetSeconds !== recurrence.mix_offset_seconds) {
    const { error: offError } = await supabase
      .from('game_recurrences').update({ mix_offset_seconds: offsetSeconds }).eq('id', recurrence.id)
    if (offError) throw offError
    recurrence.mix_offset_seconds = offsetSeconds
  }

  // Já existe o próximo? Então não se cria outro (publicar duas vezes, ou
  // alguém que o criou à mão).
  const { count } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('recurrence_id', recurrence.id)
    .eq('status', 'pending')
  if (count > 0) return published

  const plan = nextOccurrencePlan(published.date, recurrence)
  if (plan.pastEnd) {
    await supabase.from('game_recurrences').update({ is_active: false }).eq('id', recurrence.id)
    return published
  }

  const { error: pendingError } = await supabase
    .from('games')
    .insert([pendingOccurrenceRow(published, { ...plan, userId, recurrenceId: recurrence.id })])
  if (pendingError) throw pendingError

  await supabase
    .from('game_recurrences')
    .update({ occurrences_created: (recurrence.occurrences_created ?? 1) + 1 })
    .eq('id', recurrence.id)
  return published
}
