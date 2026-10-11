// Os horários livres de um dia, numa linha só (Home do futuro, SPEC-4 —
// aprovado pelo Francisco a 9 out): cartão tracejado salmão claro, o clube,
// «N horários livres», o preço e «toca numa hora para abrires um jogo», e as
// horas em pastilhas (com «+N» quando não cabem). Com vários clubes no mesmo
// dia, «N horários livres hoje, em M clubes» e uma pastilha por clube: tocar
// num clube mostra as horas dele.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTime, formatCurrency } from '../../lib/formatDate'

const SHOW = 7

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

function ClubHours({ club, onPick }) {
  const { t, i18n } = useTranslation()
  const [all, setAll] = useState(false)
  const hours = all ? club.slots : club.slots.slice(0, SHOW)
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {hours.map((s) => (
        <button key={s.key} type="button" onClick={() => onPick(club, s)}
          className="press h-[34px] rounded-[10px] border border-[#F2BFA8] bg-white px-[11px] font-mono text-[12.5px] font-extrabold text-ink-900">
          {formatTime(s.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })}
        </button>
      ))}
      {!all && club.slots.length > SHOW && (
        <button type="button" onClick={() => setAll(true)} aria-label={t('home.free_more', { count: club.slots.length - SHOW })}
          className="press h-[34px] rounded-[10px] border border-[#F2BFA8] bg-white px-[11px] text-[12.5px] font-extrabold text-ink-700">
          +{club.slots.length - SHOW}
        </button>
      )}
    </div>
  )
}

function ClubHead({ club, count, sub }) {
  return (
    <div className="flex items-center gap-2.5">
      {club.orgLogo
        ? <img src={club.orgLogo} alt="" className="h-[30px] w-[30px] shrink-0 rounded-full object-cover" />
        : <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10px] font-extrabold text-lime-400">{initials(club.orgName)}</span>}
      <span className="min-w-0">
        <b className="block truncate text-[13.5px] font-extrabold text-ink-900">{club.orgName} · {count}</b>
        {sub && <small className="block text-[11.5px] font-semibold text-muted">{sub}</small>}
      </span>
    </div>
  )
}

export default function FreeSlotsCard({ event, isToday, onPick }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(null)
  const sub = (club) => [club.price != null ? t('home.free_price', { price: formatCurrency(club.price, i18n.language) }) : null, t('home.free_tap')].filter(Boolean).join(' · ')
  const box = 'rounded-[18px] border-[1.5px] border-dashed border-[#F2BFA8] bg-[#FFF8F5] p-3'

  if (event.clubs.length === 1) {
    const club = event.clubs[0]
    return (
      <div className={box}>
        <ClubHead club={club} count={t('home.free_count', { count: club.slots.length })} sub={sub(club)} />
        <ClubHours club={club} onPick={onPick} />
      </div>
    )
  }
  const chosen = event.clubs.find((c) => (c.orgId || c.orgName) === open) || null
  return (
    <div className={box}>
      <p className="text-[13.5px] font-extrabold text-ink-900">
        {t(isToday ? 'home.free_many_today' : 'home.free_many_day', { count: event.count, clubs: event.clubs.length })}
      </p>
      <p className="text-[11.5px] font-semibold text-muted">{t('home.free_tap_club')}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {event.clubs.map((c) => {
          const k = c.orgId || c.orgName
          const on = k === open
          return (
            <button key={k} type="button" onClick={() => setOpen(on ? null : k)} aria-pressed={on}
              className={`press h-[34px] rounded-full border px-3 text-[12.5px] font-extrabold ${on ? 'border-ink-900 bg-ink-900 text-white' : 'border-[#F2BFA8] bg-white text-ink-900'}`}>
              {t('home.free_club_pill', { name: c.orgName, count: c.slots.length })}
            </button>
          )
        })}
      </div>
      {chosen && (
        <div className="mt-3 border-t border-[#F2BFA8]/60 pt-3">
          <ClubHead club={chosen} count={t('home.free_count', { count: chosen.slots.length })} sub={sub(chosen)} />
          <ClubHours club={chosen} onPick={onPick} />
        </div>
      )}
    </div>
  )
}
