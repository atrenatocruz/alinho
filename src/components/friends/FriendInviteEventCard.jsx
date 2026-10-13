// O convite para um jogo entre amigos no dia do jogo, na Home (design-
// handoff/2026-10-12-convite-amigos-na-home, ponto 2 — Francisco, 12 out).
// O cartão de amigos de sempre, com o boneco e «Convidado»; por baixo das
// fotos, a caixa branca «A Rita convidou-te.» com o que conta para o
// ranking; «Aceitar» (lima, a toda a largura) abre o ecrã de responder de
// hoje (nunca se entra no ranking sem escolher, #412); «Não posso ir» em
// texto pergunta antes de recusar.
// Depois do «Vou», enquanto não há equipas (QA e Dev 3, 13 out), o mesmo
// cartão fica como os jogos onde estou: contorno verde, «Inscrito» e, no
// lugar da caixa e dos botões, o que falta («À espera das equipas.»).
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, MapPin } from 'lucide-react'
import { Avatar, PrimaryButton, ConfirmSheet } from '../ui'
import { KIND_STYLE, KindLine, OrgHeader, StateTag } from '../agenda/EventCard'
import CardMascot, { mascotFor, MascotPill } from '../agenda/CardMascot'
import { formatTime } from '../../lib/formatDate'
import { describeError } from '../../lib/errors'

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
  const mascot = mascotFor('friends')
  const going = event.myState === 'in'
  const pill = going
    ? <StateTag tone="in" icon={CheckCircle2}>{t('agenda.state_in')}</StateTag>
    : <StateTag tone="invited">{t('agenda.state_invited')}</StateTag>
  // A mesma frase da lista «Jogos entre amigos».
  const waitLine = r.pending > 0 ? t('friends.waiting_answers', { count: r.pending })
    : r.isCreator ? t('friends.form_teams_now') : t('friends.waiting_teams')
  const kindLine = <KindLine kind="friends" />
  return (
    <div className={`relative rounded-card p-3.5 press ${mascot ? '!mt-5' : ''} border-2 ${going ? 'border-ok' : 'border-ink-900'} ${KIND_STYLE.friends.bg}`}>
      <Link to={to} className="absolute inset-0" aria-label={going ? t('agenda.played_friends_title', { name: r.isCreator ? t('agenda.you') : r.creatorFirst }) : t('home.invite_by', { name: r.creatorFirst })} />
      <CardMascot type={mascot} />
      <OrgHeader event={event} right={pill} kind={kindLine} mascot={!!mascot} />
      {!event.orgName && (mascot
        ? <><div className="pr-[80px]">{kindLine}</div><MascotPill top="top-[54px]">{pill}</MascotPill></>
        : <div className="flex items-start justify-between gap-2">{kindLine}{pill}</div>)}

      {event.hasTime && (
        <p className="mt-2.5 text-[22px] font-extrabold leading-none text-ink-900">
          {formatTime(event.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
      <h3 className={`mt-1.5 text-base leading-snug text-ink-900 ${!event.orgName && mascot ? 'pr-[100px]' : ''}`}>
        {t('agenda.played_friends_title', { name: r.isCreator ? t('agenda.you') : r.creatorFirst })}
      </h3>
      {r.location && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-700">
          <MapPin size={14} className="shrink-0" /> <span className="truncate">{r.location}</span>
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2 border-t border-ink-900/10 pt-2.5">
        <InviteFaces accepted={r.accepted} slots={r.slots} />
        <span className="text-[13px] font-extrabold text-ink-900">{r.accepted.length}/{r.slots}</span>
      </div>

      {going ? (
        <p className="mt-2 text-[13px] text-ink-700">{waitLine}</p>
      ) : (<>
      <div className="relative z-[1] mt-2.5 rounded-ctrl bg-white px-3 py-2.5 text-[13px] leading-snug text-ink-900">
        <b>{t('home.invite_box_by', { name: r.creatorFirst })}</b>{' '}
        {r.ranked === false ? t('home.invite_box_friendly') : t('home.invite_box_ranked')}
      </div>
      <div className="relative z-[1] mt-2.5">
        <PrimaryButton onClick={() => navigate(to)} className="w-full">{t('agenda.invite_accept')}</PrimaryButton>
        <button type="button" onClick={() => setAsking(true)}
          className="mt-1 w-full min-h-[40px] text-sm font-extrabold text-ink-700 underline underline-offset-4 hover:text-ink-900">
          {t('home.invite_cant_go')}
        </button>
      </div>
      </>)}

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
    </div>
  )
}
