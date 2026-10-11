// «TERMINADO · VENCEDORES» em cima da página do mix acabado (#622, design-
// handoff/2026-10-11-vencedores-em-todos-os-jogos, aprovado pelo Francisco a
// 11 out): o vencedor, o pódio com os títulos curtos e, por baixo, «↗
// Partilhar os vencedores» (lima) para quem jogou e tem conta, e para quem
// organizou. `extra`: o que já vivia no cartão do vencedor (o voucher).
import { useTranslation } from 'react-i18next'

export default function MixWinnersBlock({ winner, rows, note = null, extra = null, onShare = null }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2.5">
      <div className="rounded-card bg-ink-900 p-4">
        <p className="font-mono text-[10.5px] font-extrabold uppercase tracking-[.12em] text-ink-200">{t('mixwinners.block_kicker')}</p>
        <p className="mt-1.5 break-words font-display text-2xl font-extrabold leading-tight text-white">🏆 {winner}</p>
        {note && <p className="mt-1 text-sm text-ink-200">{note}</p>}
        {extra}
        <div className="mt-3 border-t border-white/10">
          {rows.map((r, i) => (
            <div key={`${r.place}-${i}`} className="flex items-center justify-between gap-3 border-b border-white/10 py-2 last:border-0">
              <p className={`min-w-0 truncate text-sm ${r.mine ? 'font-extrabold text-lime-400' : 'text-white'}`}>{r.place}.º {r.name}</p>
              <span className={`shrink-0 text-sm font-extrabold ${r.place === 1 ? 'text-lime-400' : 'text-white'}`}>{r.short}</span>
            </div>
          ))}
        </div>
      </div>
      {onShare && (
        <button type="button" onClick={onShare}
          className="press flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-lime-400 px-4 text-[15px] font-extrabold text-ink-900">
          ↗ {t('mixwinners.share')}
        </button>
      )}
    </div>
  )
}
