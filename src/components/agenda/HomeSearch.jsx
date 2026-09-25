/* Procurar um evento na Home (Trello #547). Desenho aprovado pelo Francisco
   a 25 set: design-handoff/2026-09-25-home-pesquisa/.

   - Procura no nome do evento, no nome do clube/grupo e no sítio, sem
     acentos nem maiúsculas (semAcentos).
   - Cada resultado mostra o dia em grande à esquerda — é o que distingue sete
     «+1 Mix de Segunda-feira».
   - «Para vir» primeiro; por baixo, a cinzento, «Já jogaste»: só os eventos
     em que a pessoa esteve (a lista que recebe já vem filtrada assim pelo
     applyFilters — os passados de outros não aparecem).
   - Respeita os filtros ativos e diz que está a procurar só em parte. */
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { semAcentos } from '../../lib/semAcentos'
import { formatDate, formatTime } from '../../lib/formatDate'

const eventTitle = (e) => e.raw?.title || e.raw?.name || e.raw?.tournament_name || ''
const eventPlace = (e) => e.raw?.location || e.courtName || ''

/** O evento tem a pesquisa no nome, no clube/grupo ou no sítio? */
export const eventMatches = (e, query) => {
  const q = semAcentos(query).trim()
  if (!q) return true
  return [eventTitle(e), e.orgName, eventPlace(e)].some((s) => semAcentos(s).includes(q))
}

// O pedaço que bate com a pesquisa, realçado. NFD + tirar os acentos não muda
// o número de letras de um nome já composto, por isso as posições batem.
function Realce({ text, query }) {
  const q = semAcentos(query).trim()
  const i = q ? semAcentos(text).indexOf(q) : -1
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-lime-100 text-ink-900 rounded-sm px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

export default function HomeSearch({ events, query, todayKey, filtersActive, filtersLabel, onSearchAll, onClear, linkFor, results }) {
  const { t, i18n } = useTranslation()
  const found = events.filter((e) => e.dayKey && eventMatches(e, query))
  const past = (e) => e.finished || e.dayKey < todayKey
  const upcoming = found.filter((e) => !past(e)).sort((a, b) => a.startsAt - b.startsAt)
  const played = found.filter(past).sort((a, b) => b.startsAt - a.startsAt)

  const row = (e, isPast) => {
    const d = e.startsAt
    const weekday = formatDate(d, i18n.language, { weekday: 'short' }).replace('.', '').slice(0, 3).toUpperCase()
    const title = eventTitle(e) || e.orgName || ''
    const result = results?.get?.(e.id)
    const extra = isPast
      ? (result?.mix_won ? t('agenda.search_won') : t('agenda.search_played'))
      : e.hasTime ? formatTime(d, i18n.language, { hour: '2-digit', minute: '2-digit' }) : null
    const sub = [e.orgName, eventPlace(e) && eventPlace(e) !== e.orgName ? eventPlace(e) : null, extra].filter(Boolean)
    const to = linkFor(e)
    const content = (
      <>
        <span className={`w-12 shrink-0 rounded-ctrl flex flex-col items-center justify-center py-1.5 ${isPast ? 'bg-ink-50 text-muted' : 'bg-sky-100 text-sky-900'}`}>
          <span className="text-lg font-extrabold leading-none tabular-nums">{d.getDate()}</span>
          <span className="text-[10px] font-extrabold tracking-wider mt-0.5">{weekday}</span>
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-start justify-between gap-2">
            <span className={`text-[15px] font-extrabold leading-snug ${isPast ? 'text-ink-700' : 'text-ink-900'}`}>
              <Realce text={title} query={query} />
            </span>
            {!isPast && e.myState === 'in' && (
              <span className="shrink-0 rounded-full bg-ok text-white px-2 py-[3px] text-[11px] font-extrabold">✓ {t('agenda.state_in')}</span>
            )}
          </span>
          <span className="block text-xs text-muted mt-0.5 truncate">
            {sub.map((s, i) => (
              <span key={i}>{i > 0 && ' · '}<Realce text={String(s)} query={query} /></span>
            ))}
          </span>
        </span>
      </>
    )
    const cls = 'flex items-center gap-3 py-2.5 border-b border-line/70 last:border-0'
    return to
      ? <Link key={e.key} to={to} className={`${cls} hover:bg-ink-50/60`}>{content}</Link>
      : <div key={e.key} className={cls}>{content}</div>
  }

  return (
    <div className="mt-3 space-y-4">
      {filtersActive && (
        <p className="text-sm text-muted px-3 py-2 rounded-card border border-dashed border-line">
          {t('agenda.search_filtered', { what: filtersLabel })}{' '}
          <button type="button" onClick={onSearchAll} className="font-extrabold text-ink-900 underline underline-offset-2">
            {t('agenda.search_all')}
          </button>
        </p>
      )}

      {found.length === 0 ? (
        <div className="text-center py-10 px-4">
          <SearchX size={28} className="mx-auto text-muted" />
          <p className="mt-3 font-extrabold text-ink-900">{t('agenda.search_none_title', { q: query.trim() })}</p>
          <p className="text-sm text-muted mt-1">{t('agenda.search_none_hint')}</p>
          <button type="button" onClick={filtersActive ? onSearchAll : onClear}
            className="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-full border border-line bg-canvas text-sm font-extrabold text-ink-900">
            {t(filtersActive ? 'agenda.search_all' : 'agenda.search_clear')}
          </button>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-1">{t('agenda.search_upcoming', { count: upcoming.length })}</p>
              <div>{upcoming.map((e) => row(e, false))}</div>
            </section>
          )}
          {played.length > 0 && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-1">{t('agenda.search_past', { count: played.length })}</p>
              <div>{played.map((e) => row(e, true))}</div>
            </section>
          )}
        </>
      )}
      <div className="h-[30vh]" aria-hidden="true" />
    </div>
  )
}
