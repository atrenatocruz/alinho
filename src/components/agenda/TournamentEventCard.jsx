import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Megaphone } from 'lucide-react'
import { CardClub } from './EventCard'
import HomeCard, { BandPill, CardTitle, CardChips, CardState, CardFoot, CardButton, kindColorsOf } from './HomeCard'
import { formatDate } from '../../lib/formatDate'

/* O torneio na agenda da Home (Trello #363).

   Dois cartões, conforme o momento (SPEC §3 e print 04):
   • antes do sorteio, o cartão do torneio — datas, clube, categorias e o
     ponto em que está a minha inscrição;
   • depois do sorteio, um cartão por jogo meu — hora prevista, campo,
     categoria e contra quem, com o "era 17:00" quando a hora foi
     antecipada.

   R1 (13 out): a moldura comum dos cartões da Home, na cor do torneio do R0.
   Antes do sorteio não há hora: na faixa vão os dias («17–18 out», «sáb e
   dom»). */

// A inscrição feita fica no canto, curta («✓ Estás dentro»); os outros
// pontos da inscrição são compridos e vão na linha de estado (UX, 10 out —
// «Esta tag não dá», Francisco).
const LINE_KEY = {
  convite: 'agenda.state_line_waiting_partner',
  sem_parceiro: 'agenda.state_line_alone',
  por_validar: 'agenda.state_line_to_validate',
  suplente: 'agenda.state_line_waitlist',
}

const hhmm = (date, language) =>
  new Date(date).toLocaleTimeString(language === 'en' ? 'en-GB' : 'pt-PT', { hour: '2-digit', minute: '2-digit' })

/** «17–18 out» e «sáb e dom» (ou «17 out» e «sáb», num dia só). */
function daysOf(startsAt, endsOn, lang) {
  const a = new Date(startsAt)
  const b = endsOn ? new Date(`${String(endsOn).slice(0, 10)}T12:00:00`) : a
  const mon = (d) => formatDate(d, lang, { month: 'short' }).replace(/\./g, '')
  const wd = (d) => formatDate(d, lang, { weekday: 'short' }).replace(/\./g, '').replace(/-feira$/, '')
  const same = a.toDateString() === b.toDateString()
  const big = same ? `${a.getDate()} ${mon(a)}`
    : a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${mon(b)}` : `${a.getDate()} ${mon(a)}–${b.getDate()} ${mon(b)}`
  const days = Math.round((new Date(b.toDateString()) - new Date(a.toDateString())) / 86400000)
  const aside = same ? wd(a) : days === 1 ? `${wd(a)} e ${wd(b)}` : `${wd(a)} a ${wd(b)}`
  return { big, aside }
}

/* `footer`: o que vai no fundo do cartão, fora da ligação ao torneio — o
   «Marcar resultados» de quem marca (ScoreTodayCard, 28 set). */
export default function TournamentEventCard({ event, past, footer = null }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const isMatch = event.source === 'tournament_match'
  const to = `/torneio/${event.slug || event.id}`
  const done = past || event.finished
  const lineKey = !done && !isMatch ? LINE_KEY[event.myState] : null
  const inside = !isMatch && event.myState && !LINE_KEY[event.myState]
  const pill = done ? <BandPill tone="dark">{t('agenda.state_finished')}</BandPill>
    : inside ? <BandPill>✓ {t('home.next_in')}</BandPill> : null
  const label = [t('agenda.kind_tournament'),
    isMatch ? event.categoryCode : event.raw?.category_count ? t('tagenda.categories', { count: event.raw.category_count }) : null].filter(Boolean).join(' · ')
  const when = isMatch && event.startsAt
    ? { big: hhmm(event.startsAt, i18n.language), aside: event.previousAt ? t('tagenda.was_at', { time: hhmm(event.previousAt, i18n.language) }) : null }
    : daysOf(event.startsAt, event.endsOn, i18n.language)
  const title = isMatch ? (event.opponentName ? t('tagenda.against', { name: event.opponentName }) : event.raw?.name) : event.raw?.name
  const chips = [
    isMatch ? event.courtName : null,
    !isMatch ? event.raw?.location : null,
    isMatch && event.finished ? [event.myScore, event.won != null ? t(event.won ? 'agenda.result_win' : 'agenda.result_loss') : null].filter(Boolean).join(' · ') : null,
  ].filter(Boolean)
  const open = !isMatch && !done && !event.myState && event.raw?.status === 'inscricoes'

  return (
    <div className="space-y-2">
      <HomeCard colors={kindColorsOf('tournament')} label={label} pill={pill} time={when.big} timeAside={when.aside}
        mine={!!inside || (isMatch && !done)} past={past} to={to} ariaLabel={event.raw?.name || event.orgName || ''}>
        {/* O aviso do organizador vem com o cartão, em cima (cartão #366). */}
        {event.notice && (
          <p className="mb-2 flex items-start gap-1.5 rounded-ctrl bg-[#F3EEFF] px-2.5 py-1.5 text-sm font-extrabold text-[#3F1784]">
            <Megaphone size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{event.notice}</span>
          </p>
        )}
        <CardClub event={event} past={past} />
        <CardTitle past={past}>{title}</CardTitle>
        {chips.length > 0 && <CardChips>{chips.join(' · ')}</CardChips>}
        {lineKey && <CardState tone="warn">{t(lineKey)}</CardState>}
        {inside && <CardState tone="ok">{t('home.next_in')}</CardState>}
        {open && <CardState tone="ok">{t('homecard.open')}</CardState>}
        {/* Hora prevista, nunca garantida (SPEC §6). */}
        {isMatch && !done && <p className="mt-2 text-xs text-[#3F1784]">{t('tagenda.may_start_earlier')}</p>}
        {(open || inside) && (
          <CardFoot>
            {open
              ? <CardButton onClick={() => navigate(to)}>{t('homecard.signup_pair')}</CardButton>
              : <span className="pointer-events-none whitespace-nowrap rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white px-[18px] py-[11px] font-display text-[14.5px] font-extrabold leading-none text-ink-900">{t('homecard.see')}</span>}
          </CardFoot>
        )}
      </HomeCard>
      {footer && <div className="relative z-[1]">{footer}</div>}
    </div>
  )
}
