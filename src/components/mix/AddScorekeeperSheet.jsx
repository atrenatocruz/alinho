// «Juntar marcador» (design-handoff/2026-09-30-mix-marcadores, aprovado pelo
// Francisco a 30 set): quem organiza escolhe quem pode marcar os resultados
// deste mix — quem joga ou qualquer pessoa do clube ou grupo. Primeiro quem
// está no mix, depois o resto; procura-se pelo nome; escolhem-se vários de
// uma vez. A base de dados só aceita membros do clube/grupo (not_member, Dev 3).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { Avatar } from '../ui'
import SearchField, { matchesQuery, Realce } from '../SearchField'
import { MonoLabel } from '../tournament/TournamentBits'

export default function AddScorekeeperSheet({ orgName, orgKind = 'group', inMix = [], fromClub = [], onConfirm, onClose }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isClub = orgKind !== 'group'

  const shownMix = useMemo(() => inMix.filter((p) => matchesQuery(p.name, query)), [inMix, query])
  const shownClub = useMemo(() => fromClub.filter((p) => matchesQuery(p.name, query)), [fromClub, query])

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const confirm = async () => {
    setBusy(true); setError('')
    try {
      await onConfirm([...picked])
      onClose()
    } catch (err) {
      console.error('Error adding scorekeepers:', err)
      setError((err?.message || '').includes('not_member') ? t('scorekeepers.error_not_member') : t('scorekeepers.error_generic'))
    } finally {
      setBusy(false)
    }
  }

  const row = (p) => (
    <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={picked.has(p.id)}
      className="flex w-full items-center gap-3 border-b border-line py-2.5 text-left last:border-0">
      <Avatar name={p.name} url={p.avatar_url} size="w-10 h-10 text-sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-extrabold text-ink-900"><Realce text={p.name} query={query} /></span>
        {p.is_admin && <span className="mt-0.5 inline-block rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-extrabold text-ink-700">{t('scorekeepers.admin_tag')}</span>}
      </span>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 ${picked.has(p.id) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white'}`}>
        {picked.has(p.id) && <Check size={16} strokeWidth={3} />}
      </span>
    </button>
  )

  return (
    <Sheet title={t('scorekeepers.add_title')} onClose={onClose}>
      <p className="text-sm text-ink-500">{t('scorekeepers.add_hint', { name: orgName || '' })}</p>
      <SearchField value={query} onChange={setQuery} className="mt-3"
        placeholder={t(isClub ? 'scorekeepers.search_club' : 'scorekeepers.search_group')} />
      {shownMix.length > 0 && (
        <>
          <MonoLabel className="mt-4 mb-1">{t('scorekeepers.section_mix')}</MonoLabel>
          <div>{shownMix.map(row)}</div>
        </>
      )}
      {shownClub.length > 0 && (
        <>
          <MonoLabel className="mt-4 mb-1">{t(isClub ? 'scorekeepers.section_club' : 'scorekeepers.section_group')}</MonoLabel>
          <div>{shownClub.map(row)}</div>
        </>
      )}
      {shownMix.length === 0 && shownClub.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">{t('scorekeepers.nobody_found')}</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm font-extrabold text-danger">{error}</p>}
      <button type="button" onClick={confirm} disabled={busy || picked.size === 0}
        className="mt-4 w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
        {t('scorekeepers.add_confirm', { count: picked.size })}
      </button>
    </Sheet>
  )
}
