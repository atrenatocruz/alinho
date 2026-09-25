import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, Users, Clock, GraduationCap, X, MapPin, Lock, Check, Building2, Plus } from 'lucide-react'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { listTeacherProfiles, teacherClubName } from '../lib/teachers'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { followPlayer, removeFollow } from '../lib/follows'
import { Avatar, EmptyState, GroupLevelBadge, OrgKindBadge, orgAvatarShape, PageHeader } from '../components/ui'
import { describeError } from '../lib/errors'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import { semAcentos } from '../lib/semAcentos'

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

/* Três separadores, desde 23 set (desenho `design-handoff/2026-09-23-pagina-do-grupo/`).
   Eram cinco pastilhas — Tudo · Clubes · Grupos · Professores · Os meus —
   por cima de seis linhas. Um filtro que devolve uma linha é pior do que não
   haver filtro: ensina à pessoa que a app está vazia.

   E faltava o principal: a Comunidade respondia a «que organizações existem
   na Alinho?», que não é a pergunta de ninguém. A pergunta é «onde é que eu
   posso jogar?» — e um torneio aberto é a única coisa na app a que alguém de
   fora chega sem pedir licença a ninguém.

   «Os meus» deixa de ser filtro: onde a pessoa já está é o que ela quer ver
   primeiro, não o que ela quer filtrar. Sobe na lista.

   Os três existem SEMPRE, mesmo vazios — um separador que aparece e some
   conforme os dados muda a navegação debaixo dos pés de quem a usa.

   24 set: o «Para jogar» saiu (Francisco: «Comunidade apenas mostra clubes,
   grupos e professores. Mais nada. A Home é que mostra o que há para
   jogar.»). Os torneios abertos continuam na Home. E passam a filtros:
   Todos · Clubes · Grupos · Professores (Francisco, 24 set: «Quero poder ver
   todos ou a cada um em separado. Tipo filtros.»), com as mesmas pastilhas
   dos filtros da Home. */
const TABS = [
  { key: 'all', labelKey: 'comunidade.filter_all' },
  { key: 'clubs', labelKey: 'comunidade.filter_clubs' },
  { key: 'groups', labelKey: 'comunidade.filter_groups' },
  { key: 'teachers', labelKey: 'comunidade.tab_teachers' },
]

// «Contactar» liga ou escreve, conforme o contacto que o professor deixou:
// email → escrever, @conta → Instagram, número → ligar.
const contactHref = (contact) => {
  const c = (contact || '').trim()
  if (!c) return null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return `mailto:${c}`
  if (/^@[\w.]+$/.test(c)) return `https://instagram.com/${c.slice(1)}`
  const digits = c.replace(/\D/g, '')
  if (digits.length >= 9) return `tel:+${digits.length === 9 ? `351${digits}` : digits}`
  return null
}

// A mesma regra de todas as pesquisas de nomes (src/lib/semAcentos.js).
const norm = semAcentos
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'pt')

export default function Comunidade() {
  const { t, i18n } = useTranslation()
  const headerActions = useHeaderActions()
  const { user, memberships, followOrganization } = useAuth()
  const [tab, setTab] = useState('all')
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

  // Clubes e grupos numa lista só: com seis linhas, separar por tipo não
  // ajuda ninguém a encontrar nada. Onde já estás vem primeiro.
  const listedOrgs = (() => {
    const mine = [...myOrgs, ...pendingOrgs.filter((o) => !myOrgIds.has(o.id))].filter(matchesQuery)
    const others = organizations.filter((o) => !myOrgIds.has(o.id) && !pendingOrgs.includes(o)).filter(matchesQuery)
    return [...mine, ...others]
  })()
  const showMineRow = false

  // ── Professores ────────────────────────────────────────────────────────
  const approvedTeachers = teachers
    .filter((teacher) => teacher.user_id !== user.id && teacher.status === 'approved')
    .filter((teacher) => trimmed.length < 2
      || norm(teacher.user?.name).includes(norm(trimmed))
      || norm(teacherClubName(teacher)).includes(norm(trimmed))
      || norm(teacher.zone).includes(norm(trimmed)))
  // A pesquisa procura nos três ao mesmo tempo: é ela que faz o trabalho
  // que as cinco pastilhas estavam a tentar fazer.
  const searching = trimmed.length > 1
  const verTudo = tab === 'all' || searching
  const showTeachers = tab === 'teachers' || verTudo
  const showOrgs = tab === 'clubs' || tab === 'groups' || verTudo
  // «Todos» e a pesquisa mostram os dois tipos; senão, só o do filtro.
  const shownOrgs = verTudo ? listedOrgs : listedOrgs.filter((o) => (o.kind === 'group') === (tab === 'groups'))
  // Quem eu sigo (e pedidos meus por aceitar), para o botão de cada
  // professor dizer o estado certo. As minhas linhas vejo-as sempre (RLS).
  const [myFollows, setMyFollows] = useState({})
  const [followActing, setFollowActing] = useState(null)
  useEffect(() => {
    if (!user?.id) return
    supabase.from('follows').select('id, followed_id, status').eq('follower_id', user.id)
      .then(({ data, error }) => {
        if (error) { console.error('Error loading follows:', error); return }
        setMyFollows(Object.fromEntries((data || []).map((f) => [f.followed_id, f])))
      })
  }, [user?.id])

  const handleTeacherFollow = async (teacher) => {
    setFollowActing(teacher.user_id)
    try {
      const status = await followPlayer(teacher.user_id)
      const { data } = await supabase.from('follows').select('id, followed_id, status')
        .eq('follower_id', user.id).eq('followed_id', teacher.user_id)
      setMyFollows((m) => ({ ...m, [teacher.user_id]: data?.[0] || { status } }))
    } catch (error) {
      console.error('Error following teacher:', error)
      alert(describeError(t, error))
    } finally {
      setFollowActing(null)
    }
  }

  // Deixar de seguir pede confirmação, como no perfil; cancelar um pedido não.
  const handleTeacherUnfollow = async (teacher, confirmar = true) => {
    const follow = myFollows[teacher.user_id]
    if (!follow?.id) return
    if (confirmar && !confirm(t('playerdetails.unfollow_confirm', { name: teacher.user?.name || '' }))) return
    setFollowActing(teacher.user_id)
    try {
      await removeFollow(follow.id)
      setMyFollows((m) => { const n = { ...m }; delete n[teacher.user_id]; return n })
    } catch (error) {
      console.error('Error unfollowing teacher:', error)
      alert(describeError(t, error))
    } finally {
      setFollowActing(null)
    }
  }

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

  // Abre o perfil do professor (aulas, Trello #49).
  // Cartão do professor (desenho aprovado a 24 set, pasta
  // 2026-09-23-pagina-do-grupo, assunto 3): a foto da pessoa, «Professor ·
  // clube» e a zona, e dois botões — «Seguir» (o seguir de pessoas que já
  // existe) e «Contactar». Os horários saíram: são das aulas, escondidas
  // até depois do Smash Cup. Tocar no nome abre o perfil do professor.
  const renderTeacher = (teacher) => {
    const follow = teacher.user_id ? myFollows[teacher.user_id] : null
    const contacto = contactHref(teacher.contact)
    const btn = 'flex-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-full text-sm font-extrabold transition-colors duration-fast disabled:opacity-40'
    return (
      <div key={teacher.id} className="card p-3.5 space-y-3">
        {/* A página de professor só existe quando o clube já o aceitou
            (teacher_profile_active). Com o pedido ao clube por aceitar,
            o nome abre o perfil normal da pessoa (#550 — o Francisco
            caía em «Professor não encontrado»). */}
        <Link
          to={!teacher.organization_id || !teacher.club_status || teacher.club_status === 'accepted'
            ? `/professor/${teacher.id}`
            : `/jogador/${teacher.user_id}`}
          className="flex items-center gap-3"
        >
          <Avatar name={teacher.user?.name} url={teacher.user?.avatar_url} size="w-12 h-12 text-base" />
          <div className="flex-1 min-w-0">
            <h3 className="font-extrabold text-ink-900 truncate">{teacher.user?.name}</h3>
            <p className="text-xs text-muted truncate">
              {t('comunidade.teacher_label')} · {teacherClubName(teacher) || t('comunidade.teacher_no_club')}
            </p>
            {teacher.zone && <p className="text-xs text-muted truncate">{teacher.zone}</p>}
          </div>
        </Link>
        <div className="flex gap-2">
          {teacher.user_id && (
            follow?.status === 'accepted' ? (
              <button type="button" disabled={followActing === teacher.user_id}
                onClick={() => handleTeacherUnfollow(teacher)}
                className={`${btn} border border-line bg-canvas text-ink-900`}>
                <Check size={15} /> {t('playerdetails.following_button')}
              </button>
            ) : follow?.status === 'pending' ? (
              <button type="button" disabled={followActing === teacher.user_id}
                onClick={() => handleTeacherUnfollow(teacher, false)}
                className={`${btn} border border-line bg-canvas text-muted`}>
                <Clock size={15} /> {t('playerdetails.requested_button')}
              </button>
            ) : (
              <button type="button" disabled={followActing === teacher.user_id}
                onClick={() => handleTeacherFollow(teacher)}
                className={`${btn} bg-ink-900 text-white`}>
                <Plus size={15} /> {t('playerdetails.follow_button')}
              </button>
            )
          )}
          {contacto && (
            <a href={contacto} target={contacto.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
              className={`${btn} border border-line bg-canvas text-ink-900`}>
              {t('comunidade.contact_button')}
            </a>
          )}
        </div>
      </div>
    )
  }


  const busy = loading || (showTeachers && teachersLoading)
  const nothing = !busy
    && (!showOrgs || shownOrgs.length === 0)
    && (!showTeachers || approvedTeachers.length === 0)

  return (
    <div className="space-y-4">
      <PageHeader title={t('comunidade.title')}>{headerActions}</PageHeader>

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

      {/* Filtros, com as pastilhas dos filtros da Home. Existem sempre,
          mesmo vazios. Com a pesquisa a funcionar em cima, o filtro deixa de
          mandar e mostram-se os resultados de tudo. */}
      {!searching && (
        <div className="flex flex-wrap gap-2">
          {TABS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setTab(f.key)}
              className={`inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-full text-sm font-extrabold border transition-colors duration-fast ${
                tab === f.key ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line'
              }`}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      )}

      {busy ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : nothing ? (
        <EmptyState
          icon={tab === 'teachers' ? GraduationCap : Users}
          title={t('comunidade.nothing_found_title')}
          subtitle={searching ? t('comunidade.try_another_name') : t('comunidade.no_clubs_subtitle')}
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

          {showOrgs && shownOrgs.length > 0 && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">
                {searching
                  ? t('comunidade.results_count', { count: shownOrgs.length + (showTeachers ? approvedTeachers.length : 0) })
                  : t({ clubs: 'comunidade.filter_clubs', groups: 'comunidade.filter_groups' }[tab] || 'comunidade.tab_orgs')}
              </p>
              <div className="grid grid-cols-2 gap-3">{shownOrgs.map(renderOrgCard)}</div>
            </section>
          )}

          {showTeachers && approvedTeachers.length > 0 && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">{t('comunidade.tab_teachers')}</p>
              <div className="space-y-3">{approvedTeachers.map(renderTeacher)}</div>
            </section>
          )}
        </>
      )}

    </div>
  )
}
