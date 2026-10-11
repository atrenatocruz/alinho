// «Abrir um jogo no <clube>» (Home do futuro, SPEC-4, ponto 4 — aprovado pelo
// Francisco a 9 out): as horas do dia (a tocada já escolhida; as ocupadas
// riscadas), «Vais com quem?» e «Nível do jogo», e «Abrir jogo às 19:00»
// (lima) com «Ainda não» (contorno) por baixo. Abrir é entrar nesse jogo em
// aberto, como o «Entrar» de hoje. O parceiro e o nível esperam pelos dados do
// Dev 3 (open_slot_join): até lá, as duas filas não aparecem (UX, 11 out —
// nada de opções a cinzento sem explicação).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../agenda/AgendaControls'
import { formatTime } from '../../lib/formatDate'

export default function OpenSlotSheet({ club, picked, busy = false, error = '', onOpen, onClose, partnerReady = false, levelReady = false, levelOptions = [] }) {
  const { t, i18n } = useTranslation()
  const [slot, setSlot] = useState(picked)
  const [withPartner, setWithPartner] = useState(false)
  const [level, setLevel] = useState(levelOptions[1] || levelOptions[0] || null)
  const hhmm = (d) => formatTime(d, i18n.language, { hour: '2-digit', minute: '2-digit' })
  const all = [...club.slots.map((s) => ({ s, free: true })), ...club.taken.map((s) => ({ s, free: false }))]
    .sort((a, b) => a.s.startsAt - b.s.startsAt)
  const chip = (on, disabled = false) => `min-h-[40px] rounded-full border px-3.5 text-sm font-extrabold ${on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white text-ink-900'} ${disabled ? 'opacity-40' : ''}`

  return (
    <Sheet title={t('home.open_title', { club: club.orgName })} onClose={onClose}>
      <p className="-mt-1 text-[13px] text-ink-700">{[club.location, t('home.open_sub')].filter(Boolean).join(' · ')}</p>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {all.map(({ s, free }) => {
          const on = free && slot?.key === s.key
          return (
            <button key={s.key} type="button" disabled={!free} onClick={() => setSlot(s)}
              className={`flex h-[46px] flex-col items-center justify-center rounded-[11px] border font-mono text-[13px] font-extrabold ${on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white text-ink-900'} disabled:text-[#C4C4C4] disabled:line-through`}>
              {hhmm(s.startsAt)}
              {!free && <small className="font-sans text-[9.5px] font-bold text-muted no-underline">{t('home.open_taken')}</small>}
            </button>
          )
        })}
      </div>

      {partnerReady && (
        <>
          <p className="mt-4 text-[13px] font-semibold text-ink-700">{t('home.open_with')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setWithPartner(false)} className={chip(!withPartner)}>{t('home.open_alone')}</button>
            <button type="button" onClick={() => setWithPartner(true)} className={chip(withPartner)}>{t('home.open_partner')}</button>
          </div>
        </>
      )}

      {levelReady && levelOptions.length > 0 && (
        <>
          <p className="mt-4 text-[13px] font-semibold text-ink-700">{t('home.open_level')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {levelOptions.map((l) => (
              <button key={l} type="button" disabled={!levelReady} onClick={() => setLevel(l)} className={chip(level === l, !levelReady)}>{l}</button>
            ))}
          </div>
        </>
      )}

      {error && <p className="mt-3 rounded-ctrl bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
      <div className="mt-5 space-y-2">
        <button type="button" disabled={busy || !slot} onClick={() => onOpen(slot, { withPartner, level })}
          className="press flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-lime-400 px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
          {t('home.open_cta', { time: slot ? hhmm(slot.startsAt) : '' })}
        </button>
        <button type="button" onClick={onClose}
          className="press flex min-h-[52px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-ink-900 bg-white px-4 text-[15px] font-extrabold text-ink-900">
          {t('home.open_not_yet')}
        </button>
      </div>
    </Sheet>
  )
}
