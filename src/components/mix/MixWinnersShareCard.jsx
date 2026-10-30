// O cartão premium dos vencedores do mix (briefing do Ruben, 30 out):
// um share card de app desportiva — hero com a foto (~39% do cartão),
// «Vencedores» grande sobre o fade, o 1.º lugar dominante, 2.º/3.º
// compactos, contexto numa linha e branding discreto. Lima só nos
// destaques; sem pódio de alturas, sem QR, sem excesso de decoração.
//
// 360 × 640 exportado a 3× (1080 × 1920), como os outros cartões; as
// safe areas das Stories (84/100 a 360) ficam livres de conteúdo. Os
// torneios, amigos e conquistas continuam no TournamentShareCard.
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { toPng } from 'html-to-image'
import { useTranslation } from 'react-i18next'
import logoWordmark from '../../logo/primary-dark-card.svg'
import iconMark from '../../logo/icon-mark.svg'

export const MIX_CARD_W = 360
export const MIX_CARD_H = 640
export const MIX_HERO_H = 250 // ~39% do cartão (briefing: 35-40%)
const RATIO = 3
const SAFE_TOP = 84
const SAFE_BOTTOM = 100
const LIME = '#C5DD01'

const initialsOf = (name) =>
  String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

/** As iniciais da dupla em dois círculos sobrepostos (sem fotos: o corte
 *  redondo por CSS parte no WebKit ao rasterizar; iniciais são à prova). */
function PairCircles({ pair, size = 24 }) {
  const names = String(pair || '').split('/').map((s) => s.trim()).filter(Boolean).slice(0, 2)
  if (!names.length) return null
  return (
    <span className="flex shrink-0">
      {names.map((n, i) => (
        <span key={i}
          className="flex items-center justify-center rounded-full bg-[#26262B] font-extrabold text-white"
          style={{ width: size, height: size, fontSize: size * 0.34, marginLeft: i ? -size * 0.25 : 0, boxShadow: '0 0 0 2px #0B0B0C' }}>
          {initialsOf(n)}
        </span>
      ))}
    </span>
  )
}

/**
 * data: { date, rows: [{ place, pair, mine }], meta: { headerDate, club,
 *   weekdayLong, title, players, games, durationMin } }
 * photo: data URL já cozido (bakePhoto, height = MIX_HERO_H), ou null.
 */
const MixWinnersShareCard = forwardRef(function MixWinnersShareCard({ data, photo }, ref) {
  const { t } = useTranslation()
  const nodeRef = useRef(null)
  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      // O mesmo export do TournamentShareCard: espera a descodificação e
      // deita fora a primeira passagem (WebKit desenhava a foto preta).
      const node = nodeRef.current
      if (!node) throw new Error('Card not ready')
      const opts = { width: MIX_CARD_W, height: MIX_CARD_H, pixelRatio: RATIO, cacheBust: true }
      await Promise.all([...node.querySelectorAll('img')].map((img) => (img.decode ? img.decode().catch(() => {}) : null)))
      await toPng(node, opts).catch(() => {})
      const dataUrl = await toPng(node, opts)
      return (await fetch(dataUrl)).blob()
    },
  }))

  const meta = data.meta || {}
  const rows = (data.rows || []).filter((r) => r.place != null).slice(0, 3)
  const first = rows[0] || null
  const rest = rows.slice(1)
  // Contexto numa linha, só com o que existe (briefing: nada de dashboard).
  const dur = meta.durationMin ? `${Math.floor(meta.durationMin / 60)}h${String(meta.durationMin % 60).padStart(2, '0')}` : null
  const context = [
    meta.players ? t('mixshare.ctx_players', { count: meta.players }) : null,
    meta.games ? t('mixshare.ctx_games', { count: meta.games }) : null,
    dur,
  ].filter(Boolean).join(' · ')

  return (
    <div ref={nodeRef} className="relative overflow-hidden bg-[#0B0B0C] font-sans" style={{ width: MIX_CARD_W, height: MIX_CARD_H }}>
      {/* HERO: a foto (ou o fundo do mix) com o fade para o conteúdo. */}
      {photo
        ? <img src={photo} alt="" className="absolute left-0 top-0 block" style={{ width: MIX_CARD_W, height: MIX_HERO_H }} />
        : <div className="absolute left-0 top-0 bg-[#131316]" style={{ width: MIX_CARD_W, height: MIX_HERO_H }} />}

      {/* Cabeçalho: a marca à esquerda, o dia à direita (safe area). */}
      <div className="absolute inset-x-0 flex items-center justify-between px-[18px]" style={{ top: SAFE_TOP }}>
        <span className="flex items-end gap-[1px]">
          <img src={logoWordmark} alt="alinho" className="h-[16px] w-auto" />
          <span className="font-sans text-[13px] font-medium leading-[12px] text-white">.pt</span>
        </span>
        <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-white">{meta.headerDate || data.date}</span>
      </div>

      {/* O título sobre o fundo do hero. */}
      <div className="absolute inset-x-0 px-[18px]" style={{ top: 172 }}>
        {meta.club && <p className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-[#D1D5DB]">{t('mixshare.hero_kicker')} · {meta.club}</p>}
        <p className="mt-1 font-display text-[34px] font-black leading-none text-white">{t('mixshare.hero_title')}</p>
        {(meta.weekdayLong || meta.title) && (
          <p className="mt-1.5 text-[9.5px] text-[#9CA3AF]">{[meta.weekdayLong, meta.title].filter(Boolean).join(' · ')}</p>
        )}
      </div>

      {/* Vencedores + contexto + branding. */}
      <div className="absolute inset-x-0 flex flex-col px-[18px]" style={{ top: MIX_HERO_H + 16, bottom: SAFE_BOTTOM }}>
        <p className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em]" style={{ color: LIME }}>{t('mixshare.winners_label')}</p>

        {first && (
          <div className="relative mt-2 overflow-hidden rounded-[16px] bg-[#17171A] px-4 py-3.5">
            <span className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ background: LIME }} />
            <div className="flex items-center gap-3.5">
              <div className="shrink-0 text-center">
                <p className="font-display text-[26px] font-black leading-none" style={{ color: LIME }}>1.º</p>
                <p className="mt-0.5 text-[10px] leading-none">🏆</p>
              </div>
              <p className="min-w-0 flex-1 text-[15.5px] font-extrabold leading-tight text-white">{first.pair}</p>
              <PairCircles pair={first.pair} size={26} />
            </div>
          </div>
        )}

        {rest.length > 0 && (
          <div className="mt-1.5 space-y-1.5">
            {rest.map((r) => (
              <div key={r.place} className="flex items-center gap-3.5 rounded-[12px] bg-[#111114] px-4 py-2.5">
                <p className="w-7 shrink-0 font-display text-[16px] font-black leading-none text-[#6B7280]">{r.place}.º</p>
                <p className={`min-w-0 flex-1 truncate text-[12.5px] font-extrabold ${r.mine ? '' : 'text-white'}`} style={r.mine ? { color: LIME } : undefined}>{r.pair}</p>
                <PairCircles pair={r.pair} size={20} />
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto">
          {context && <p className="text-center text-[9px] font-bold tracking-[0.04em] text-[#9CA3AF]">{context}</p>}
          <div className="mt-3 text-center">
            <img src={iconMark} alt="" className="mx-auto mb-1.5 block h-[18px] w-[18px] rounded-full" />
            <p className="text-[13px] font-extrabold leading-tight text-white">{t('mixshare.played_here')}</p>
            <p className="mt-0.5 text-[8.5px] text-[#9CA3AF]">{t('mixshare.join_next')}</p>
          </div>
        </div>
      </div>
    </div>
  )
})

export default MixWinnersShareCard
