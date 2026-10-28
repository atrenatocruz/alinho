import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { medalUrl } from '../../lib/achievementMedals'
import { RARITY_META, formatRarityPct } from '../../lib/achievements'
import AchievementWhen from './AchievementWhen'
import './achievementsFx.css'

// Partilhar a conquista (SPEC 2026-10-13-partilhar-conquistas): só carrega ao abrir.
const AchievementShareFlow = lazy(() => import('./AchievementShareFlow'))

/* O cartão de uma conquista no meio do ecrã (design-handoff/2026-10-12-
   conquistas-animadas). Ganha: vira e cresce, raios na cor da raridade a
   rodar, a medalha a flutuar, confetis nas raras/épicas/lendárias; os lados
   espreitam e desliza-se entre as ganhas. Por ganhar: a cinzento, sem
   confetis nem lados, «Fechar». Fecha com o botão, tocando fora ou Esc.

   items: [{ key, rarity, pct?, at? }] (as ganhas, pela ordem a percorrer), start:
   o índice a abrir. locked: abre uma só, por ganhar. celebrate: a festa de
   uma conquista nova («Partilhar» por cima e «Boa!» em contorno); sem ela,
   numa ganha, «↗ Partilhar a conquista» e «Fechar» (UX, 16 out). owner:
   { id, name, avatar_url } quando as conquistas são de outra pessoa (o
   perfil dela): «O Bruno ganhou…» e a imagem com ela (Francisco, 16 out). */

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

const CONFETTI_COLORS = {
  raro: ['#6CB8FF', '#C5DD01', '#fff'],
  epico: ['#C39BFF', '#C5DD01', '#fff'],
  lendario: ['#FFE27A', '#C5DD01', '#fff', '#F5B91C'],
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function runConfetti(canvas, rarity) {
  const cols = CONFETTI_COLORS[rarity]
  if (!canvas || !cols || reducedMotion()) return () => {}
  const ctx = canvas.getContext('2d')
  const W = (canvas.width = canvas.clientWidth * 2)
  const H = (canvas.height = canvas.clientHeight * 2)
  const n = rarity === 'lendario' ? 140 : 80
  const ps = Array.from({ length: n }, () => ({
    x: W / 2, y: H * 0.42,
    vx: (Math.random() - 0.5) * 26, vy: -Math.random() * 26 - 6,
    s: 6 + Math.random() * 8, c: cols[(Math.random() * cols.length) | 0],
    a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
  }))
  let t = 0
  let raf = 0
  const frame = () => {
    ctx.clearRect(0, 0, W, H)
    for (const p of ps) {
      p.vy += 0.7; p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.a += p.va
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a)
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2)
      ctx.restore()
    }
    if (++t < 110) raf = requestAnimationFrame(frame)
    else ctx.clearRect(0, 0, W, H)
  }
  raf = requestAnimationFrame(frame)
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H) }
}

export default function AchievementViewer({ items, start = 0, locked = false, celebrate = false, owner = null, onClose }) {
  const { t, i18n } = useTranslation()
  const [i, setI] = useState(start)
  const canvasRef = useRef(null)
  const swipeX = useRef(null)
  const [sharing, setSharing] = useState(null)
  const n = items.length
  const a = items[i] || items[0]
  const rarity = RARITY_META[a.rarity] ? a.rarity : 'comum'
  const many = !locked && n > 1
  const go = (d) => setI((v) => (v + d + n) % n)

  useEffect(() => {
    const onKey = (e) => {
      if (sharing) return
      if (e.key === 'Escape') onClose()
      else if (many && e.key === 'ArrowRight') go(1)
      else if (many && e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Confetis um pouco depois de o cartão virar — só nas ganhas não comuns.
  useEffect(() => {
    if (locked || rarity === 'comum') return undefined
    let stop = () => {}
    const id = setTimeout(() => { stop = runConfetti(canvasRef.current, rarity) }, 650)
    return () => { clearTimeout(id); stop() }
  }, [i, locked, rarity])

  const prev = many ? items[(i - 1 + n) % n] : null
  const next = many ? items[(i + 1) % n] : null
  const name = t(`achievements.${a.key}_name`)
  const medal = medalUrl(a.key)
  const lockCls = locked ? ' achv-lock' : ''

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className={`achv-ov achv-r-${rarity}${lockCls}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div key={`r${i}`} className="achv-rays" aria-hidden="true" />
      {rarity === 'lendario' && !locked && <div className="achv-streaks" aria-hidden="true" />}

      <span key={`p${i}`} className="achv-pill">
        {locked ? t('achievements.fx_locked_pill') : t(RARITY_META[rarity].labelKey)}
      </span>

      <div
        className="achv-stage"
        onPointerDown={(e) => { swipeX.current = e.clientX }}
        onPointerUp={(e) => {
          if (swipeX.current == null || !many) return
          const dx = e.clientX - swipeX.current
          swipeX.current = null
          if (dx < -40) go(1)
          else if (dx > 40) go(-1)
        }}
      >
        {prev && (
          <button type="button" aria-label={t(`achievements.${prev.key}_name`)} onClick={() => go(-1)}
            className={`achv-side achv-side-l achv-r-${prev.rarity}`}>
            <div><img src={medalUrl(prev.key) || undefined} alt="" /></div>
          </button>
        )}
        {next && (
          <button type="button" aria-label={t(`achievements.${next.key}_name`)} onClick={() => go(1)}
            className={`achv-side achv-side-r achv-r-${next.rarity}`}>
            <div><img src={medalUrl(next.key) || undefined} alt="" /></div>
          </button>
        )}
        <div key={`c${i}`} className={`achv-glow achv-r-${rarity}${lockCls}`}>
        <div className={`achv-big achv-r-${rarity}${lockCls}`}>
          <div className="achv-big-in">
            {medal ? <img className="achv-big-img" src={medal} alt="" /> : (
              <span className="achv-big-img grid place-items-center"><Lock size={48} className="text-white/40" /></span>
            )}
            <h3>{name}</h3>
            <p>{t(`achievements.${a.key}_desc`)}</p>
            {/* «12,5% têm» (Francisco, 11 out: não perder a percentagem; UX: na
                cor da raridade, também nas por ganhar). */}
            {a.pct != null && (
              <span className={`mt-2.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold tabular-nums ${locked ? 'bg-white/10 text-white/70' : RARITY_META[rarity].pill}`}>
                {t('achievements.rarity_pct', { pct: formatRarityPct(a.pct, i18n.language) })}
              </span>
            )}
          </div>
        </div>
        </div>
      </div>

      <div key={`m${i}`} className="achv-meta">
        {/* Ganha, com o quando e com quem da base (v2): o dia, o evento, o
            parceiro e a dupla vencida. Sem ele, a frase de sempre. */}
        {!locked && a.ctx ? <AchievementWhen ctx={a.ctx} owner={owner} onNavigate={onClose} /> : (
          <p className="text-xs text-white/60">
            {locked ? (owner ? t('achievements.fx_locked_note_other', { name: firstName(owner.name) }) : t('achievements.fx_locked_note'))
              : owner ? t('achievements.fx_earned_note_other', { name: firstName(owner.name) })
              : t('achievements.fx_earned_note')}
          </p>
        )}
        {/* Ganha: «Partilhar» a lima por cima e, por baixo, «Boa!» (na festa)
            ou «Fechar», em contorno claro — um só botão lima (SPEC de partilhar
            as conquistas, 13 out). Por ganhar: só «Fechar», sem partilhar. */}
        {!locked && (
          <button type="button" onClick={() => setSharing(a)}
            className="press mt-3.5 w-full min-h-[48px] rounded-ctrl bg-lime-400 font-extrabold text-[15px] text-ink-900">
            {celebrate ? t('achshare.share') : `↗ ${t('achshare.share_achievement')}`}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`press ${locked ? 'mt-3.5' : 'mt-2'} w-full min-h-[48px] rounded-ctrl border-2 border-white/80 bg-transparent font-extrabold text-[15px] text-white`}
        >
          {celebrate && !locked ? t('achievements.fx_ok') : t('achievements.fx_close')}
        </button>
      </div>

      <canvas ref={canvasRef} className="achv-confetti" aria-hidden="true" />
      {sharing && (
        <Suspense fallback={null}>
          <AchievementShareFlow achievement={sharing} fresh={celebrate} owner={owner} onClose={() => setSharing(null)} />
        </Suspense>
      )}
    </div>,
    document.body,
  )
}
