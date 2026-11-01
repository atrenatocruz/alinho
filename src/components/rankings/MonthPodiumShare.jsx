import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TournamentShareFlow from '../tournament/TournamentShareFlow'
import { Row, TopRow, bakeCircle } from '../tournament/TournamentShareCard'
import { shortName, monthName } from '../../lib/monthRanking'
import { Crown } from './RankPodium'
import { appOrigin } from '../../lib/native'
import { localeOf } from '../../lib/formatDate'

/* A imagem do pódio para partilhar (design-handoff/2026-10-12-ranking-do-
   mes-podio, ponto 7 e acerto de 12 out): o fluxo de sempre (foto opcional,
   pré-visualização, texto, Partilhar) com o cartão comum de todas as
   partilhas (#743, 30 out). Sem foto, o pódio desenhado com os degraus
   clássicos 2·1·3 (o 1.º ao centro e mais alto, com a coroa) faz de foto; os
   nomes e os pontos vão em lista por baixo, como nos outros. Serve os três
   separadores: Do mês, Ranking e Assiduidade. */

const LIME = '#C5DD01'
const STEP = {
  1: { h: 100, bg: LIME },
  2: { h: 70, bg: '#D4D7DC' },
  3: { h: 50, bg: '#E2A06B' },
}

// A primeira letra de cada palavra: «Admin (Dev)» → «AD», nunca «A(».
const initials = (name) => String(name || '?').split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'

function Spot({ row, place, face }) {
  const size = place === 1 ? 56 : 46
  const step = STEP[place]
  return (
    <div className="flex flex-1 flex-col items-center justify-end">
      {row && (
        <div className="relative">
          {place === 1 && <Crown ring={size + 4} />}
          <div className="rounded-full p-[2px]" style={{ background: step.bg }}>
            {face
              ? <img src={face} alt="" className="block rounded-full" style={{ width: size, height: size }} />
              : <span className="flex items-center justify-center rounded-full bg-[#1E2128] text-[13px] font-extrabold text-white" style={{ width: size, height: size }}>{initials(row.name)}</span>}
          </div>
        </div>
      )}
      <div className="mt-2 flex w-full items-center justify-center rounded-t-[10px] font-display text-[22px] font-black text-[#0B0B0C]"
        style={{ height: step.h, background: step.bg }}>{place}</div>
    </div>
  )
}

/** O pódio desenhado, na zona da foto (sem foto). */
function PodiumHero({ podium, faces }) {
  // Degraus 2·1·3: o 2.º à esquerda, o 1.º ao centro, o 3.º à direita.
  const order = [[podium[1], 2], [podium[0], 1], [podium[2], 3]]
  return (
    <div className="absolute flex items-end gap-2" style={{ left: 24, right: 24, top: 96, height: 210 }}>
      {order.map(([row, place]) => <Spot key={place} row={row} place={place} face={row ? faces[row.user_id] : null} />)}
    </div>
  )
}

/** share = { kind ('month'|'ranking'|'xp'), podium (cada um com display), month?, title? };
 *  org = { name, slug } ou null (geral). */
export default function MonthPodiumShare({ share, org, onClose }) {
  const { t, i18n } = useTranslation()
  const lang = String(i18n.language || 'pt').slice(0, 2)
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
  // A faixa do título: «Pódio do mês»; nos outros, com a escala ou «XP»
  // («Pódio do ranking · Masculino»). O mês já vai na data, à direita.
  const label = [t(`monthshare.kicker_${kind}`), kind === 'month' ? null : share.title].filter(Boolean).join(' · ')
  const date = new Date(`${month.slice(0, 7)}-01T12:00:00`)
    .toLocaleDateString(localeOf(lang), { month: 'long', year: 'numeric' }).replace(' de ', ' ').toLocaleUpperCase(lang)
  const scopeName = org?.name || t('monthshare.global')
  const names = podium.filter(Boolean).map((r) => shortName(r.name))
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t('monthshare.and')} ${names[names.length - 1]}` : names[0] || ''
  // «Inês C.» já acaba em ponto: nada de «Inês C..».
  const text = `${t(`monthshare.text_${kind}${org ? '' : '_global'}`, { month: name, club: scopeName, names: list }).replace('..', '.')} ${t('friends.share_tags')}`
  const cardOrg = { name: scopeName, initials: org ? initials(org.name) : null, mark: !org }
  const rows = podium.map((r, i) => r && { place: i + 1, name: shortName(r.name), score: r.display }).filter(Boolean)

  return (
    <TournamentShareFlow variant="custom" kind="podio" data={{ date, label }} text={text} filenameParts={['podio', kind, month.slice(0, 7)]}
      link={org?.slug ? `${appOrigin()}/clube/${org.slug}` : 'https://alinho.pt'}
      shareTitle={t(`monthshare.kicker_${kind}`)} org={cardOrg} onClose={onClose}
      hero={<PodiumHero podium={podium} faces={faces} />}>
      <div>
        {rows.map((r) => (r.place === 1
          ? <TopRow key={r.place} lead="1.º" name={r.name} right={r.score} />
          : <Row key={r.place} lead={`${r.place}.º`} name={r.name} right={r.score} />))}
      </div>
    </TournamentShareFlow>
  )
}
