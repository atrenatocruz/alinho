/* A pesquisa da Home (Home do futuro, SPEC-1, ponto 4 — design-handoff/
   2026-10-08-home-do-futuro, aprovado pelo Francisco a 9 out). Substitui a de
   25 set (só jogos): agora procura jogos, clubes e grupos, e pessoas.

   - Sem texto: «Pesquisas recentes» (pastilhas), «Clubes perto de ti» e
     «Pessoas que talvez conheças» (suggest_people do Dev 3; sem ela, a secção
     não aparece), com «Seguir» / «A seguir».
   - A escrever: «Jogos · N», «Clubes e grupos · N» e «Pessoas · N», com o
     texto procurado realçado. Os jogos procuram no nome, no clube e no sítio,
     sem acentos nem maiúsculas.
   - Perfil privado aparece sempre (1 out), só com o nome e a foto. */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { semAcentos, contemTexto } from '../../lib/semAcentos'
import { formatDate, formatTime } from '../../lib/formatDate'
import { fromDayKey } from '../../lib/agenda'
import { listGlobalOrganizations, searchOrganizations } from '../../lib/organizations'
import { searchPlayers } from '../../lib/privateMatches'
import { followPlayer, removeFollow } from '../../lib/follows'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { friendsMatchTitle, KIND_STYLE } from './EventCard'

import { eventTitle, eventMatches } from './homeSearchMatch'

export { eventMatches }

// O pedaço que bate com a pesquisa, realçado. NFD + tirar os acentos não muda
// o número de letras de um nome já composto, por isso as posições batem.
function Realce({ text, query }) {
  const q = semAcentos(query).trim()
  const i = q ? semAcentos(text).indexOf(q) : -1
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-lime-200 text-ink-900 rounded-sm px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

// ── Pesquisas recentes (só neste telemóvel) ────────────────────────────────
const RECENT_KEY = 'home.recentSearches'
export function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => typeof x === 'string').slice(0, 6) } catch { return [] }
}
export function rememberSearch(q) {
  const v = String(q || '').trim()
  if (v.length < 2) return
  try {
    const next = [v, ...readRecent().filter((x) => semAcentos(x) !== semAcentos(v))].slice(0, 6)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* sem memória */ }
}

/** «hoje» · «amanhã» · «sexta» (esta semana) · «13 out» (mais à frente). */
function whenShort(dayKey, todayKey, t, lang) {
  const days = Math.round((fromDayKey(dayKey) - fromDayKey(todayKey)) / 86400000)
  if (days === 0) return t('ui.today').toLowerCase()
  if (days === 1) return t('ui.tomorrow').toLowerCase()
  const d = fromDayKey(dayKey)
  if (days > 1 && days < 7) return formatDate(d, lang, { weekday: 'long' }).replace(/-feira$/, '')
  return `${d.getDate()} ${formatDate(d, lang, { month: 'short' }).replace('.', '')}`
}

const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
const Title = ({ children }) => <p className="mt-5 mb-1.5 text-[11px] font-extrabold uppercase tracking-widest text-muted first:mt-0">{children}</p>

/** «Seguir» em contorno; «A seguir» / «Pedido enviado» apagados. */
function FollowButton({ state, busy, onFollow, onUnfollow }) {
  const { t } = useTranslation()
  const base = 'shrink-0 min-h-[40px] rounded-full px-4 text-sm font-extrabold disabled:opacity-40'
  if (state === 'following') {
    // Nos clubes e grupos não se deixa de seguir daqui (faz-se na página deles).
    if (!onUnfollow) return <span className={`${base} inline-flex items-center border border-ink-900 bg-white text-ink-900`}>{t('homesearch.following')}</span>
    return <button type="button" disabled={busy} onClick={onUnfollow} className={`${base} border border-ink-900 bg-white text-ink-900`}>{t('homesearch.following')}</button>
  }
  if (state === 'pending') return <span className={`${base} inline-flex items-center border border-line bg-ink-50 text-muted`}>{t('homesearch.requested')}</span>
  return <button type="button" disabled={busy} onClick={onFollow} className={`${base} border border-ink-900 bg-white text-ink-900`}>{t('homesearch.follow')}</button>
}

function OrgRow({ org, query, state, busy, onFollow }) {
  return (
    <div className="flex min-h-[60px] items-center gap-3 border-b border-line/70 py-2 last:border-0">
      <Link to={`/clube/${org.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-900 text-xs font-extrabold text-lime-400">{initials(org.name)}</span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-extrabold text-ink-900"><Realce text={org.name} query={query} /></span>
          {(org.location || org.parent_name) && <span className="block truncate text-xs text-muted">{org.location || org.parent_name}</span>}
        </span>
      </Link>
      <FollowButton state={state} busy={busy} onFollow={onFollow} />
    </div>
  )
}

function PersonRow({ person, query, state, busy, onFollow, onUnfollow }) {
  const { t } = useTranslation()
  const sub = person.reason ? t(`homesearch.reason_${person.reason}`) : null
  return (
    <div className="flex min-h-[60px] items-center gap-3 border-b border-line/70 py-2 last:border-0">
      <Link to={`/jogador/${person.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {person.avatar_url
          ? <img src={person.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1E2A3A] text-xs font-extrabold text-white">{initials(person.name)}</span>}
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-extrabold text-ink-900"><Realce text={person.name || ''} query={query} /></span>
          {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
        </span>
      </Link>
      <FollowButton state={state} busy={busy} onFollow={onFollow} onUnfollow={onUnfollow} />
    </div>
  )
}

export default function HomeSearch({ events, query, todayKey, linkFor, location, onQuery, actionFor = () => null, errorFor = () => null }) {
  const { t, i18n } = useTranslation()
  const { user, followOrganization } = useAuth()
  const q = query.trim()

  // Quem já sigo (para «Seguir» / «A seguir»): id da linha e estado.
  const [follows, setFollows] = useState(new Map())
  useEffect(() => {
    if (!user?.id) return
    supabase.from('follows').select('id, followed_id, status').eq('follower_id', user.id)
      .then(({ data }) => setFollows(new Map((data || []).map((r) => [r.followed_id, { id: r.id, status: r.status }]))))
  }, [user?.id])
  const personState = (id) => {
    const f = follows.get(id)
    return f ? (f.status === 'accepted' ? 'following' : 'pending') : 'none'
  }
  const [busy, setBusy] = useState(null)
  const follow = async (id) => {
    setBusy(id)
    try {
      const status = await followPlayer(id)
      const { data } = await supabase.from('follows').select('id').eq('follower_id', user.id).eq('followed_id', id).maybeSingle()
      setFollows((m) => new Map(m).set(id, { id: data?.id, status }))
    } catch (err) { console.error('Error following:', err) } finally { setBusy(null) }
  }
  const unfollow = async (id) => {
    const row = follows.get(id)
    if (!row?.id) return
    setBusy(id)
    try {
      await removeFollow(row.id)
      setFollows((m) => { const n = new Map(m); n.delete(id); return n })
    } catch (err) { console.error('Error unfollowing:', err) } finally { setBusy(null) }
  }
  // Clubes e grupos: membro ou pedido feito, como na Comunidade.
  const [orgStatus, setOrgStatus] = useState({})
  const orgState = (o) => {
    const s = orgStatus[o.id] || o.my_status
    return s === 'member' || s === 'joined' ? 'following' : s === 'pending' ? 'pending' : 'none'
  }
  const followOrg = async (o) => {
    setBusy(o.id)
    const { data, error } = await followOrganization(o.id)
    if (error) console.error('Error following organization:', error)
    else setOrgStatus((m) => ({ ...m, [o.id]: data }))
    setBusy(null)
  }

  // Sem texto: os clubes perto de ti e as pessoas que talvez conheças.
  const [nearby, setNearby] = useState(null)
  const [suggested, setSuggested] = useState(null)
  useEffect(() => {
    if (q) return
    if (!nearby) {
      listGlobalOrganizations().then((list) => {
        const place = semAcentos(location?.label || '').split(/[,·]/)[0].trim()
        const clubs = list.filter((o) => o.kind !== 'group')
        // Sem coordenadas dos clubes, «perto» é o sítio escrito: os do mesmo
        // sítio primeiro, depois os outros.
        const near = place ? clubs.filter((o) => contemTexto(o.location || '', place)) : []
        setNearby([...near, ...clubs.filter((o) => !near.includes(o))].slice(0, 5))
      }).catch((err) => { console.error('Error loading clubs:', err); setNearby([]) })
    }
    if (!suggested) {
      supabase.rpc('suggest_people', { p_limit: 5 }).then(({ data, error }) => {
        if (error) { setSuggested([]); return } // sem a função do Dev 3 (PGRST202): não aparece
        setSuggested(data || [])
        setFollows((m) => {
          const n = new Map(m)
          for (const p of data || []) if (p.follow_status && p.follow_status !== 'none' && !n.has(p.id)) n.set(p.id, { status: p.follow_status === 'following' ? 'accepted' : 'pending' })
          return n
        })
      })
    }
  }, [q, nearby, suggested, location?.label])

  // A escrever: clubes e grupos, e pessoas (300 ms depois de parar).
  const [orgs, setOrgs] = useState([])
  const [people, setPeople] = useState([])
  useEffect(() => {
    if (q.length < 2) { setOrgs([]); setPeople([]); return undefined }
    const tm = setTimeout(() => {
      searchOrganizations(q).then(setOrgs).catch(() => setOrgs([]))
      searchPlayers(q).then((list) => setPeople(list.filter((p) => p.id !== user?.id))).catch(() => setPeople([]))
    }, 300)
    return () => clearTimeout(tm)
  }, [q, user?.id])

  if (!q) {
    const recent = readRecent()
    return (
      <div className="pt-1 pb-10">
        {recent.length > 0 && (
          <>
            <Title>{t('homesearch.recent')}</Title>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <button key={r} type="button" onClick={() => onQuery(r)}
                  className="min-h-[40px] rounded-full border border-line bg-white px-4 text-sm font-extrabold text-ink-900">{r}</button>
              ))}
            </div>
          </>
        )}
        {nearby?.length > 0 && (
          <>
            <Title>{t('homesearch.clubs_near')}</Title>
            {nearby.map((o) => <OrgRow key={o.id} org={o} query="" state={orgState(o)} busy={busy === o.id} onFollow={() => followOrg(o)} />)}
          </>
        )}
        {suggested?.length > 0 && (
          <>
            <Title>{t('homesearch.people_maybe')}</Title>
            {suggested.map((p) => <PersonRow key={p.id} person={p} query="" state={personState(p.id)} busy={busy === p.id}
              onFollow={() => follow(p.id)} onUnfollow={() => unfollow(p.id)} />)}
          </>
        )}
      </div>
    )
  }

  const games = events.filter((e) => e.dayKey && e.dayKey >= todayKey && !e.finished && eventMatches(e, q))
    .sort((a, b) => a.startsAt - b.startsAt).slice(0, 20)
  if (games.length + orgs.length + people.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <SearchX size={28} className="mx-auto text-muted" />
        <p className="mt-3 font-extrabold text-ink-900">{t('homesearch.none_title', { q })}</p>
        <p className="mt-1 text-sm text-muted">{t('homesearch.none_hint')}</p>
      </div>
    )
  }
  const remember = () => rememberSearch(q)
  return (
    <div className="pt-1 pb-10">
      {games.length > 0 && (
        <>
          <Title>{t('homesearch.games', { count: games.length })}</Title>
          {games.map((e) => {
            const title = eventTitle(e) || (e.kind === 'friends' ? friendsMatchTitle(e.raw || {}, user?.id, t) : '') || e.orgName || ''
            const sub = [e.orgName, KIND_STYLE[e.kind] ? t(KIND_STYLE[e.kind].labelKey) : null].filter(Boolean)
            const to = linkFor(e)
            const inside = e.myState === 'in'
            const action = inside ? null : actionFor(e)
            const err = errorFor(e)
            return (
              <div key={e.key} className="border-b border-line/70 py-2 last:border-0">
              <div className="flex min-h-[44px] items-center gap-3">
                <Link to={to || '#'} onClick={remember} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="w-12 shrink-0">
                    <span className="block text-[17px] font-extrabold leading-none text-ink-900 tabular-nums">{e.hasTime ? formatTime(e.startsAt, i18n.language, { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                    <span className="mt-1 block text-[11px] font-semibold text-muted">{whenShort(e.dayKey, todayKey, t, i18n.language)}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-extrabold text-ink-900"><Realce text={title} query={q} /></span>
                    <span className="block truncate text-xs text-muted">
                      {sub.map((s, i) => <span key={i}>{i > 0 && ' · '}<Realce text={String(s)} query={q} /></span>)}
                    </span>
                  </span>
                </Link>
                {inside ? (
                  <span className="shrink-0 text-sm font-extrabold text-ok">✓ {t('homesearch.inside')}</span>
                ) : action ? (
                  <button type="button" disabled={action.busy} onClick={() => { remember(); action.onAction() }}
                    className={`shrink-0 inline-flex min-h-[36px] items-center rounded-ctrl px-3 text-[13px] font-extrabold disabled:opacity-50 ${action.kind === 'join' ? 'bg-lime-400 text-ink-900' : 'border border-ink-900 bg-white text-ink-900'}`}>
                    {action.label || t(action.kind === 'join' ? 'homesearch.join' : 'ui.action_waitlist')}
                  </button>
                ) : null}
              </div>
              {err && <p role="alert" className="mt-1.5 text-xs font-extrabold text-danger">{err}</p>}
              </div>
            )
          })}
        </>
      )}
      {orgs.length > 0 && (
        <>
          <Title>{t('homesearch.orgs', { count: orgs.length })}</Title>
          {orgs.slice(0, 10).map((o) => <OrgRow key={o.id} org={o} query={q} state={orgState(o)} busy={busy === o.id} onFollow={() => { remember(); followOrg(o) }} />)}
        </>
      )}
      {people.length > 0 && (
        <>
          <Title>{t('homesearch.people', { count: people.length })}</Title>
          {people.slice(0, 10).map((p) => <PersonRow key={p.id} person={p} query={q} state={personState(p.id)} busy={busy === p.id}
            onFollow={() => { remember(); follow(p.id) }} onUnfollow={() => unfollow(p.id)} />)}
        </>
      )}
    </div>
  )
}
