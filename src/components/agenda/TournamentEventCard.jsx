import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy, MapPin, Clock, Megaphone } from 'lucide-react'
import { Avatar } from '../ui'

/* O torneio na agenda da Home (Trello #363).

   Dois cartões, conforme o momento (SPEC §3 e print 04):
   • antes do sorteio, o cartão do torneio — datas, clube, categorias e o
     ponto em que está a minha inscrição;
   • depois do sorteio, um cartão por jogo meu — hora prevista, campo,
     categoria e contra quem, com o "era 17:00" quando a hora foi
     antecipada.

   Lilás, como manda o sistema de cores (KIND_STYLE.tournament). */

const LILAC = { bg: '#E9E7FB', border: '#C9C3F3', ink: '#4338A8' }

const STATE_KEY = {
  convite: 'tsignup.state_waiting_partner',
  sem_parceiro: 'tsignup.state_alone',
  por_validar: 'tsignup.state_to_validate',
  validada: 'tsignup.state_in',
  selecionada: 'tsignup.state_in',
  suplente: 'tsignup.state_waitlist',
}

const hhmm = (date, language) =>
  new Date(date).toLocaleTimeString(language === 'en' ? 'en-GB' : 'pt-PT', { hour: '2-digit', minute: '2-digit' })

export default function TournamentEventCard({ event, past }) {
  const { t, i18n } = useTranslation()
  const isMatch = event.source === 'tournament_match'
  const to = `/torneio/${event.slug || event.id}`

  return (
    <Link
      to={to}
      className={`card press block hover:shadow-lift ${past ? 'opacity-60' : ''}`}
      style={{ background: LILAC.bg, borderColor: LILAC.border, borderWidth: 2 }}
    >
      {/* O aviso do organizador vem com o cartão, em cima: quem está
          inscrito vê-o na Home sem ter de ir procurar (cartão #366). */}
      {event.notice && (
        <p className="mb-2 flex items-start gap-1.5 rounded-ctrl bg-white/70 px-2.5 py-1.5 text-sm font-extrabold"
           style={{ color: LILAC.ink }}>
          <Megaphone size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{event.notice}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-extrabold"
          style={{ color: LILAC.ink }}
        >
          <Trophy size={13} />
          {isMatch && event.categoryCode
            ? `${t('agenda.kind_tournament')} · ${event.categoryCode}`
            : t('agenda.kind_tournament')}
        </span>
        {!isMatch && event.myState && (
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-extrabold" style={{ color: LILAC.ink }}>
            {t(STATE_KEY[event.myState] || 'tsignup.state_in')}
          </span>
        )}
      </div>

      {/* A hora só existe depois do sorteio; antes é um evento de dias. */}
      {isMatch && event.startsAt ? (
        <p className="mt-2 font-display text-2xl font-extrabold leading-none text-ink-900">
          {hhmm(event.startsAt, i18n.language)}
          {event.previousAt && (
            <span className="ml-2 align-middle text-sm font-semibold text-muted">
              {t('tagenda.was_at', { time: hhmm(event.previousAt, i18n.language) })}
            </span>
          )}
        </p>
      ) : (
        <p className="mt-2 font-display text-lg font-extrabold leading-tight text-ink-900">
          {event.raw?.name}
        </p>
      )}

      {isMatch && event.opponentName && (
        <p className="mt-1 text-sm font-semibold text-ink-900">
          {t('tagenda.against', { name: event.opponentName })}
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        <Avatar name={event.orgName} url={event.orgLogo} size="w-[18px] h-[18px] text-[8px]" />
        <span className="min-w-0 truncate">
          {[
            event.orgName,
            isMatch ? event.courtName : null,
            !isMatch && event.raw?.category_count
              ? t('tagenda.categories', { count: event.raw.category_count })
              : null,
          ].filter(Boolean).join(' · ')}
        </span>
      </div>

      {/* Hora prevista, nunca garantida — a regra da Federação que o
          desenho manda repetir no cartão (SPEC §6). */}
      {isMatch && !past && (
        <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: LILAC.ink }}>
          <Clock size={13} /> {t('tagenda.may_start_earlier')}
        </p>
      )}

      {!isMatch && event.raw?.location && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <MapPin size={13} /> {event.raw.location}
        </p>
      )}
    </Link>
  )
}
