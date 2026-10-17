// «TERMINADO · VENCEDORES» em cima da página do mix acabado (#622, design-
// handoff/2026-10-11-vencedores-em-todos-os-jogos, aprovado pelo Francisco a
// 11 out): o vencedor, o pódio e, por baixo, «↗
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
            // Sem os títulos curtos (Lendário/Master/Bronze) ao lado: não diziam
            // nada a quem jogou (Renato, 17 out).
            <div key={`${r.place}-${i}`} className="border-b border-white/10 py-2 last:border-0">
              {/* Sem lugar (jogo em aberto, um jogo só): só as duplas, a
                  vencedora a lima (UX, 11 out). */}
              <p className={`min-w-0 truncate text-sm ${r.mine ? 'font-extrabold text-lime-400' : 'text-white'}`}>{r.place != null ? `${r.place}.º ` : ''}{r.name}</p>
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
