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
export const MIX_HERO_H = 376 // ~59% do cartão (Ruben, 30 out: a foto manda)
const RATIO = 3
// O rodapé desce até 64 do fundo (192 a 1080) — abaixo dos 100 «oficiais»
// das Stories, por pedido do Ruben (30 out): havia preto a sobrar e o
// branding colava ao 3.º classificado. Em cima não há conteúdo nenhum:
// a identidade vive toda no fade de baixo (opção 1, «à Strava», 30 out)
// e o topo da foto fica limpo — adeus texto em cima das cabeças.
const SAFE_BOTTOM = 64
const LIME = '#C5DD01'

/**
 * data: { date, rows: [{ place, pair, mine }], meta: { headerDate, club,
 *   weekdayLong, title, players, games, durationMin } }
 * photo: data URL já cozido (bakePhoto, height = MIX_HERO_H), ou null.
 */
const MixWinnersShareCard = forwardRef(function MixWinnersShareCard({ data, photo, org = null }, ref) {
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

  return (
    <div ref={nodeRef} className="relative overflow-hidden bg-[#0B0B0C] font-sans" style={{ width: MIX_CARD_W, height: MIX_CARD_H }}>
      {/* HERO: a foto (ou o fundo do mix) com o fade para o conteúdo. */}
      {photo
        ? <img src={photo} alt="" className="absolute left-0 top-0 block" style={{ width: MIX_CARD_W, height: MIX_HERO_H }} />
        : <div className="absolute left-0 top-0 bg-[#131316]" style={{ width: MIX_CARD_W, height: MIX_HERO_H }} />}

      {/* A identidade e o título, TODOS no fade de baixo (opção 1, «à
          Strava»): a marca + grupo à esquerda, a data à direita, e o
          «Vencedores» por baixo. O topo da foto fica limpo. */}
      <div className="absolute inset-x-0 px-[18px]" style={{ top: 264 }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex shrink-0 items-end gap-[1px]">
              <img src={logoWordmark} alt="alinho" className="h-[12px] w-auto" />
              <span className="font-sans text-[10px] font-medium leading-[9px] text-white">.pt</span>
            </span>
            {meta.club && (
              <>
                <span className="text-[9px] text-[#9CA3AF]">·</span>
                {org?.logo
                  ? <img src={org.logo} alt="" className="block h-[14px] w-[14px] shrink-0 rounded-full" />
                  : <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border text-[6px] font-extrabold" style={{ borderColor: LIME, color: LIME }}>{org?.initials || '•'}</span>}
                <span className="min-w-0 truncate font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[#D1D5DB]">{meta.club}</span>
              </>
            )}
          </span>
          <span className="shrink-0 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-white">{meta.headerDate || data.date}</span>
        </div>
        <p className="mt-1.5 font-display text-[34px] font-black leading-none text-white">{t('mixshare.hero_title')}</p>
        {(meta.weekdayLong || meta.title) && (
          <p className="mt-1.5 text-[9.5px] text-[#9CA3AF]">{[meta.weekdayLong, meta.title].filter(Boolean).join(' · ')}</p>
        )}
      </div>

      {/* Vencedores + branding — os cartões mordem bem o fade da foto
          (−28), para a composição ler como uma peça só. */}
      <div className="absolute inset-x-0 flex flex-col px-[18px]" style={{ top: MIX_HERO_H - 28, bottom: SAFE_BOTTOM }}>
        <p className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em]" style={{ color: LIME }}>{t('mixshare.winners_label')}</p>

        {first && (
          <div className="relative mt-1.5 overflow-hidden rounded-[16px] bg-[#17171A] px-4 py-2">
            <span className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ background: LIME }} />
            <div className="flex items-center gap-3.5">
              <div className="shrink-0 text-center">
                <p className="font-display text-[26px] font-black leading-none" style={{ color: LIME }}>1.º</p>
                <p className="mt-0.5 text-[10px] leading-none">🏆</p>
              </div>
              <p className="min-w-0 flex-1 text-[15.5px] font-extrabold leading-tight text-white">{first.pair}</p>
            </div>
          </div>
        )}

        {rest.length > 0 && (
          <div className="mt-1.5 space-y-1.5">
            {rest.map((r) => (
              <div key={r.place} className="flex items-center gap-3.5 rounded-[12px] bg-[#111114] px-4 py-1.5">
                <p className="w-7 shrink-0 font-display text-[16px] font-black leading-none text-[#6B7280]">{r.place}.º</p>
                <p className={`min-w-0 flex-1 truncate text-[12.5px] font-extrabold ${r.mine ? '' : 'text-white'}`} style={r.mine ? { color: LIME } : undefined}>{r.pair}</p>
              </div>
            ))}
          </div>
        )}

        {/* Branding (Ruben, 30 out): «Joga padel no alinho.pt» e só a marca
            por baixo — sem contexto de jogadores/jogos. */}
        <div className="mt-auto text-center">
          <img src={iconMark} alt="" className="mx-auto mb-1 block h-[14px] w-[14px] rounded-full" />
          <p className="text-[13px] font-extrabold leading-tight text-white">{t('share.play_padel')} {t('share.on_alinho')}</p>
          <p className="mt-0.5 text-[8.5px] text-[#9CA3AF]">alinho.pt</p>
        </div>
      </div>
    </div>
  )
})

export default MixWinnersShareCard
