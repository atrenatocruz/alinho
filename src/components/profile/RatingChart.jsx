import { useTranslation } from 'react-i18next'
import { formatDate } from '../../lib/formatDate'

/* ════════════════════════════════════════════════════════════════════════
   O gráfico da evolução do ranking (Francisco, 16 out) — SVG à mão, como o
   aro de progresso do perfil: o projeto não tem lib de gráficos e não vale
   a pena uma por causa de uma linha. Um ponto por EVENTO (não por tempo):
   os eventos ficam igualmente espaçados, como num gráfico de partidas — com
   meses sem jogar, a linha não ganha desertos ilegíveis a 375px.

   Regras de cor: linha e pontos a ink-900; só o último ponto é lima (o
   «agora», que é teu). Grelha a line/#E5E7EB, legendas mono pequenas.
   Pontos a subir/descer não levam verde/vermelho — a convenção dos pontos
   (monthRanking.js) é positivos escuros e negativos cinzentos.
   ════════════════════════════════════════════════════════════════════════ */

const W = 340
const H = 170
const PAD = { top: 14, right: 10, bottom: 24, left: 38 }

export default function RatingChart({ rows = [] }) {
  const { i18n } = useTranslation()
  const rated = rows.filter((r) => r.rating_after != null)
  if (rated.length < 2) return null

  const values = rated.map((r) => Number(r.rating_after))
  let min = Math.min(...values)
  let max = Math.max(...values)
  // Linha quase plana: dá-lhe ar para não colar às bordas.
  if (max - min < 20) { min -= 10; max += 10 }
  const span = max - min

  const x = (i) => PAD.left + (i * (W - PAD.left - PAD.right)) / (values.length - 1)
  const y = (v) => PAD.top + ((max - v) * (H - PAD.top - PAD.bottom)) / span

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  // 3 linhas de grelha: topo, meio, fundo — com o valor arredondado à esquerda.
  const gridValues = [max, (max + min) / 2, min]
  const dateLabel = (r) => formatDate(r.starts_at || r.done_at, i18n.language, { day: 'numeric', month: 'short' })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {gridValues.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#E5E7EB" strokeWidth="1" />
          <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end"
            style={{ font: '500 9px "Geist Mono", ui-monospace, monospace', fill: '#4B5563' }}>
            {Math.round(v)}
          </text>
        </g>
      ))}
      <polyline points={points} fill="none" stroke="#040404" strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => {
        const last = i === values.length - 1
        return (
          <circle key={i} cx={x(i)} cy={y(v)} r={last ? 4.5 : 2.5}
            fill={last ? '#C5DD01' : '#FFFFFF'} stroke="#040404" strokeWidth={last ? 2 : 1.5} />
        )
      })}
      {/* A primeira e a última data, por baixo. */}
      <text x={PAD.left} y={H - 8} textAnchor="start"
        style={{ font: '500 9px "Geist Mono", ui-monospace, monospace', fill: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {dateLabel(rated[0])}
      </text>
      <text x={W - PAD.right} y={H - 8} textAnchor="end"
        style={{ font: '500 9px "Geist Mono", ui-monospace, monospace', fill: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {dateLabel(rated[rated.length - 1])}
      </text>
    </svg>
  )
}
