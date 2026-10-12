import { useTranslation } from 'react-i18next'
import { Avatar } from '../ui'
import { shortName } from '../../lib/monthRanking'

/* O pódio 1·2·3 da página Rankings, igual nos três separadores (Ranking,
   Do mês, Assiduidade — acerto do Francisco a 12 out, design-handoff/
   2026-10-12-ranking-do-mes-podio/SPEC.md). Lido da esquerda para a
   direita; o 1.º maior, com a coroa 3D (não o emoji, que muda de telemóvel
   para telemóvel); anéis ouro, prata e bronze, e lima para ti. */

export const PODIUM_RING = { 1: '#E8B23A', 2: '#B8BEC7', 3: '#C98B5E' }
export const CROWN_SRC = '/podio/coroa.webp'

/** A coroa inclinada por cima da foto do 1.º, a passar por cima do anel. */
export function Crown({ width = 46, lift = 30 }) {
  return (
    <img src={CROWN_SRC} alt="" aria-hidden="true" width={width}
      className="pointer-events-none absolute left-1/2 z-[1] max-w-none drop-shadow-[0_3px_4px_rgba(4,4,4,0.25)]"
      style={{ width, top: -lift, transform: 'translateX(-50%) rotate(-12deg)' }} />
  )
}

function Spot({ row, place, big, value, isMe, freeHint, onOpen }) {
  const { t } = useTranslation()
  const size = big ? 'w-[60px] h-[60px] text-base' : 'w-12 h-12 text-sm'
  if (!row) {
    return (
      <div className="flex flex-col items-center text-center min-w-0">
        <div className={`relative ${big ? 'mt-6' : 'mt-9'}`}>
          <span className={`flex ${size} items-center justify-center rounded-full border-2 border-dashed border-ink-200 font-extrabold text-muted`}>?</span>
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-[11px] font-extrabold text-white">{place}</span>
        </div>
        <p className="mt-2 text-[13px] font-extrabold text-muted">{t('month.free_spot')}</p>
        {freeHint && <p className="text-[11px] text-muted">{freeHint}</p>}
      </div>
    )
  }
  const shown = row.place ?? place
  const v = value(row)
  return (
    <button type="button" onClick={() => onOpen?.(row.user_id)} className="flex flex-col items-center text-center min-w-0">
      <div className={`relative ${big ? 'mt-6' : 'mt-9'}`}>
        {big && <Crown />}
        <span className="block rounded-full p-[3px]" style={{ background: isMe ? '#C5DD01' : PODIUM_RING[Math.min(shown, 3)] }}>
          <span className="block rounded-full bg-white p-[2px]"><Avatar name={row.name} url={row.avatar_url} size={size} /></span>
        </span>
        <span className={`absolute -right-1 -top-1 z-[2] flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-extrabold ${shown === 1 ? 'bg-lime-400 text-ink-900' : 'bg-ink-900 text-white'}`}>{shown}</span>
        {isMe && <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-lime-400 px-1.5 text-[10px] font-extrabold text-ink-900">{t('month.you')}</span>}
      </div>
      <p className="mt-2 w-full truncate text-[13px] font-extrabold text-ink-900">{shortName(row.name)}</p>
      <p className={`text-[13px] font-extrabold tabular-nums ${v.muted ? 'text-muted' : 'text-[#5B6B00]'}`}>{v.text}</p>
    </button>
  )
}

/**
 * spots: [1.º, 2.º, 3.º] (null = «Lugar livre») · value(row) → { text, muted }
 * meId: quem é «Tu» · freeHint: o que falta para entrar (só no do mês)
 * onShare: «↗ Partilhar o pódio» (sem ele não aparece)
 */
export default function RankPodium({ spots, value, meId, freeHint = null, onOpen, onShare, id }) {
  const { t } = useTranslation()
  return (
    <div id={id} className="card p-0 overflow-hidden">
      <div className="grid grid-cols-3 gap-2 px-3 pt-3 pb-4">
        {spots.map((row, i) => (
          <Spot key={i} row={row} place={i + 1} big={i === 0} value={value} isMe={!!row && (row.is_me || row.user_id === meId)} freeHint={freeHint} onOpen={onOpen} />
        ))}
      </div>
      {onShare && spots.some(Boolean) && (
        <button type="button" onClick={onShare}
          className="flex w-full min-h-[44px] items-center justify-center gap-1 border-t border-line text-[13px] font-extrabold text-ink-900">
          ↗ {t('month.share')}
        </button>
      )}
    </div>
  )
}
