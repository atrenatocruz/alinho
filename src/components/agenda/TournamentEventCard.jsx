import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin, Clock, Megaphone, CheckCircle2 } from 'lucide-react'
import { KindLine, OrgHeader, StateLine, StateTag } from './EventCard'

/* O torneio na agenda da Home (Trello #363).

   Dois cartões, conforme o momento (SPEC §3 e print 04):
   • antes do sorteio, o cartão do torneio — datas, clube, categorias e o
     ponto em que está a minha inscrição;
   • depois do sorteio, um cartão por jogo meu — hora prevista, campo,
     categoria e contra quem, com o "era 17:00" quando a hora foi
     antecipada.

   Lilás, como manda o sistema de cores (KIND_STYLE.tournament). */

const LILAC = { bg: '#E9E7FB', border: '#C9C3F3', ink: '#4338A8' }

// A inscrição feita fica no canto, curta («✓ Inscrito»); os outros pontos
// da inscrição são compridos e vão numa linha por baixo do nome, sem
// pastilha (UX, 10 out — «Esta tag não dá», Francisco).
const LINE_KEY = {
  convite: 'agenda.state_line_waiting_partner',
  sem_parceiro: 'agenda.state_line_alone',
  por_validar: 'agenda.state_line_to_validate',
  suplente: 'agenda.state_line_waitlist',
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
  // Acabado (jogo com resultado, ou o dia já passou): «Terminado», como nos
  // outros cartões da Home (#508).
  const stateTag = past || event.finished ? (
    <StateTag tone="grey" icon={CheckCircle2}>{t('agenda.state_finished')}</StateTag>
  ) : !isMatch && event.myState && !LINE_KEY[event.myState] ? (
    <StateTag tone="in" icon={CheckCircle2}>{t('agenda.state_in')}</StateTag>
  ) : null
  const stateLine = !past && !event.finished && !isMatch && LINE_KEY[event.myState] ? t(LINE_KEY[event.myState]) : null
  // O tipo por baixo do clube (SPEC-3): «Torneio», ou «Torneio · M4» no jogo.
  const kindLine = <KindLine kind="tournament" past={past} suffix={isMatch && event.categoryCode ? event.categoryCode : null} />

  // Cartão com organizador (design-handoff/2026-09-28-cartao-com-organizador,
  // o do Dev 4 no b26fc07a): em cima quem organiza, que abre o perfil do
  // clube; o resto do cartão abre o torneio. O cartão já não é um <Link> por
  // fora — um botão dentro de um link não é válido —, é um Link por baixo de
  // tudo, como no GameEventCard.
  return (
    <div className={`card relative press hover:shadow-lift ${past ? 'opacity-60' : ''}`} style={frame}>
      <Link to={to} className="absolute inset-0 rounded-[inherit]" aria-label={event.raw?.name || event.orgName || ''} />
      {/* O estado vai para o canto, ao lado de quem organiza, como no mix
          (457bfaf, Francisco 30 set). */}
      <OrgHeader event={event} past={past} right={stateTag} kind={kindLine} />
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

      {!event.orgName && <div className="flex items-center justify-between gap-2">{kindLine}{stateTag}</div>}

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
      {stateLine && <StateLine kind="tournament">{stateLine}</StateLine>}

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
