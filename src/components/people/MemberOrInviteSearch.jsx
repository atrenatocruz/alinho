import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../ui'
import { membersMatching } from '../../lib/memberSearch'

const EMPTY = { forQuery: '', results: [] }
const KICKER = 'px-3 pb-1 pt-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'
const ROW = 'flex w-full items-center gap-3 p-3 text-left hover:bg-ink-50'
const keepFocus = (e) => e.preventDefault()

// Gerir › Pessoas (#776, SPEC de 9 nov): um só campo. Por cima quem já é membro,
// com a folha do «···»; por baixo os outros jogadores, para convidar. Os membros
// vêm da lista que o ecrã já tem, por isso nenhum fica de fora por haver muitos
// jogadores com nomes parecidos na app.
export default function MemberOrInviteSearch({ label, members, ownerId, searchFn, onOpenMember, onInvite }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState(EMPTY)
  const [open, setOpen] = useState(false)

  const trimmed = query.trim()
  const isSearching = trimmed.length >= 2

  useEffect(() => {
    if (trimmed.length < 2) {
      setRemote(EMPTY)
      return undefined
    }
    let stale = false
    const timer = setTimeout(async () => {
      let results = []
      try {
        results = (await searchFn(trimmed)) || []
      } catch (error) {
        console.error('Error searching players:', error)
      }
      if (!stale) setRemote({ forQuery: trimmed, results })
    }, 300)
    return () => { stale = true; clearTimeout(timer) }
  }, [trimmed, searchFn])

  const foundMembers = useMemo(() => (isSearching ? membersMatching(members, trimmed) : []), [isSearching, members, trimmed])
  const others = useMemo(() => {
    if (!isSearching) return []
    const memberIds = new Set((members || []).map((m) => m.id))
    return remote.results.filter((p) => !memberIds.has(p.id))
  }, [isSearching, members, remote.results])

  const clear = () => { setQuery(''); setRemote(EMPTY); setOpen(false) }
  const nothingFound = isSearching && remote.forQuery === trimmed && foundMembers.length === 0 && others.length === 0
  const showBox = open && (foundMembers.length > 0 || others.length > 0 || nothingFound)

  const roleOf = (member) => (
    member.id === ownerId ? t('people.role_owner') : member.is_admin ? t('people.role_admin') : t('people.role_member')
  )
  const person = (member) => (
    <>
      <Avatar name={member.name} url={member.avatar_url} size="w-9 h-9 text-sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold text-ink-900">{member.name}</span>
        <span className="block truncate text-xs text-muted">{roleOf(member)}</span>
      </span>
    </>
  )

  return (
    <div className="relative">
      <div className="flex items-center gap-2 input-field focus-within:border-ink-500 focus-within:ring-2 focus-within:ring-ink-50">
        <Search size={16} className="shrink-0 text-muted" />
        {/* text-base (16 px): abaixo disso o Safari iOS faz zoom ao focar o campo. */}
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={label}
          aria-label={label}
          className="flex-1 bg-transparent text-base outline-none"
        />
      </div>
      {showBox && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-ctrl border border-line bg-white shadow-lift">
          {nothingFound && <p className="p-3 text-center text-sm text-muted">{t('playersearch.no_players_found')}</p>}
          {foundMembers.length > 0 && (
            <>
              <p className={KICKER}>{t('clubprofile.members_title')}</p>
              <div className="divide-y divide-line">
                {foundMembers.map((member) => (member.id === ownerId ? (
                  // O dono não tem «···»: abre o perfil, como na lista.
                  <Link key={member.id} to={`/jogador/${member.id}`} onMouseDown={keepFocus} onClick={clear} className={ROW}>
                    {person(member)}
                  </Link>
                ) : (
                  <button key={member.id} type="button" onMouseDown={keepFocus}
                    onClick={() => { clear(); onOpenMember(member) }}
                    aria-label={t('people.actions_aria', { name: member.name })} className={ROW}>
                    {person(member)}
                    <MoreHorizontal size={20} className="shrink-0 text-ink-700" />
                  </button>
                )))}
              </div>
            </>
          )}
          {others.length > 0 && (
            <>
              <p className={KICKER}>{t('gerirclube.search_other_players')}</p>
              <div className="divide-y divide-line">
                {others.map((player) => (
                  <button key={player.id} type="button" onMouseDown={keepFocus}
                    onClick={() => { clear(); onInvite(player) }} className={ROW}>
                    <Avatar name={player.name} url={player.avatar_url} size="w-9 h-9 text-sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-ink-900">{player.name}</span>
                    <span className="shrink-0 text-sm font-extrabold text-ink-900">{t('gerirclube.search_invite_action')}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
