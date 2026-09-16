import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, Users, Clock, GraduationCap, X, MapPin, Lock, Check, Building2 } from 'lucide-react'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { DAY_LABEL_KEY, listTeacherProfiles } from '../lib/teachers'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState, GroupLevelBadge, OrgKindBadge, orgAvatarShape } from '../components/ui'
import { describeError } from '../lib/errors'

/* ─── Comunidade (épico «Comunidade vs. Rankings», Trello #271/#273) ─────────
   Encontrar clubes, grupos e professores — e só isso. Desenho:
   https://claude.ai/artifact/LmwwNPxxnNRttG1RbHdDCt
   - Sem abas: uma pesquisa + filtros em pastilhas (mesma lógica da Home).
   - Os teus primeiro. Jogadores saíram daqui: procuram-se nos Rankings.
   - Um cartão por clube/grupo: logótipo em cima (quadrado = clube, redondo =
     grupo), dados, e um só botão em baixo. Sair e favorito vivem na página
     do clube.
   - "O meu grupo" e "Criar grupo" estão no Gerir; "Quero dar aulas" no
     Perfil.
   - Ainda não: "Perto de mim" (depende da localização da Home) e seguir sem
     ser membro (#277) — até lá "Que sigo" = onde és membro ou pediste para
     entrar. */

const FILTERS = [
  { key: 'all', labelKey: 'comunidade.filter_all' },
  { key: 'club', labelKey: 'comunidade.filter_clubs' },
  { key: 'group', labelKey: 'comunidade.filter_groups' },
  { key: 'teachers', labelKey: 'comunidade.filter_teachers' },
  { key: 'mine', labelKey: 'comunidade.filter_mine' },
]

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'pt')

export default function Comunidade() {
  const { t } = useTranslation()
  const { user, memberships, followOrganization } = useAuth()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)
  const timeoutRef = useRef(null)

  const [teachers, setTeachers] = useState([])
  const [teachersLoading, setTeachersLoading] = useState(true)
  const trimmed = query.trim()

  const reloadOrganizations = async () => {
    try {
      setOrganizations(trimmed.length > 1 ? await searchOrganizations(trimmed) : await listGlobalOrganizations())
    } catch (error) {
      console.error('Error reloading organizations:', error)
    }
  }

  useEffect(() => {
    // 1 letra: nem pesquisa nem lista vazia — deixa ficar o que está.
    if (trimmed.length === 1) return
    setLoading(true)
    if (trimmed.length === 0) {
      listGlobalOrganizations()
        .then(setOrganizations)
        .catch((error) => console.error('Error loading comunidade:', error))
        .finally(() => setLoading(false))
      return
    }
    timeoutRef.current = setTimeout(async () => {
      try {
        setOrganizations(await searchOrganizations(trimmed))
      } catch (error) {
        console.error('Error searching comunidade:', error)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [trimmed])

  const loadTeachers = async () => {
    setTeachersLoading(true)
    try {
      setTeachers(await listTeacherProfiles())
    } catch (error) {
      console.error('Error loading teacher profiles:', error)
    } finally {
      setTeachersLoading(false)
    }
  }

  useEffect(() => {
    loadTeachers()
  }, [])

  // ── Clubes e grupos ────────────────────────────────────────────────────
  // Os meus vêm das memberships (incluem os que não aparecem na pesquisa);
  // quando o diretório os traz, usa-se essa linha, que tem nº de membros e
  // nível médio.
  const directoryById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations])
  const myOrgs = useMemo(() => memberships
    .map((m) => m.organization)
    .filter(Boolean)
    .map((o) => directoryById.get(o.id) || { ...o, my_status: 'member' })
    .sort(byName), [memberships, directoryById])
  const myOrgIds = new Set(myOrgs.map((o) => o.id))
  const pendingOrgs = organizations.filter((o) => o.my_status === 'pending')

  const matchesQuery = (o) => trimmed.length < 2 || norm(o.name).includes(norm(trimmed))
  const kindFilter = (o) => filter === 'all' || filter === 'mine' || o.kind === filter

  // Com pesquisa ou filtro de tipo: os teus primeiro, depois os outros, tudo
  // na mesma grelha. Sem pesquisa em "Tudo": os teus numa fila em cima.
  const listedOrgs = (() => {
    if (filter === 'teachers') return []
    if (filter === 'mine') return [...myOrgs, ...pendingOrgs.filter((o) => !myOrgIds.has(o.id))].filter(matchesQuery)
    const mine = myOrgs.filter(kindFilter).filter(matchesQuery)
    const others = organizations.filter((o) => !myOrgIds.has(o.id)).filter(kindFilter)
    if (filter === 'all' && trimmed.length < 2) return others
    return [...mine, ...others]
  })()
  const showMineRow = filter === 'all' && trimmed.length < 2 && myOrgs.length > 0

  // ── Professores ────────────────────────────────────────────────────────
  const approvedTeachers = teachers
    .filter((teacher) => teacher.user_id !== user.id && teacher.status === 'approved')
    .filter((teacher) => trimmed.length < 2
      || norm(teacher.user?.name).includes(norm(trimmed))
      || norm(teacher.organization?.name).includes(norm(trimmed))
      || norm(teacher.zone).includes(norm(trimmed)))
  const showTeachers = filter === 'all' || filter === 'teachers'
  const handleFollow = async (org) => {
    setActingOn(org.id)
    try {
      const { error } = await followOrganization(org.id)
      if (error) throw error
      await reloadOrganizations()
    } catch (error) {
      console.error('Error following organization:', error)
      alert(describeError(t, error, 'comunidade.follow_failed'))
    } finally {
      setActingOn(null)
    }
  }

  // ── Cartão de clube/grupo ──────────────────────────────────────────────
  const renderOrgCard = (org) => {
    const status = myOrgIds.has(org.id) ? 'member' : org.my_status
    // Grupo dentro de um clube: entra-se sempre por pedido (follow_organization).
    const joinsDirectly = org.open_join && !org.parent_organization_id
    return (
      <Link
        key={org.id}
        to={`/clube/${org.slug}`}
        className="card press p-3.5 flex flex-col gap-2 min-w-0 hover:shadow-lift"
      >
        <div className="flex items-start justify-between gap-2">
          <Avatar name={org.name} url={org.group_logo_url} size="w-12 h-12 text-base" shape={orgAvatarShape(org.kind)} />
          {org.open_join === false && (
            <span className="w-7 h-7 rounded-full bg-ink-50 text-muted flex items-center justify-center shrink-0" title={t('comunidade.closed_aria')}>
              <Lock size={13} aria-label={t('comunidade.closed_aria')} />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-extrabold text-ink-900 text-[15px] leading-tight line-clamp-2 break-words">{org.name}</h3>
          <div className="mt-1.5"><OrgKindBadge kind={org.kind} /></div>
        </div>
        <div className="space-y-1 text-xs text-muted min-w-0">
          {org.parent_name && (
            <p className="flex items-center gap-1.5 min-w-0">
              <Building2 size={12} className="shrink-0" />
              <span className="truncate">{t('comunidade.group_of', { club: org.parent_name })}</span>
            </p>
          )}
          {org.member_count != null && (
            <p className="flex items-center gap-1.5">
              <Users size={12} className="shrink-0" /> {t('comunidade.member_count', { count: org.member_count })}
            </p>
          )}
          {org.location && (
            <p className="flex items-center gap-1.5 min-w-0">
              <MapPin size={12} className="shrink-0" /> <span className="truncate">{org.location}</span>
            </p>
          )}
          {org.avg_rating != null && (
            <p className="flex items-center gap-1.5">
              {t('comunidade.avg_level')} <GroupLevelBadge rating={org.avg_rating} />
            </p>
          )}
        </div>

        <div className="mt-auto pt-1">
          {status === 'member' ? (
            <span className="w-full inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-full bg-ok/10 text-ok text-xs font-extrabold">
              <Check size={14} /> {t('comunidade.member_label')}
            </span>
          ) : status === 'pending' ? (
            <span className="w-full inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-full bg-ink-50 text-muted text-xs font-extrabold">
              <Clock size={14} /> {t('comunidade.request_sent')}
            </span>
          ) : (
            <button
              onClick={(e) => { e.preventDefault(); handleFollow(org) }}
              disabled={actingOn === org.id}
              className={`w-full inline-flex items-center justify-center min-h-[40px] rounded-full text-xs font-extrabold transition-colors duration-fast disabled:opacity-40 ${
                joinsDirectly
                  ? 'bg-lime-400 text-ink-900 hover:bg-lime-600'
                  : 'bg-canvas text-ink-900 border border-ink-900 hover:bg-ink-50'
              }`}
            >
              {joinsDirectly ? t('comunidade.join_action') : t('comunidade.request_entry_action')}
            </button>
          )}
        </div>
      </Link>
    )
  }

  const renderTeacher = (teacher) => (
    <div key={teacher.id} className="card p-3.5 space-y-2">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center shrink-0">
          <GraduationCap size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-ink-900 truncate">{teacher.user?.name}</h3>
          <p className="text-xs text-muted truncate">
            {t('comunidade.teacher_label')} · {teacher.organization?.name || t('comunidade.teacher_no_club')}{teacher.zone ? ` · ${teacher.zone}` : ''}
          </p>
        </div>
      </div>
      {teacher.availability?.length > 0 && (
        <p className="text-xs text-muted">
          {teacher.availability
            .map((a) => `${t(DAY_LABEL_KEY[a.day_of_week])} ${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)}`)
            .join(' · ')}
        </p>
      )}
      <p className="text-sm text-ink-900">{teacher.contact}</p>
    </div>
  )

  const busy = loading || (filter === 'teachers' && teachersLoading)
  const nothing = !busy && listedOrgs.length === 0 && !showMineRow && (!showTeachers || approvedTeachers.length === 0)

  return (
    <div className="space-y-4">
      <h2 className="text-3xl text-ink-900">{t('comunidade.title')}</h2>

      <div className="flex items-center gap-2 input-field focus-within:border-ink-500 focus-within:ring-2 focus-within:ring-ink-50">
        <Search size={16} className="text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder={t('comunidade.search_placeholder_orgs')}
          className="flex-1 min-w-0 bg-transparent outline-none text-base"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label={t('ui.close')} className="text-muted shrink-0">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Todas à vista, sem deslizar: passam para a linha de baixo. */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center px-3 min-h-[36px] rounded-full text-[13px] font-extrabold border whitespace-nowrap transition-colors duration-fast ${
              filter === f.key ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line'
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {busy ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : nothing ? (
        <EmptyState
          icon={filter === 'teachers' ? GraduationCap : Users}
          title={t('comunidade.nothing_found_title')}
          subtitle={trimmed ? t('comunidade.try_another_name') : filter === 'mine' ? t('comunidade.no_mine_subtitle') : t('comunidade.no_clubs_subtitle')}
        />
      ) : (
        <>
          {showMineRow && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">{t('comunidade.mine_heading')}</p>
              <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                {myOrgs.map((org) => (
                  <Link key={org.id} to={`/clube/${org.slug}`} className="w-[72px] shrink-0 flex flex-col items-center gap-1.5 text-center">
                    <Avatar name={org.name} url={org.group_logo_url} size="w-14 h-14 text-lg" shape={orgAvatarShape(org.kind)} />
                    <span className="text-[11px] font-extrabold text-ink-900 leading-tight line-clamp-2 break-words">{org.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {listedOrgs.length > 0 && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">
                {trimmed.length > 1
                  ? t('comunidade.results_count', { count: listedOrgs.length + (showTeachers ? approvedTeachers.length : 0) })
                  : filter === 'mine' ? t('comunidade.filter_mine')
                  : filter === 'club' ? t('comunidade.filter_clubs')
                  : filter === 'group' ? t('comunidade.filter_groups')
                  : t('comunidade.others_heading')}
              </p>
              <div className="grid grid-cols-2 gap-3">{listedOrgs.map(renderOrgCard)}</div>
            </section>
          )}

          {showTeachers && approvedTeachers.length > 0 && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">{t('comunidade.filter_teachers')}</p>
              <div className="space-y-3">{approvedTeachers.map(renderTeacher)}</div>
            </section>
          )}
        </>
      )}

    </div>
  )
}
