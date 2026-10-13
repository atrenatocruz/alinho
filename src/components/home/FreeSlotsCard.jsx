// Os horários livres de um dia, numa linha só (Home do futuro, SPEC-4 —
// aprovado pelo Francisco a 9 out): cartão tracejado salmão claro, o clube,
// «N horários livres», o preço e «toca numa hora para abrires um jogo», e as
// horas em pastilhas (com «+N» quando não cabem). Com vários clubes no mesmo
// dia, «N horários livres hoje, em M clubes» e uma pastilha por clube: tocar
// num clube mostra as horas dele.
// R1 (13 out): o cartão branco com o tracejado salmão do protótipo, a faixa
// «HORÁRIOS LIVRES · N HORAS» em cima, o clube, «Campos livres hoje», o preço
// e uma pastilha por hora.
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

function ClubHead({ club, title, sub }) {
  return (
    <div>
      <span className="inline-flex max-w-full items-center gap-2 py-1 font-display text-[13.5px] font-bold leading-none text-ink-900">
        {club.orgLogo
          ? <img src={club.orgLogo} alt="" className="h-6 w-6 flex-none rounded-full object-cover" />
          : <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-ink-900 text-[9.5px] font-extrabold text-lime-400">{initials(club.orgName)}</span>}
        <span className="truncate">{club.orgName}</span>
      </span>
      {title && <b className="mt-1 block font-display text-[16px] font-extrabold leading-[1.2] text-ink-900">{title}</b>}
      {sub && <small className="mt-[3px] block text-[12.5px] leading-[1.4] text-[#5B6068]">{sub}</small>}
    </div>
  )
}

/** O cartão branco com o tracejado e a faixa «HORÁRIOS LIVRES · N HORAS». */
function Shell({ count, children }) {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded-[20px] border-[1.5px] border-dashed border-[#F2BFA8] bg-white">
      <div className="flex justify-between bg-[#FFF1EA] px-3.5 py-[9px] font-mono text-[10.5px] font-medium uppercase leading-none tracking-[.1em] text-[#C2410C]">
        <span>{t('homecard.free_band')}</span>
        <span>{t('homecard.free_hours', { count })}</span>
      </div>
      <div className="px-3.5 pb-3.5 pt-2.5">{children}</div>
    </div>
  )
}

export default function FreeSlotsCard({ event, isToday, onPick }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(null)
  const sub = (club) => [club.price != null ? t('home.free_price', { price: formatCurrency(club.price, i18n.language) }) : null, t('home.free_tap')].filter(Boolean).join(' · ')

  if (event.clubs.length === 1) {
    const club = event.clubs[0]
    return (
      <Shell count={club.slots.length}>
        <ClubHead club={club} title={t(isToday ? 'homecard.free_title_today' : 'homecard.free_title')} sub={sub(club)} />
        <ClubHours club={club} onPick={onPick} />
      </Shell>
    )
  }
  const chosen = event.clubs.find((c) => (c.orgId || c.orgName) === open) || null
  return (
    <Shell count={event.count}>
      <p className="font-display text-[16px] font-extrabold leading-[1.2] text-ink-900">
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
          <ClubHead club={chosen} sub={`${t('home.free_count', { count: chosen.slots.length })} · ${sub(chosen)}`} />
          <ClubHours club={chosen} onPick={onPick} />
        </div>
      )}
    </Shell>
  )
}
