import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TournamentShareFlow from '../tournament/TournamentShareFlow'
import { bakeCircle } from '../tournament/TournamentShareCard'
import { shortName, monthName } from '../../lib/monthRanking'
import { Crown } from './RankPodium'
import { appOrigin } from '../../lib/native'

/* A imagem do pódio para partilhar (design-handoff/2026-10-12-ranking-do-
   mes-podio, ponto 7 e acerto de 12 out): o fluxo de sempre (foto opcional,
   pré-visualização, texto, Partilhar) com o cartão comum (#622). O miolo é o
   pódio grande com os degraus clássicos 2·1·3 — o 1.º ao centro e mais alto,
   com a coroa 3D. Serve os três separadores: Do mês, Ranking e Assiduidade. */

const LIME = '#C5DD01'
const STEP = {
  1: { h: 88, bg: '#3A4410', fg: LIME },
  2: { h: 64, bg: '#2A2E35', fg: '#E5E7EB' },
  3: { h: 46, bg: '#4A3326', fg: '#E7A57B' },
}
const RING = { 1: '#E8B23A', 2: '#B8BEC7', 3: '#C98B5E' }

// A primeira letra de cada palavra: «Admin (Dev)» → «AD», nunca «A(».
const initials = (name) => String(name || '?').split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'

function Spot({ row, place, face, compact }) {
  const size = (place === 1 ? 64 : 52) * (compact ? 0.8 : 1)
  const step = STEP[place]
  return (
    <div className="flex flex-1 flex-col items-center justify-end">
      {row ? (
        <>
          <div className="relative">
            {place === 1 && <Crown ring={size + 4} />}
            <div className="rounded-full p-[2px]" style={{ background: RING[place] }}>
              {face
                ? <img src={face} alt="" className="block rounded-full" style={{ width: size, height: size }} />
                : <span className="flex items-center justify-center rounded-full bg-[#1A1A1D] text-[13px] font-extrabold text-white" style={{ width: size, height: size }}>{initials(row.name)}</span>}
            </div>
          </div>
          <p className="mt-1 max-w-full truncate text-[10px] font-extrabold text-white">{shortName(row.name)}</p>
          <p className="text-[9px] font-extrabold" style={{ color: LIME }}>{row.display}</p>
        </>
      ) : <div style={{ height: size }} />}
      <div className="mt-1.5 flex w-full items-center justify-center rounded-t-[6px] font-display text-[22px] font-extrabold"
        style={{ height: step.h * (compact ? 0.7 : 1), background: step.bg, color: step.fg }}>{place}</div>
    </div>
  )
}

function MonthPodiumBody({ kind, podium, faces, month, lang, compact, title }) {
  const { t } = useTranslation()
  // Degraus 2·1·3: o 2.º à esquerda, o 1.º ao centro, o 3.º à direita.
  const order = [[podium[1], 2], [podium[0], 1], [podium[2], 3]]
  return (
    <div>
      <p className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF]">{t(`monthshare.kicker_${kind}`)}</p>
      <p className={`mt-1 font-display font-extrabold leading-none ${compact ? 'text-[24px]' : 'text-[32px]'}`} style={{ color: LIME }}>{title}</p>
      <div className={`flex items-end gap-1.5 ${compact ? 'mt-7' : 'mt-11'}`}>
        {order.map(([row, place]) => <Spot key={place} row={row} place={place} face={row ? faces[row.user_id] : null} compact={compact} />)}
      </div>
    </div>
  )
}

/** share = { kind ('month'|'ranking'|'xp'), podium (cada um com display), month?, title? };
 *  org = { name, slug } ou null (geral). */
export default function MonthPodiumShare({ share, org, onClose }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('en') ? 'en' : 'pt'
  const { podium, kind = 'month' } = share
  const month = share.month || `${new Date().toISOString().slice(0, 7)}-01`
  const [faces, setFaces] = useState({})
  useEffect(() => {
    let alive = true
    Promise.all(podium.filter(Boolean).map(async (r) => [r.user_id, await bakeCircle(r.avatar_url, 64)]))
      .then((pairs) => { if (alive) setFaces(Object.fromEntries(pairs.filter(([, v]) => v))) })
    return () => { alive = false }
  }, [podium])

  const name = monthName(month, lang)
  // O título grande: o mês, no Do mês; nos outros, o que vier (a escala ou «XP»).
  const title = kind === 'month' ? name.charAt(0).toUpperCase() + name.slice(1) : share.title
  const date = new Date(`${month.slice(0, 7)}-01T12:00:00`)
    .toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { month: 'long', year: 'numeric' }).replace(' de ', ' ').toLocaleUpperCase(lang)
  const scopeName = org?.name || t('monthshare.global')
  const names = podium.filter(Boolean).map((r) => shortName(r.name))
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t('monthshare.and')} ${names[names.length - 1]}` : names[0] || ''
  // «Inês C.» já acaba em ponto: nada de «Inês C..».
  const text = `${t(`monthshare.text_${kind}${org ? '' : '_global'}`, { month: name, club: scopeName, names: list }).replace('..', '.')} ${t('friends.share_tags')}`
  const cardOrg = { name: scopeName, initials: org ? initials(org.name) : null, mark: !org, sub: t(`monthshare.org_sub_${kind}`) }
  const qrUrl = org?.slug ? `${appOrigin()}/clube/${org.slug}` : 'https://alinho.pt'

  return (
    <TournamentShareFlow variant="custom" data={{ date }} text={text} filenameParts={['podio', kind, month.slice(0, 7)]}
      shareTitle={t(`monthshare.kicker_${kind}`)} qrUrl={qrUrl} org={cardOrg} onClose={onClose}>
      {({ compact }) => <MonthPodiumBody kind={kind} title={title} podium={podium} faces={faces} month={month} lang={lang} compact={compact} />}
    </TournamentShareFlow>
  )
}
