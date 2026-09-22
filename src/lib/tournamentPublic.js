/* O que vê quem chega de fora (Trello #363).

   Quase toda a gente chega ao torneio por um link do WhatsApp, sem conta.
   Vê tudo menos o botão de inscrever: cartaz, categorias com dia, hora e
   vagas, o formato em linguagem de jogador, quem já se inscreveu, prémios,
   mapa e quem organiza (SPEC §4.10).

   Aqui só a parte pura — as frases e as contas. Quem as mostra é
   components/tournament/PublicInfo.jsx. */

import { slotsLeft } from './tournamentSignup'

/* O formato dito como um jogador o diria, não como está na base de dados.
   Devolve a chave de tradução e os números; quem traduz é o ecrã.
   Sem formato escolhido (ainda não fecharam as inscrições) diz-se isso,
   em vez de inventar. */
export function formatWords(category) {
  const f = category?.format
  if (!f || (!f.groups && !f.knockout_size)) return { key: 'tpublic.format_unknown', values: {} }
  if (f.groups > 0) {
    return {
      key: 'tpublic.format_groups',
      values: { groups: f.groups, qualifiers: f.qualifiers_per_group || 1 },
    }
  }
  return { key: 'tpublic.format_knockout', values: { teams: f.knockout_size } }
}

/* "Sábado, a partir das 12h" — dia e hora de começo da categoria.
   Sem dia marcado devolve null, e o ecrã não mostra linha nenhuma. */
export function categoryWhen(category, locale = 'pt-PT') {
  if (!category?.day_date) return null
  const day = new Date(`${category.day_date}T12:00:00`)
  const weekday = day.toLocaleDateString(locale, { weekday: 'long' })
  const name = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  if (!category.start_time) return name
  const [h, m] = String(category.start_time).split(':')
  const hour = Number(m) && Number(m) > 0 ? `${Number(h)}h${m}` : `${Number(h)}h`
  return { day: name, hour }
}

/* A linha das vagas: um número, "Cheia", ou nada quando não há lotação. */
export function slotsWords(category) {
  const left = slotsLeft(category)
  if (left == null) return null
  return left === 0 ? { key: 'tsignup.category_full', values: {} } : { key: 'tsignup.category_slots', values: { count: left } }
}

/* O endereço que vai para cartazes e para o WhatsApp: curto, legível e
   estável (SPEC §4.10). */
export const tournamentUrl = (tournament, origin) => `${origin}/torneio/${tournament?.slug || tournament?.id || ''}`

export function shareMessage(tournament, origin) {
  const when = [tournament?.starts_on, tournament?.ends_on].filter(Boolean)
  const dates = when.length === 2 && when[0] !== when[1]
    ? `${when[0].slice(8, 10)}–${when[1].slice(8, 10)}`
    : (when[0] || '').slice(8, 10)
  return [
    tournament?.name,
    [dates, tournament?.club_name].filter(Boolean).join(' · '),
    tournamentUrl(tournament, origin),
  ].filter(Boolean).join('\n')
}
