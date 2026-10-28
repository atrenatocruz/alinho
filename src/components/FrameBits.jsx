import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { FRAME_COLOR, FRAME_TITLE_KEY, frameAroundPhoto, frameSrc } from '../lib/frames'
import { monthName } from '../lib/monthRanking'
import { Sheet } from './agenda/AgendaControls'

/* As molduras do pódio do mês no perfil (design-handoff/2026-10-12-
   molduras-podio, ponto 4): em grande, a moldura passa para fora da foto;
   por baixo do nome vem o título na cor da moldura e «<clube ou Ranking
   geral> · <mês>»; tocar mostra todas as que a pessoa tem este mês. */

/** Todas as molduras de uma pessoa agora (a melhor primeiro). */
export function useFrameList(userId) {
  const [list, setList] = useState([])
  useEffect(() => {
    if (!userId) return undefined
    let alive = true
    supabase.rpc('get_user_frame_list', { p_user_id: userId }).then(({ data, error }) => {
      if (!alive) return
      if (error) { if (error.code !== 'PGRST202') console.error('Error loading frame list:', error); setList([]); return }
      setList([...(data || [])].sort((a, b) => Number(b.best) - Number(a.best) || a.place - b.place))
    })
    return () => { alive = false }
  }, [userId])
  return list
}

/** A moldura em grande, à volta de uma foto redonda de `photo` px que está
 *  no canto (left, top) da caixa. Não apanha toques (a foto continua a abrir). */
export function FrameAround({ frame, photo, left = 0, top = 0 }) {
  const [failed, setFailed] = useState(false)
  const box = frame ? frameAroundPhoto(frame, photo) : null
  if (!box || failed) return null
  return (
    <img src={frameSrc(frame)} alt="" aria-hidden="true" onError={() => setFailed(true)}
      className="pointer-events-none absolute z-[1] max-w-none select-none"
      style={{ width: box.width, height: box.height, left: left + box.left, top: top + box.top }} />
  )
}

const scopeLine = (t, lang, f) => `${f.scope_name || t('frames.global')} · ${monthName(String(f.month).slice(0, 10), lang)}`

/** O título por baixo do nome; tocar abre a folha com todas. */
export function FrameTitle({ list, mine = true }) {
  const { t, i18n } = useTranslation()
  const lang = String(i18n.language || 'pt').slice(0, 2)
  const [open, setOpen] = useState(false)
  const best = list[0]
  if (!best) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-0.5 block text-left">
        {/* O «›» mostra que se pode tocar (UX, 12 out). */}
        <span className="block text-sm font-extrabold leading-tight" style={{ color: FRAME_COLOR[best.frame] }}>{t(FRAME_TITLE_KEY[best.frame])} ›</span>
        <span className="block text-[11px] text-muted">{scopeLine(t, lang, best)}{list.length > 1 ? ` · ${t('frames.more', { count: list.length - 1 })}` : ''}</span>
      </button>
      {open && (
        <Sheet title={t(mine ? 'frames.sheet_title' : 'frames.sheet_title_other')} onClose={() => setOpen(false)}>
          <p className="-mt-1 mb-3 text-sm text-muted">{t(mine ? 'frames.sheet_body' : 'frames.sheet_body_other')}</p>
          <div className="divide-y divide-line">
            {list.map((f, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <img src={frameSrc(f.frame)} alt="" className="h-12 w-12 object-contain" />
                <div className="min-w-0">
                  <p className="font-extrabold" style={{ color: FRAME_COLOR[f.frame], opacity: 1 }}>{t(FRAME_TITLE_KEY[f.frame])}</p>
                  <p className="text-xs text-muted">{t('frames.place', { place: f.place })} · {scopeLine(t, lang, f)}</p>
                  {i === 0 && <p className="mt-0.5 text-[11px] font-extrabold text-ink-900">{t('frames.in_use')}</p>}
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}
