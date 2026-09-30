import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy, MapPin, Clock, Megaphone } from 'lucide-react'
import { OrgHeader } from './EventCard'

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

/* `footer`: o que vai no fundo do cartão, fora da ligação ao torneio — o
   «Marcar resultados» de quem marca (ScoreTodayCard, 28 set). O corpo fica
   exatamente o mesmo: foi o cartão mudar que o Francisco estranhou. */
export default function TournamentEventCard({ event, past, footer = null }) {
  const { t, i18n } = useTranslation()
  const isMatch = event.source === 'tournament_match'
  const to = `/torneio/${event.slug || event.id}`
  const frame = { background: LILAC.bg, borderColor: LILAC.border, borderWidth: 2 }

  // Cartão com organizador (design-handoff/2026-09-28-cartao-com-organizador,
  // o do Dev 4 no b26fc07a): em cima quem organiza, que abre o perfil do
  // clube; o resto do cartão abre o torneio. O cartão já não é um <Link> por
  // fora — um botão dentro de um link não é válido —, é um Link por baixo de
  // tudo, como no GameEventCard.
  return (
    <div className={`card relative press hover:shadow-lift ${past ? 'opacity-60' : ''}`} style={frame}>
      <Link to={to} className="absolute inset-0 rounded-[inherit]" aria-label={event.raw?.name || event.orgName || ''} />
      <OrgHeader event={event} past={past} />
      {body()}
      {footer && <div className="relative z-[1]">{footer}</div>}
    </div>
  )

  function body() {
    return (<>
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

      {/* Jogo acabado: o resultado, do meu lado primeiro (Trello #508). */}
      {isMatch && event.finished && (event.myScore || event.won != null) && (
        <p className="mt-1 text-sm font-extrabold text-ink-900 tabular-nums">
          {[
            event.myScore,
            event.won != null ? t(event.won ? 'agenda.result_win' : 'agenda.result_loss') : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Quem organiza passou para cima (OrgHeader); aqui fica o campo ou
          o número de categorias. */}
      {(isMatch ? event.courtName : event.raw?.category_count) ? (
        <p className="mt-1.5 truncate text-xs text-muted">
          {isMatch ? event.courtName : t('tagenda.categories', { count: event.raw.category_count })}
        </p>
      ) : null}

      {/* Hora prevista, nunca garantida — a regra da Federação que o
          desenho manda repetir no cartão (SPEC §6). */}
      {isMatch && !past && !event.finished && (
        <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: LILAC.ink }}>
          <Clock size={13} /> {t('tagenda.may_start_earlier')}
        </p>
      )}

      {!isMatch && event.raw?.location && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <MapPin size={13} /> {event.raw.location}
        </p>
      )}
    </>)
  }
}
