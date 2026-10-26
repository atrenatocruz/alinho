import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useFeatureFlag } from '../../lib/useFeatureFlag'
import { myManagedPartners, partnerListVouchers } from '../../lib/partnerAdmin'

/* Gerir › «PARCEIROS» (design-handoff/2026-10-22-parceiro-gerir, ponto 1): só
   a quem gere um parceiro (my_managed_partners). Uma linha como a dos
   clubes: o logótipo, o nome, «Parceiro · n códigos por usar» e «›». */
export default function ManagedPartnersSection() {
  const { t } = useTranslation()
  const flag = useFeatureFlag('parceiros')
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!flag.on) return
    let alive = true
    myManagedPartners()
      .then((list) => Promise.all(list.map((p) => partnerListVouchers(p.id, null)
        .then((vs) => ({ ...p, open: vs.filter((v) => v.status === 'por_usar').length }))
        .catch(() => ({ ...p, open: 0 })))))
      .then((list) => { if (alive) setRows(list) })
      .catch(() => {})
    return () => { alive = false }
  }, [flag.on])

  if (!flag.on || rows.length === 0) return null
  return (
    <div className="space-y-3">
      <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">{t('partneradmin.section')}</p>
      {rows.map((p) => (
        <Link key={p.id} to={`/gerir/parceiro/${p.slug}`} className="press flex items-center gap-3 rounded-[22px] bg-white px-4 py-3.5 shadow-card">
          {p.logo_url
            ? <img src={p.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-[28%] object-cover" />
            : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[28%] bg-ink-900 font-display text-sm font-extrabold text-lime-400">{String(p.name).slice(0, 2).toUpperCase()}</span>}
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[17px] font-extrabold leading-tight text-ink-900">{p.name}</span>
            <span className="block text-sm text-muted">{[t('partneradmin.kind'), t('partneradmin.open_codes', { count: p.open })].join(' · ')}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-muted" />
        </Link>
      ))}
    </div>
  )
}
