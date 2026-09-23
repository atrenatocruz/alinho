// A linha de um torneio com inscrições abertas (Trello #462).
//
// Vive num ficheiro só porque aparece em dois sítios — a Comunidade e a Home
// de quem ainda não é membro de nada — e as duas têm de dizer o mesmo com as
// mesmas palavras. Um torneio aberto é a única coisa na app a que alguém de
// fora chega sem pedir licença a ninguém.
//
// ⚠️ DOIS CUIDADOS DO CONTRATO (`list_open_tournaments`), que dão bug
// silencioso se se esquecerem:
//   · `spots_left` a null quer dizer SEM LIMITE de vagas, e não zero — um
//     `if (!spots_left)` esconde torneios abertos;
//   · `days_to_deadline` já vem arredondado para cima (hoje ao fim do dia dá
//     1, não 0), por isso não se volta a arredondar.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '../ui'

/** «9–11 out» quando é tudo no mesmo mês, «30 set – 2 out» quando não é. A
 *  mesma regra da página do torneio, para as datas se lerem igual nos dois
 *  sítios. */
export function tournamentWhen(x, locale) {
  if (!x?.starts_on) return ''
  const a = new Date(`${x.starts_on}T12:00`)
  const b = x.ends_on ? new Date(`${x.ends_on}T12:00`) : a
  const month = (d) => d.toLocaleDateString(locale, { month: 'short' }).replace('.', '')
  if (a.getTime() === b.getTime()) return `${a.getDate()} ${month(a)}`
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${month(b)}`
  return `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`
}

export default function OpenTournamentRow({ tournament: x }) {
  const { t, i18n } = useTranslation()
  return (
    <Link to={`/torneio/${x.slug || x.id}`}
      className="flex items-center gap-3 rounded-card border border-line bg-canvas p-3 hover:bg-ink-50/40">
      <Avatar name={x.club_name} url={x.club_logo_url} size="w-11 h-11 text-sm" shape="rounded-xl" />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] text-ink-900">{x.name}</b>
        <span className="block truncate text-[12px] text-muted">
          {[x.club_name || x.location, tournamentWhen(x, i18n.language)].filter(Boolean).join(' · ')}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-ink-900 px-2 py-[2px] text-[10px] font-bold text-white">{t('comunidade.tournament_tag')}</span>
          {x.categories_open > 0 && (
            <span className="text-[11px] text-muted">{t('comunidade.tournament_categories', { count: x.categories_open })}</span>
          )}
          {Number.isFinite(x.days_to_deadline) && x.days_to_deadline >= 0 && (
            <span className="text-[11px] font-semibold text-ink-700">{t('comunidade.tournament_deadline', { count: x.days_to_deadline })}</span>
          )}
          {x.spots_left != null && x.spots_left <= 6 && (
            <span className="text-[11px] font-semibold text-ink-700">{t('comunidade.tournament_spots', { count: x.spots_left })}</span>
          )}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </Link>
  )
}
