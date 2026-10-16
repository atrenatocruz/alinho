import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Check } from 'lucide-react'
import KindHero from '../KindHero'
import { Avatar } from '../ui'
import { COVER_PRESETS, coverOf } from '../../lib/orgCover'

/* A folha «Capa do clube» (Gerir › Clube, proposta A — Renato, 16 out).
   Em cima, a capa como vai ficar, com o logótipo por cima; por baixo, as
   capas do alinho e «Carregar». Uma foto carregada ajusta-se na vertical
   (o recorte é panorâmico, 3:1) antes de gravar — nunca fica cortada no
   sítio errado. Nada grava até «Usar esta capa».
   O KindHero já é `relative`: para o pôr a toda a área, vai dentro de uma
   caixa `absolute` (com as duas classes juntas ganhava o relative e a capa
   ficava com altura zero — as pré-visualizações apareciam vazias). */

export default function CoverSheet({ org, onSave, onRemove, onClose }) {
  const { t } = useTranslation()
  const fileRef = useRef(null)
  const [choice, setChoice] = useState(org.cover_url || null) // url de preset, ou null = a do Alino
  const [file, setFile] = useState(null)
  const [fileUrl, setFileUrl] = useState(null)
  const [y, setY] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl) }, [fileUrl])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const pickFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setFile(f)
    setFileUrl(URL.createObjectURL(f))
    setY(50)
  }
  const pickPreset = (url) => { setFile(null); setFileUrl(null); setChoice(url) }

  const group = org.kind === 'group'
  const shown = fileUrl || coverOf(org, choice)
  const changed = !!file || (choice || null) !== (org.cover_url || null)

  const save = async () => {
    setBusy(true); setError('')
    try {
      await onSave(file ? { file, y: y / 100 } : { url: choice })
      onClose()
    } catch (err) {
      console.error('Error saving cover:', err)
      setError(t('cover.error_save'))
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true); setError('')
    try { await onRemove(); onClose() } catch (err) {
      console.error('Error removing cover:', err)
      setError(t('cover.error_save'))
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4"
      onClick={() => { if (!busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="cover-sheet-title" onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-card sm:rounded-card bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-lift animate-pop">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <h3 id="cover-sheet-title" className="font-display text-lg font-extrabold text-ink-900">{t(group ? 'cover.title_group' : 'cover.title_club')}</h3>

        {/* A capa como vai ficar. */}
        <div className="mt-3 overflow-hidden rounded-card border border-line">
          <div className="relative aspect-[3/1]">
            {fileUrl
              ? <img src={fileUrl} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: `50% ${y}%` }} />
              : <div className="absolute inset-0"><KindHero kind="club" src={shown} className="h-full w-full" /></div>}
            {fileUrl && <span className="pointer-events-none absolute inset-2 rounded-ctrl border-2 border-dashed border-white/85" aria-hidden="true" />}
          </div>
          <div className="relative h-8 bg-white">
            <span className={`absolute -top-6 left-3 inline-block bg-white p-[2px] ${group ? 'rounded-full' : 'rounded-[28%]'}`}>
              <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" shape={group ? 'round' : 'square'} colorClass="bg-ink-900 text-lime-400" />
            </span>
          </div>
        </div>

        {fileUrl ? (
          <label className="mt-3 block">
            <span className="text-sm text-muted">{t('cover.position')}</span>
            <input type="range" min="0" max="100" value={y} onChange={(e) => setY(Number(e.target.value))}
              className="mt-1 w-full accent-ink-900" />
          </label>
        ) : (
          <p className="mt-3 text-sm text-muted">{t('cover.hint')}</p>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={t('cover.options_aria')}>
          {COVER_PRESETS.map((p) => {
            const on = !file && coverOf(org, choice) === p.url
            return (
              <button key={p.key} type="button" onClick={() => pickPreset(p.url)} aria-pressed={on}
                className={`relative h-16 overflow-hidden rounded-ctrl ring-offset-2 ${on ? 'ring-2 ring-ink-900' : ''}`}>
                <div className="absolute inset-0"><KindHero kind="club" src={p.url} className="h-full w-full" /></div>
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-3 text-left text-[11px] font-extrabold text-white">{t(p.labelKey)}</span>
                {on && <Check size={14} className="absolute right-1.5 top-1.5 rounded-full bg-white p-0.5 text-ink-900" />}
              </button>
            )
          })}
          <button type="button" onClick={() => fileRef.current?.click()} aria-pressed={!!file}
            className={`flex h-16 flex-col items-center justify-center gap-0.5 rounded-ctrl border-[1.5px] bg-surface text-[12px] font-extrabold text-ink-900 ${file ? 'border-ink-900' : 'border-line'}`}>
            <Plus size={16} /> {file ? t('cover.other_photo') : t('cover.upload')}
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} className="hidden" />
        </div>

        {error && <p role="alert" className="mt-3 text-sm font-extrabold text-danger">{error}</p>}

        <div className="mt-4 space-y-2">
          <button type="button" onClick={save} disabled={busy || !changed}
            className="w-full min-h-[52px] rounded-ctrl bg-lime-400 px-4 text-[15px] font-extrabold text-ink-900 hover:bg-lime-600 disabled:opacity-40">
            {busy ? t('cover.saving') : t('cover.use')}
          </button>
          {org.cover_url && !file && (
            <button type="button" onClick={remove} disabled={busy}
              className="w-full min-h-[48px] rounded-ctrl px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
              {t('cover.reset')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
