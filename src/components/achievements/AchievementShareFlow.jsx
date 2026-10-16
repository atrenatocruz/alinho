// Partilhar uma conquista (design-handoff/2026-10-13-partilhar-conquistas,
// versão B; UX, 16 out): o fluxo dos vencedores — a pré-visualização, a
// escolha «Stories · Quadrado» (pastilhas soltas), o texto sugerido, e
// «Partilhar» (lima) e «Guardar a imagem» (contorno), empilhados.
// Só se abre para uma conquista ganha (quem chama garante-o).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import AchievementShareCard, { A_CARD_W, A_SQUARE_H, A_STORY_H } from './AchievementShareCard'
import { bakeCircle } from '../tournament/TournamentShareCard'
import { FilterPill } from '../ui'
import { medalUrl } from '../../lib/achievementMedals'
import { RARITY_META, formatRarityPct } from '../../lib/achievements'
import { formatDate } from '../../lib/formatDate'
import { qrDataUrl, shareFilename, shareOrSaveImage } from '../../lib/shareImage'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

const PREVIEW_SCALE = 0.62

/** «SÁB 27 SET» — o dia em mono, no canto do cartão. */
const shortDay = (d, lang) => `${formatDate(d, lang, { weekday: 'short' }).replace(/\./g, '').slice(0, 3)} ${d.getDate()} ${formatDate(d, lang, { month: 'short' }).replace(/\./g, '')}`
  .toUpperCase()
/** «16 out 2026» (UX, 16 out: não «16/10/2026»). */
const longDay = (d, lang) => `${d.getDate()} ${formatDate(d, lang, { month: 'short' }).replace(/\./g, '')} ${d.getFullYear()}`

/** achievement: { key, rarity, pct?, at? (quando foi ganha) } */
export default function AchievementShareFlow({ achievement: given, onClose }) {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const lang = i18n.language
  const [format, setFormat] = useState('stories')
  const [qr, setQr] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const cardRef = useRef(null)
  // Na festa de uma conquista nova não vem a «% têm» nem a data: vão-se
  // buscar às conquistas da pessoa (as mesmas do perfil).
  const [extra, setExtra] = useState(null)
  useEffect(() => {
    if (given.pct != null || !profile?.id) return undefined
    let alive = true
    supabase.rpc('get_player_achievements', { p_user_id: profile.id }).then(({ data }) => {
      const row = (data || []).find((r) => r.achievement_key === given.key)
      if (alive && row) setExtra({ pct: row.rarity_pct, at: row.awarded_at })
    })
    return () => { alive = false }
  }, [given.key, given.pct, profile?.id])
  const achievement = { ...given, pct: given.pct ?? extra?.pct ?? null, at: given.at ?? extra?.at ?? null }
  const rarity = RARITY_META[achievement.rarity] ? achievement.rarity : 'comum'
  const name = t(`achievements.${achievement.key}_name`)
  const pct = achievement.pct != null ? formatRarityPct(achievement.pct, lang) : null
  // «Só 13,1%…»; com 50% ou mais, sem o «Só» (SPEC).
  const pctLine = pct == null ? null : t(Number(achievement.pct) < 50 ? 'achshare.pct_only' : 'achshare.pct', { pct })
  const at = achievement.at ? new Date(achievement.at) : new Date()
  const suggested = [
    t('achshare.caption_lead', { name }),
    pct != null ? t(Number(achievement.pct) < 50 ? 'achshare.caption_pct_only' : 'achshare.caption_pct', { pct }) : null,
    'alinho.pt @alinhopt #alinhopadel',
  ].filter(Boolean).join(' ')
  // O texto sugerido acompanha a «% têm» quando ela chega, até a pessoa o mudar.
  const [edited, setEdited] = useState(null)
  const caption = edited ?? suggested
  const setCaption = setEdited

  // O QR leva a https://alinho.pt (SPEC), com a referência de quem partilhou.
  useEffect(() => {
    qrDataUrl(`https://alinho.pt${profile?.id ? `/?ref=${profile.id}` : ''}`, { size: 240 })
      .then(setQr).catch((err) => console.error('Error making the QR:', err))
  }, [profile?.id])
  // A foto da pessoa, já redonda (o WebKit estraga o redondo por CSS).
  useEffect(() => {
    let alive = true
    bakeCircle(profile?.avatar_url, 28).then((v) => { if (alive) setPhoto(v) })
    return () => { alive = false }
  }, [profile?.avatar_url])

  const data = {
    name,
    desc: t(`achievements.${achievement.key}_desc`),
    medal: medalUrl(achievement.key),
    // A raridade concorda com «conquista»: «LENDÁRIA», «ÉPICA» (UX, 16 out).
    kicker: `${t('achshare.kicker')} · ${t(`achshare.rarity_${rarity}`)}`,
    date: shortDay(at, lang),
    pctLine,
    person: profile ? {
      name: profile.name || '',
      photo,
      // A primeira letra de cada palavra: «Admin (Dev)» → «AD», nunca «A(».
      initials: (profile.name || '?').split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?',
      sub: t('achshare.since', { date: longDay(at, lang) }),
    } : null,
  }

  const run = async (mode) => {
    setBusy(true); setError(''); setSaved(false)
    try {
      const blob = await cardRef.current.exportPng()
      const filename = shareFilename('conquista', achievement.key, format === 'square' ? 'quadrado' : null)
      if (mode === 'save') {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = filename
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setSaved(true)
      } else {
        const out = await shareOrSaveImage(blob, { filename, title: name, text: caption })
        if (out === 'saved') setSaved(true)
      }
    } catch (err) {
      console.error('Error sharing the achievement:', err)
      setError(t('tshare.share_error'))
    } finally { setBusy(false) }
  }

  const H = format === 'square' ? A_SQUARE_H : A_STORY_H
  return createPortal(
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-lg space-y-4 px-4 pb-10 pt-4">
        <button type="button" onClick={onClose} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-700">
          <ArrowLeft size={20} /> {t('common.back')}
        </button>
        <h2 className="text-3xl text-ink-900">{t('achshare.title')}</h2>
        {/* O cartão a sério, reduzido só no ecrã: o que se exporta é o de 360 de largura. */}
        <div className="mx-auto overflow-hidden rounded-[14px] shadow-lift" style={{ width: A_CARD_W * PREVIEW_SCALE, height: H * PREVIEW_SCALE }}>
          <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
            <AchievementShareCard ref={cardRef} rarity={rarity} data={data} format={format} qr={qr} />
          </div>
        </div>
        <div className="flex justify-center gap-1.5" role="group" aria-label={t('achshare.format')}>
          <FilterPill on={format === 'stories'} onClick={() => setFormat('stories')}>{t('achshare.stories')}</FilterPill>
          <FilterPill on={format === 'square'} onClick={() => setFormat('square')}>{t('achshare.square')}</FilterPill>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">{t('tshare.text_label')}</p>
          <textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} className="input-field" />
        </div>
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <div className="space-y-2">
          <button type="button" onClick={() => run('share')} disabled={busy || (format === 'stories' && !qr)}
            className="press w-full min-h-[52px] rounded-ctrl bg-lime-400 px-4 font-display text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
            {t('achshare.share')}
          </button>
          <button type="button" onClick={() => run('save')} disabled={busy}
            className="press w-full min-h-[52px] rounded-ctrl border-[1.5px] border-[#CFD2D7] bg-white px-4 font-display text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
            {t('achshare.save')}
          </button>
          {saved && <p className="text-center text-xs text-muted">{t('tshare.saved_hint')}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
