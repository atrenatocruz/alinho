import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDate } from '../../lib/formatDate'

/* ════════════════════════════════════════════════════════════════════════
   O gráfico da evolução do ranking (Francisco, 16 out) — SVG à mão, como o
   aro de progresso do perfil: o projeto não tem lib de gráficos e não vale
   a pena uma por causa de uma linha. Um ponto por EVENTO (não por tempo):
   os eventos ficam igualmente espaçados, como num gráfico de partidas — com
   meses sem jogar, a linha não ganha desertos ilegíveis a 375px.

   Interativo (Renato, 16 out): tocar/arrastar (ou passar o rato, ou as
   setas do teclado) escolhe um evento — a leitura por cima mostra os pontos
   depois dele, o delta, o nome e a data. Sem escolha, mostra o último.

   Regras de cor: linha e pontos a ink-900; só o último ponto é lima (o
   «agora», que é teu). Grelha a line/#E5E7EB, legendas mono pequenas.
   Pontos a subir/descer não levam verde/vermelho — a convenção dos pontos
   (monthRanking.js) é positivos escuros e negativos cinzentos.
   ════════════════════════════════════════════════════════════════════════ */

const H = 170
const PAD = { top: 14, right: 10, bottom: 24, left: 38 }
const MONO = { font: '500 9px "Geist Mono", ui-monospace, monospace', fill: '#4B5563' }

// Ref de callback: mede a largura real, para os pontos não ficarem ovais.
function useWidth() {
  const ro = useRef(null)
  const [w, setW] = useState(0)
  const ref = useCallback((el) => {
    ro.current?.disconnect()
    if (!el) return
    ro.current = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.current.observe(el)
  }, [])
  useEffect(() => () => ro.current?.disconnect(), [])
  return [ref, w]
}

export default function RatingChart({ rows = [], eventName = (r) => r.title }) {
  const { t, i18n } = useTranslation()
  const [boxRef, W] = useWidth()
  const [sel, setSel] = useState(null)
  const rated = rows.filter((r) => r.rating_after != null)
  const n = rated.length
  // Mudar de período (outras rows) volta ao último ponto.
  useEffect(() => { setSel(null) }, [n, rated[0]?.event_id])
  if (n < 2) return null

  const values = rated.map((r) => Number(r.rating_after))
  let min = Math.min(...values)
  let max = Math.max(...values)
  // Linha quase plana: dá-lhe ar para não colar às bordas.
  if (max - min < 20) { min -= 10; max += 10 }
  const span = max - min
  const iw = Math.max(W - PAD.left - PAD.right, 1)

  const x = (i) => PAD.left + (i * iw) / (n - 1)
  const y = (v) => PAD.top + ((max - v) * (H - PAD.top - PAD.bottom)) / span
  const coords = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  const area = `M${x(0).toFixed(1)},${H - PAD.bottom} L${coords.join(' L')} L${x(n - 1).toFixed(1)},${H - PAD.bottom} Z`
  // 3 linhas de grelha: topo, meio, fundo — com o valor arredondado à esquerda.
  const gridValues = [max, (max + min) / 2, min]
  const dateLabel = (r, opts = { day: 'numeric', month: 'short' }) => formatDate(r.starts_at || r.done_at, i18n.language, opts)

  const active = sel != null && sel < n ? sel : n - 1
  const cur = rated[active]
  const delta = cur.rating_delta == null ? null : Math.round(Number(cur.rating_delta))
  const pick = (clientX, el) => {
    const left = el.getBoundingClientRect().left
    setSel(Math.min(n - 1, Math.max(0, Math.round(((clientX - left - PAD.left) / iw) * (n - 1)))))
  }

  return (
    <div>
      {/* A leitura do evento escolhido. */}
      <div className="mb-2 flex min-h-[40px] items-start justify-between gap-3" aria-live="polite">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-extrabold text-ink-900">{eventName(cur)}</p>
          <p className="truncate text-[12px] text-muted">
            {dateLabel(cur, { day: 'numeric', month: 'short', year: 'numeric' })}{cur.org_name ? ` · ${cur.org_name}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-[17px] font-extrabold leading-none text-ink-900 tabular-nums">{Math.round(values[active])}</p>
          {delta != null && (
            <p className={`mt-1 text-[12px] font-extrabold tabular-nums ${delta > 0 ? 'text-ink-900' : 'text-muted'}`}>
              {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0'}
            </p>
          )}
        </div>
      </div>

      <div ref={boxRef} className="select-none">
        {W > 0 ? (
          <svg
            width={W}
            height={H}
            role="slider"
            tabIndex={0}
            aria-label={t('playerstats.chart_aria')}
            aria-valuemin={1}
            aria-valuemax={n}
            aria-valuenow={active + 1}
            aria-valuetext={`${Math.round(values[active])} · ${dateLabel(cur)}`}
            className="block touch-pan-y rounded-ctrl outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
            onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') setSel(null) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); setSel(Math.max(0, active - 1)) }
              if (e.key === 'ArrowRight') { e.preventDefault(); setSel(Math.min(n - 1, active + 1)) }
            }}
          >
            <defs>
              <linearGradient id="rating-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#040404" stopOpacity="0.10" />
                <stop offset="100%" stopColor="#040404" stopOpacity="0" />
              </linearGradient>
            </defs>
            {gridValues.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#E5E7EB" strokeWidth="1" />
                <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end" style={MONO}>{Math.round(v)}</text>
              </g>
            ))}
            <path d={area} fill="url(#rating-area)" />
            <polyline points={coords.join(' ')} fill="none" stroke="#040404" strokeWidth="2.5"
              strokeLinejoin="round" strokeLinecap="round" />
            {/* A régua do evento escolhido. */}
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom} stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3 3" />
            {values.map((v, i) => {
              const last = i === n - 1
              const on = i === active
              // Com muitos eventos, só o escolhido e o último levam ponto.
              if (n > 40 && !on && !last) return null
              return (
                <circle key={i} cx={x(i)} cy={y(v)} r={on ? 5.5 : last ? 4.5 : 2.5}
                  fill={last ? '#C5DD01' : '#FFFFFF'} stroke="#040404" strokeWidth={on || last ? 2 : 1.5} />
              )
            })}
            {/* A primeira e a última data, por baixo. */}
            <text x={PAD.left} y={H - 8} textAnchor="start"
              style={{ ...MONO, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {dateLabel(rated[0])}
            </text>
            <text x={W - PAD.right} y={H - 8} textAnchor="end"
              style={{ ...MONO, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {dateLabel(rated[n - 1])}
            </text>
          </svg>
        ) : (
          <div style={{ height: H }} />
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted">{t('playerstats.chart_hint')}</p>
    </div>
  )
}
