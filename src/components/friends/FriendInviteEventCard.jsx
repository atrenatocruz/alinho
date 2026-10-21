// O convite para um jogo entre amigos no dia do jogo, na Home (design-
// handoff/2026-10-12-convite-amigos-na-home, ponto 2 — Francisco, 12 out).
// R1 (13 out): a moldura comum dos cartões da Home — a faixa dos amigos com
// «Convidado» e as vagas («3/4 aceitaram»), e no corpo branco «A Rita
// convidou-te» (ponto lima) e, à direita das caras, «Aceitar» (lima) com
// «Não posso ir» em texto por baixo. «Aceitar» abre o ecrã de responder de
// hoje (nunca se entra no ranking sem escolher, #412); «Não posso ir»
// pergunta antes de recusar.
// Depois do «Vou», enquanto não há equipas (QA e Dev 3, 13 out), fica como os
// jogos onde estou: «✓ Estás dentro», a borda lima, o que falta («À espera
// das equipas.») e «Ver».
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Avatar, ConfirmSheet } from '../ui'
import { CardClub } from '../agenda/EventCard'
import HomeCard, { BandPill, CardTitle, CardChips, CardState, CardFoot, CardButton, kindColorsOf } from '../agenda/HomeCard'
import { formatTime } from '../../lib/formatDate'
import { describeError } from '../../lib/errors'
import NoTime from '../NoTime'

/** As fotos de quem já aceitou e um círculo tracejado por lugar que falta. */
export function InviteFaces({ accepted, slots, size = 'w-7 h-7 text-[10px]' }) {
  const missing = Math.max(0, slots - accepted.length)
  return (
    <span className="flex -space-x-1.5">
      {accepted.slice(0, 6).map((p) => (
        <span key={p.id} className="rounded-full ring-2 ring-white">
          <Avatar name={p.name} url={p.avatar_url} size={size} />
        </span>
      ))}
      {Array.from({ length: Math.min(missing, 4) }, (_, i) => (
        <span key={`e${i}`} aria-hidden="true" className={`${size.split(' ').slice(0, 2).join(' ')} rounded-full border-[1.5px] border-dashed border-ink-200 bg-white`} />
      ))}
    </span>
  )
}

export default function FriendInviteEventCard({ event, onDecline }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const r = event.raw
  const to = `/jogos-privados/sessao/${event.id}`
  const going = event.myState === 'in'
  const title = t('agenda.played_friends_title', { name: r.isCreator ? t('agenda.you') : r.creatorFirst })
  // A mesma frase da lista «Jogos entre amigos».
  const waitLine = r.pending > 0 ? t('friends.waiting_answers', { count: r.pending })
    : r.isCreator ? t('friends.form_teams_now') : t('friends.waiting_teams')
  const time = event.hasTime ? formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' }) : <NoTime onBand />
  return (
    <>
      <HomeCard colors={kindColorsOf('friends')} label={t('agenda.kind_friends')}
        pill={going ? <BandPill>✓ {t('home.next_in')}</BandPill> : <BandPill tone="dark">{t('agenda.state_invited')}</BandPill>}
        time={time} count={{ n: r.accepted.length, of: r.slots, unit: t('homecard.unit_accepted') }}
        mine={going} to={to} ariaLabel={going ? title : t('home.invite_by', { name: r.creatorFirst })}>
        <CardClub event={event} place={r.location || null} />
        <CardTitle>{title}</CardTitle>
        <CardChips>{[event.orgName ? r.location : null, r.ranked === false ? t('gamedetails.badge_friendly') : t('home.invite_ranked_short')].filter(Boolean).join(' · ')}</CardChips>
        {going
          ? <CardState tone="ok">{waitLine}</CardState>
          : <CardState tone="inv">{t('home.invite_by', { name: r.creatorFirst })}</CardState>}
        <CardFoot people={r.accepted} slots={r.slots}>
          {going ? (
            <span className="pointer-events-none whitespace-nowrap rounded-[14px] border-[1.5px] border-[#CFD2D7] bg-white px-[18px] py-[11px] font-display text-[14.5px] font-extrabold leading-none text-ink-900">{t('homecard.see')}</span>
          ) : (
            <>
              <CardButton onClick={() => navigate(to)}>{t('agenda.invite_accept')}</CardButton>
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAsking(true) }}
                className="relative p-1 font-display text-[12.5px] font-bold leading-none text-[#4F535A] underline underline-offset-[3px]">
                {t('home.invite_cant_go')}
              </button>
            </>
          )}
        </CardFoot>
      </HomeCard>
      <ConfirmSheet
        open={asking}
        title={t('home.invite_cant_go_title')}
        // O nome de quem convidou, sem adivinhar o género (UX, 12 out).
        message={r.creatorFirst ? t('home.invite_cant_go_text_named', { name: r.creatorFirst }) : t('home.invite_cant_go_text')}
        confirmLabel={t('home.invite_cant_go_confirm')}
        cancelLabel={t('home.invite_cant_go_cancel')}
        onConfirm={() => onDecline(event)}
        errorOf={(err) => describeError(t, err, 'agenda.invite_error')}
        onClose={() => setAsking(false)}
      />
    </>
  )
}
