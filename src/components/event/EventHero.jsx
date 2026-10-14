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
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Share2 } from 'lucide-react'
import KindHero from '../KindHero'
import { KIND_COLORS } from '../../lib/kindColors'
import { Avatar } from '../ui'

const ROUND = 'flex h-11 w-11 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-sm'

/** status: { faces: [{ id, name, avatar_url }], slots, text, tone: 'kind'|'ok'|'grey', meta, dot, note }.
 *  `slots`: quantos lugares livres se desenham a tracejado (no máximo 2).
 *  'grey': o evento terminou ou foi cancelado (UX, 13 out); `dot`: a cor do
 *  ponto antes do estado (vermelho no cancelado); `note`: uma frase por baixo
 *  («A tua inscrição foi anulada.»). */
function StatusBand({ kind, status }) {
  const c = KIND_COLORS[kind] || KIND_COLORS.mix
  const faces = status.faces || []
  const shown = faces.slice(0, 4)
  const extra = faces.length - shown.length
  // Lugares livres a tracejado: só nos jogos de até 4 lugares (quem chama
  // passa 0 nos mixes e torneios — Francisco via PO e UX, 14 out).
  const empty = Math.min(4, Math.max(0, Number(status.slots) || 0))
  return (
    <div className="mt-4 flex items-center gap-3 rounded-[16px] px-3.5 py-3" style={{ background: status.tone === 'grey' ? '#F1F2EE' : c.light }}>
      {(shown.length > 0 || empty > 0) && (
        <div className="isolate flex shrink-0 items-center">
          {shown.map((p, i) => (
            <span key={p.id || i} className={`relative rounded-full ring-2 ring-white ${i ? '-ml-2' : ''}`} style={{ zIndex: 10 - i }}>
              <Avatar name={p.name} url={p.avatar_url} size="w-8 h-8 text-[11px]" />
            </span>
          ))}
          {Array.from({ length: empty }, (_, i) => (
            <span key={`e${i}`} aria-hidden="true" style={{ zIndex: 10 - shown.length - i, boxShadow: '0 0 0 2px #fff' }}
              className={`relative h-8 w-8 rounded-full border-2 border-dashed border-[#C9CCD1] bg-white ${shown.length || i ? '-ml-2' : ''}`} />
          ))}
          {extra > 0 && (
            <span className="-ml-2 flex h-8 min-w-[32px] items-center justify-center rounded-full bg-white px-1 text-[11px] font-extrabold text-ink-700 ring-2 ring-white">+{extra}</span>
          )}
        </div>
      )}
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
  manage = null, nextStep = null,
}) {
  const { t } = useTranslation()
  return (
    // Sai das margens da página (o <main> tem px-4 e pt-6), como a capa do protótipo.
    <div className="-mx-4 -mt-6">
      <KindHero kind={kind} src={imageUrl} className="relative h-[210px]" imgClassName={imageUrl ? "" : "object-[center_22%]"}>
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4" style={{ paddingTop: 'calc(var(--safe-top, env(safe-area-inset-top)) + 12px)' }}>
          {onBack
            ? <button type="button" onClick={onBack} aria-label={t('common.back')} className={ROUND}><ChevronLeft size={22} /></button>
            : <span aria-hidden />}
          {onShare
            ? <button type="button" onClick={onShare} aria-label={t('ui.share')} className={ROUND}><Share2 size={18} /></button>
            : <span aria-hidden />}
        </div>
        {chip && (
          <span className="absolute bottom-8 left-4 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-extrabold text-white backdrop-blur-sm">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" /> {chip}
          </span>
        )}
      </KindHero>

      {/* O cartão branco sobe uns 20 px por cima da capa. */}
      <div className="relative -mt-5 rounded-t-[22px] bg-white px-4 pb-4 pt-4">
        {manage && <div className="mb-2 empty:hidden">{manage}</div>}
        {org && (
          <button type="button" onClick={org.onOpen || undefined} disabled={!org.onOpen}
            className="flex min-h-[32px] max-w-full items-center gap-2 text-sm text-ink-700">
            <Avatar name={org.name} url={org.logo} size="w-6 h-6 text-[9px]" colorClass="bg-ink-900 text-lime-400" />
            <span className="min-w-0 truncate">{[org.name, org.kindLabel].filter(Boolean).join(' · ')}</span>
            {org.onOpen && <ChevronRight size={14} className="shrink-0 text-ink-500" />}
          </button>
        )}
        {/* O título pode ir a duas linhas (amigos: «Ana M. + Pedro L. vs Tiago L. + Tu»). */}
        <h1 className="mt-1.5 font-display text-[26px] font-extrabold leading-tight text-ink-900 line-clamp-2 break-words">{title}</h1>
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
