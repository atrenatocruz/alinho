// Gerir · encontrar um clube ou grupo (design-handoff/2026-09-28-gerir-lista-
// de-clubes; aprovado pelo Francisco a 28 set). Só com MAIS DE 5 clubes e
// grupos — até 5 o Gerir fica como estava. Procurar, as pastilhas «Todos ·
// Clubes · Grupos», os «Abertos há pouco» (só neste telemóvel), linhas curtas
// e os grupos de um clube por baixo dele (parent_organization_id).
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Avatar, Chips, orgAvatarShape } from '../ui'
import SearchField, { Realce, matchesQuery } from '../SearchField'
import { planName } from '../../lib/plans'

const RECENT_KEY = 'gerir.recent'
const FIRST = 5
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
const remember = (id) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 3))) } catch { /* sem armazenamento */ }
}
const isGroup = (o) => o.kind === 'group'

export default function OrgFinder({ orgs, joinRequestsByOrg }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [show, setShow] = useState('all')
  const [open, setOpen] = useState({ clubs: false, groups: false })

  const byId = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const clubs = orgs.filter((o) => !isGroup(o))
  const groups = orgs.filter(isGroup)
  // Grupos de um clube que está na lista: por baixo dele, não em «Grupos».
  const parentOf = (g) => (g.parent_organization_id && byId.get(g.parent_organization_id)) || null
  const childrenOf = (club) => groups.filter((g) => g.parent_organization_id === club.id)
  const looseGroups = groups.filter((g) => !parentOf(g) || isGroup(parentOf(g)))
  const recent = readRecent().map((id) => byId.get(id)).filter(Boolean)

  const subtitle = (o, { nested = false, withClub = false } = {}) => {
    const plan = planName(o.plan_tier)
    if (!isGroup(o)) return t('gerir.row_club', { plan })
    const parent = parentOf(o)
    if (parent && !isGroup(parent)) {
      return withClub ? t('gerir.row_group_of', { club: parent.name, plan }) : nested ? t('gerir.row_club_group', { plan }) : t('gerir.row_group_of', { club: parent.name, plan })
    }
    return t('gerir.row_group', { plan })
  }

  const row = (o, opts = {}) => {
    const pending = joinRequestsByOrg.get(o.id) || 0
    return (
      <Link key={`${opts.keyPrefix || ''}${o.id}`} to={pending > 0 ? `/gerir/${o.slug}?tab=members` : `/gerir/${o.slug}`} onClick={() => remember(o.id)}
        className={`flex items-center gap-3 border-b border-line py-2.5 pr-3 last:border-b-0 hover:bg-ink-50 ${opts.nested ? 'bg-surface/60 pl-9' : 'pl-3'}`}>
        <Avatar name={o.name} url={o.group_logo_url} size={opts.nested ? 'w-8 h-8 text-[11px]' : 'w-10 h-10 text-xs'} shape={orgAvatarShape(o.kind)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-extrabold text-ink-900"><Realce text={o.name} query={query} /></span>
          <span className="block truncate text-xs text-muted">{subtitle(o, opts)}</span>
        </span>
        {pending > 0 && (
          <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-lime-400 px-1 text-[11px] font-extrabold tabular-nums text-ink-900">{pending}</span>
        )}
        <ChevronRight size={16} className="shrink-0 text-muted" />
      </Link>
    )
  }
  const box = (children) => <div className="overflow-hidden rounded-card border border-line bg-white">{children}</div>
  const heading = (label, count) => (
    <p className="mb-2 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-widest text-muted">
      <span>{label}</span>{count != null && <span className="normal-case tracking-normal tabular-nums">{count}</span>}
    </p>
  )
  const more = (key, total, labelKey) => (!open[key] && total > FIRST ? (
    <button type="button" onClick={() => setOpen((x) => ({ ...x, [key]: true }))}
      className="flex w-full items-center gap-1 px-3 py-3 text-left text-sm font-extrabold text-ink-900 hover:bg-ink-50">
      {t(labelKey, { count: total })} <ChevronDown size={16} />
    </button>
  ) : null)

  const chips = (
    <Chips label={t('gerir.search_placeholder')} value={show} onChange={setShow} options={[
      { value: 'all', label: t('gerir.filter_all') },
      { value: 'clubs', label: t('gerir.filter_clubs', { count: clubs.length }) },
      { value: 'groups', label: t('gerir.filter_groups', { count: groups.length }) },
    ]} />
  )

  // A procurar: clubes e grupos juntos, só o que tem essas letras.
  if (query.trim()) {
    const found = orgs
      .filter((o) => (show === 'all' || (show === 'clubs' ? !isGroup(o) : isGroup(o))) && matchesQuery(o.name, query))
      .sort((a, b) => Number(isGroup(a)) - Number(isGroup(b)) || a.name.localeCompare(b.name, 'pt'))
    return (
      <div className="space-y-3">
        <SearchField value={query} onChange={setQuery} placeholder={t('gerir.search_placeholder')} />
        {chips}
        <div>
          {heading(t('gerir.results', { count: found.length }))}
          {found.length === 0
            ? <p className="text-sm text-muted">{t('gerir.no_results')}</p>
            : box(found.map((o) => row(o, { withClub: true })))}
        </div>
      </div>
    )
  }

  const clubRows = (open.clubs ? clubs : clubs.slice(0, FIRST))
  const groupRows = (open.groups ? looseGroups : looseGroups.slice(0, FIRST))
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <SearchField value={query} onChange={setQuery} placeholder={t('gerir.search_placeholder')} />
        {chips}
      </div>
      {show === 'all' && recent.length > 0 && (
        <div>
          {heading(t('gerir.recent'))}
          {box(recent.map((o) => row(o, { keyPrefix: 'r-', withClub: true })))}
        </div>
      )}
      {show !== 'groups' && clubs.length > 0 && (
        <div>
          {heading(t('gerir.section_clubs'), clubs.length)}
          {box(<>
            {clubRows.flatMap((c) => [row(c), ...childrenOf(c).map((g) => row(g, { nested: true }))])}
            {more('clubs', clubs.length, 'gerir.see_all_clubs')}
          </>)}
        </div>
      )}
      {show !== 'clubs' && (show === 'groups' ? groups : looseGroups).length > 0 && (
        <div>
          {/* A pastilha conta todos; aqui diz-se onde estão os outros (designer, 28 set). */}
          {heading(t('gerir.section_groups'), show !== 'groups' && looseGroups.length < groups.length
            ? t('gerir.groups_count_inside', { count: looseGroups.length, inside: groups.length - looseGroups.length })
            : (show === 'groups' ? groups : looseGroups).length)}
          {box(show === 'groups'
            ? groups.map((g) => row(g, { withClub: true }))
            : <>{groupRows.map((g) => row(g))}{more('groups', looseGroups.length, 'gerir.see_all_groups')}</>)}
        </div>
      )}
    </div>
  )
}
