import { Trans, useTranslation } from 'react-i18next'

/* Ranking e conquistas no site (design-handoff/2026-10-12-ranking-e-conquistas-
   no-site, aprovado pelo Francisco a 12 out). As 6 medalhas 3D da app, em
   3 × 2, com o nome e a raridade na cor dela, e «Imagem ilustrativa». Serve a
   página de entrada e o «Como funciona». Webp de 256 px, só carregam quando
   aparecem. */

export const SITE_DARK = 'bg-[#12161D]'

const RARITY_COLOR = { lendario: '#E8B23A', epico: '#B57BFF', raro: '#5AA9FF', comum: '#39C2A8' }

const MEDALS = [
  { id: 'lenda_viva', rarity: 'lendario' },
  { id: 'campeao', rarity: 'epico' },
  { id: 'mvp_da_noite', rarity: 'epico' },
  { id: 'em_chamas', rarity: 'raro' },
  { id: 'noite_perfeita', rarity: 'raro' },
  { id: 'coruja_do_padel', rarity: 'comum' },
]

export function MedalGrid({ className = '' }) {
  const { t } = useTranslation()
  return (
    <div className={`relative ${className}`}>
      {/* O brilho lima suave por trás das medalhas. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(closest-side,rgba(197,221,1,0.16),transparent)]" />
      <ul className="relative grid grid-cols-3 gap-x-2 gap-y-4">
        {MEDALS.map((m) => (
          <li key={m.id} className="flex flex-col items-center text-center">
            <img src={`/medalhas/${m.id}.webp`} alt="" width="256" height="256" loading="lazy" className="h-[88px] w-[88px] sm:h-[100px] sm:w-[100px]" />
            <span className="mt-1.5 text-[13px] font-extrabold leading-tight text-white">{t(`achievements.${m.id}_name`)}</span>
            <span className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: RARITY_COLOR[m.rarity] }}>
              {t(`achievements.rarity_${m.rarity}`)}
            </span>
          </li>
        ))}
      </ul>
      <p className="relative mt-3 text-center text-[11px] text-white/50">{t('hiw.illustrative')}</p>
    </div>
  )
}

const HIGHLIGHTS = [
  { key: 'site.hl_achievements', icon: '🏅' },
  { key: 'site.hl_xp', icon: '💎' },
  { key: 'site.hl_kudos', icon: '👏' },
]

/** Os 3 destaques em caixas escuras; o «100» a lima. */
export function Highlights() {
  return (
    <ul className="space-y-2.5">
      {HIGHLIGHTS.map((h) => (
        <li key={h.key} className="flex items-center gap-3 rounded-card bg-[#1B212B] px-3.5 py-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctrl bg-[#12161D] text-lg">{h.icon}</span>
          <span className="text-[15px] font-extrabold leading-snug text-white">
            <Trans i18nKey={h.key} components={{ n: <span className="font-mono text-lime-400" /> }} />
          </span>
        </li>
      ))}
    </ul>
  )
}
