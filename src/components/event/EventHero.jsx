// O topo da página de um evento (R3 do redesign, design-handoff/2026-10-13-
// redesign/R3-topo-do-evento.md, aprovado pelo Francisco a 13 out). Uma peça
// só para o mix, o jogo em aberto, os amigos (Dev 2) e o torneio (Dev 1):
//   - a capa a toda a largura: a foto do organizador ou, sem ela, o Alino do
//     tipo por cima da cor forte (KindHero, R0 do Bugs); por cima, «‹» e
//     partilhar em botões redondos meio transparentes, e em baixo à esquerda
//     a pastilha escura com o tipo;
//   - o cartão branco que sobe por cima da capa: o clube, o nome, a hora em
//     muito grande, a data por extenso e «Adicionar ao calendário»;
//   - a faixa de estado na cor clara do tipo (as caras, os lugares livres a
//     tracejado, o estado e a linha em mono);
//   - `children`: os botões empilhados de cada página, logo por baixo;
//   - quem organiza (UX, 13 out — a regra do mix, Francisco 2 out): `manage`
//     («Editar · Mais ⋯») na primeira linha do cartão branco, antes do
//     clube; `nextStep` (o passo seguinte, preto) logo depois da hora e da
//     data, antes da faixa de estado.
// Só aspeto: as ações e os estados são os de cada página.
// O «‹» e o partilhar ficam sempre no mesmo sítio, presos em cima, em
// círculos de vidro (GlassBar) — também por cima da foto: nada muda de sítio
// ao descer (Francisco, 15 out). Quando o topo do título grande chega ao fundo
// dos botões, o vidro e o nome entram juntos e o título grande sai, numa troca
// cruzada de 150 ms (UX); ao voltar a subir, o contrário.
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Share2 } from 'lucide-react'
import KindHero from '../KindHero'
import { KIND_COLORS } from '../../lib/kindColors'
import { Avatar } from '../ui'
import FaceCircles from './FaceCircles'
import GlassBar, { GLASS_ROUND, useUnderBar } from '../GlassBar'


/** status: { faces: [{ id, name, avatar_url }], slots, text, tone: 'kind'|'ok'|'grey', meta, dot, note }.
 *  `slots`: quantos lugares livres se desenham a tracejado (no máximo 2).
 *  'grey': o evento terminou ou foi cancelado (UX, 13 out); `dot`: a cor do
 *  ponto antes do estado (vermelho no cancelado); `note`: uma frase por baixo
 *  («A tua inscrição foi anulada.»). */
function StatusBand({ kind, status }) {
  const c = KIND_COLORS[kind] || KIND_COLORS.mix
  const faces = status.faces || []
  // As caras e um tracejado por cada lugar que falta (FaceCircles: no máximo
  // 6 círculos, com «+N» — R1, decisão do Francisco a 14 out). `slots` são os
  // lugares que faltam (duplas, no torneio); 0 quando acabou.
  const free = Math.max(0, Number(status.slots) || 0)
  return (
    <div className="mt-4 flex items-center gap-3 rounded-[16px] px-3.5 py-3" style={{ background: status.tone === 'grey' ? '#F1F2EE' : c.light }}>
      <FaceCircles people={faces} free={free} size="md" moreBg={status.tone === 'grey' ? 'bg-white' : 'bg-[#F1F2EE]'} />
      <div className="min-w-0">
        {status.text && (
          <p className="flex items-center gap-1.5 text-[15px] font-extrabold leading-tight" style={{ color: status.tone === 'ok' ? '#15803D' : status.tone === 'grey' ? '#4F535A' : c.dark }}>
            {status.dot && <i aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: status.dot }} />}
            {status.text}
          </p>
        )}
        {status.meta && <p className="mt-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink-500">{status.meta}</p>}
        {status.note && <p className="mt-1 text-sm text-ink-700">{status.note}</p>}
      </div>
    </div>
  )
}

/** kind: a chave do KIND_COLORS ('mix', 'open', 'tournament', 'friends'…).
 *  org: { name, kindLabel, logo, initials, onOpen } — sem org, a linha sai. */
export default function EventHero({
  kind, imageUrl = null, chip = null, org = null, title, time = null, timeAside = null, dateLine = null,
  onAddToCalendar = null, onBack = null, onShare = null, status = null, children = null,
  manage = null, nextStep = null, roundBottom = false, barTitle = null,
}) {
  const { t } = useTranslation()
  const coverRef = useRef(null)
  const titleRef = useRef(null)
  const rowRef = useRef(null)
  const orgRef = useRef(null)
  const under = useUnderBar(titleRef, rowRef, [], { lastLine: true })
  // O vidro entra quando a primeira linha de texto da folha (o clube, ou o
  // título) chega aos círculos — nada passa nítido por baixo deles (UX, 15 out).
  const firstUnder = useUnderBar(org ? orgRef : titleRef, rowRef, [!!org])
  const coverGone = useUnderBar(coverRef, rowRef, [], { edge: 'bottom' })
  return (
    // Sai das margens da página (o <main> tem px-4 e pt-6), como a capa do protótipo.
    // No computador, quando a folha acaba aqui (roundBottom), fica da largura
    // dos cartões de baixo — saía 16 px para cada lado (Francisco, 14 out).
    <div className={`-mx-4 -mt-6 ${roundBottom ? 'sm:mx-0 sm:overflow-hidden sm:rounded-b-[16px]' : ''}`}>
      {/* No computador, com a folha à largura dos cartões (roundBottom), os
          círculos alinham com os cartões, 16 px para dentro da folha (UX). */}
      <GlassBar anchorRef={coverRef} rowRef={rowRef} filled={under || firstUnder} strip={coverGone} showTitle={under}
        inner={roundBottom ? 'px-4 sm:px-8' : 'px-4'}
        title={barTitle || title} dot={(KIND_COLORS[kind] || KIND_COLORS.mix).strong}
        left={onBack ? <button type="button" onClick={onBack} aria-label={t('common.back')} className={GLASS_ROUND}><ChevronLeft size={22} /></button> : null}
        right={onShare ? <button type="button" onClick={onShare} aria-label={t('ui.share')} className={GLASS_ROUND}><Share2 size={18} /></button> : null} />
      <div ref={coverRef}>
      <KindHero kind={kind} src={imageUrl} className="relative h-[210px]" imgClassName={imageUrl ? "" : "object-[center_22%]"}>
        {chip && (
          <span className="absolute bottom-8 left-4 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-extrabold text-white backdrop-blur-sm">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" /> {chip}
          </span>
        )}
      </KindHero>
      </div>

      {/* O cartão branco sobe uns 20 px por cima da capa. `roundBottom`: quando
          a folha acaba aqui, os cantos de baixo a 16 px, como os topos do R12b
          (UX, 14 out). O torneio fecha a sua folha mais abaixo. */}
      <div className={`relative -mt-5 rounded-t-[22px] bg-white px-4 pb-4 pt-4 ${roundBottom ? 'rounded-b-[16px]' : ''}`}>
        {manage && <div className="mb-2 empty:hidden">{manage}</div>}
        {org && (
          <button ref={orgRef} type="button" onClick={org.onOpen || undefined} disabled={!org.onOpen}
            className="flex min-h-[32px] max-w-full items-center gap-2 text-sm text-ink-700">
            <Avatar name={org.name} url={org.logo} size="w-6 h-6 text-[9px]" colorClass="bg-ink-900 text-lime-400" />
            <span className="min-w-0 truncate">{[org.name, org.kindLabel].filter(Boolean).join(' · ')}</span>
            {org.onOpen && <ChevronRight size={14} className="shrink-0 text-ink-500" />}
          </button>
        )}
        {/* O título pode ir a duas linhas (amigos: «Ana M. + Pedro L. vs Tiago L. + Tu»). */}
        <h1 ref={titleRef} className={`mt-1.5 font-display text-[26px] font-extrabold leading-tight text-ink-900 line-clamp-2 break-words transition-opacity duration-fast ${under ? 'opacity-0' : 'opacity-100'}`}>{title}</h1>
        {time && (
          <p className="mt-1 flex items-baseline gap-2.5">
            <span className="font-display text-[56px] font-extrabold leading-none tracking-tight text-ink-900 tabular-nums">{time}</span>
            {timeAside && <span className="text-lg text-ink-500">{timeAside}</span>}
          </p>
        )}
        {(dateLine || onAddToCalendar) && (
          <p className="mt-1.5 text-sm text-ink-700">
            {dateLine}
            {dateLine && onAddToCalendar && ' · '}
            {onAddToCalendar && (
              <button type="button" onClick={onAddToCalendar} className="min-h-[32px] font-extrabold text-ink-900 underline underline-offset-2">
                {t('gamedetails.add_to_calendar')}
              </button>
            )}
          </p>
        )}
        {nextStep && <div className="mt-3 empty:hidden">{nextStep}</div>}
        {status && <StatusBand kind={kind} status={status} />}
        {children && <div className="mt-3 space-y-2.5">{children}</div>}
      </div>
    </div>
  )
}
