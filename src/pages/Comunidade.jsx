import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, Users, Clock, GraduationCap, X, MapPin, Lock, Check, Building2, Trophy, ChevronRight } from 'lucide-react'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { DAY_LABEL_KEY, listTeacherProfiles, teacherClubName } from '../lib/teachers'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState, GroupLevelBadge, OrgKindBadge, orgAvatarShape, PageHeader } from '../components/ui'
import { describeError, errorKind } from '../lib/errors'
import { listOpenTournaments } from '../lib/tournamentApi'
import { useHeaderActions } from '../contexts/HeaderActionsContext'

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
   conforme os dados muda a navegação debaixo dos pés de quem a usa. */
const TABS = [
  { key: 'play', labelKey: 'comunidade.tab_play' },
  { key: 'orgs', labelKey: 'comunidade.tab_orgs' },
  { key: 'teachers', labelKey: 'comunidade.tab_teachers' },
]

/** «9–11 out» quando é tudo no mesmo mês, «30 set – 2 out» quando não é.
 *  A mesma regra da página do torneio, para as datas se lerem igual nos dois
 *  sítios. */
function tournamentWhen(x, t, locale) {
  if (!x?.starts_on) return ''
  const a = new Date(`${x.starts_on}T12:00`)
  const b = x.ends_on ? new Date(`${x.ends_on}T12:00`) : a
  const month = (d) => d.toLocaleDateString(locale, { month: 'short' }).replace('.', '')
  if (a.getTime() === b.getTime()) return `${a.getDate()} ${month(a)}`
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${month(b)}`
  return `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`
}

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'pt')

export default function Comunidade() {
  const { t, i18n } = useTranslation()
  const headerActions = useHeaderActions()
  const { user, memberships, followOrganization } = useAuth()
  const [tab, setTab] = useState('play')
  const [tournaments, setTournaments] = useState([])
  const [tournamentsLoading, setTournamentsLoading] = useState(true)
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
  const showTeachers = tab === 'teachers' || searching
  const showOrgs = tab === 'orgs' || searching
  const showPlay = tab === 'play' || searching
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
  const renderTeacher = (teacher) => (
    <Link key={teacher.id} to={`/professor/${teacher.id}`} className="card press block p-3.5 space-y-2">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center shrink-0">
          <GraduationCap size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-ink-900 truncate">{teacher.user?.name}</h3>
          <p className="text-xs text-muted truncate">
            {t('comunidade.teacher_label')} · {teacherClubName(teacher) || t('comunidade.teacher_no_club')}{teacher.zone ? ` · ${teacher.zone}` : ''}
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
    </Link>
  )

  // Os torneios com inscrições abertas. Abre sem conta, por isso não espera
  // por sessão nenhuma. Enquanto a migração do «#462» não correr, a função
  // não existe e isto fica vazio — a página não rebenta nem mostra erro.
  useEffect(() => {
    let alive = true
    listOpenTournaments({ limit: 20 })
      .then((rows) => { if (alive) setTournaments(rows) })
      .catch((error) => {
        if (errorKind(error) !== 'not_ready') console.error('Error loading open tournaments:', error)
        if (alive) setTournaments([])
      })
      .finally(() => { if (alive) setTournamentsLoading(false) })
    return () => { alive = false }
  }, [])

  const listedTournaments = tournaments.filter((x) => trimmed.length < 2
    || norm(x.name).includes(norm(trimmed))
    || norm(x.club_name).includes(norm(trimmed))
    || norm(x.location).includes(norm(trimmed)))

  /* A linha de um torneio aberto. É a coisa mais importante que a app tem
     para oferecer nas próximas semanas, por isso é a primeira do separador.

     `spots_left` a null quer dizer SEM LIMITE de vagas, não zero — um
     `if (!spots_left)` escondia torneios abertos. E `days_to_deadline` já
     vem arredondado para cima: hoje ao fim do dia dá 1, e ninguém percebe
     «fecha em 0 dias». */
  const renderTournament = (x) => (
    <Link key={x.id} to={`/torneio/${x.slug || x.id}`}
      className="flex items-center gap-3 rounded-card border border-line bg-canvas p-3 hover:bg-ink-50/40">
      <Avatar name={x.club_name} url={x.club_logo_url} size="w-11 h-11 text-sm" shape="rounded-xl" />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] text-ink-900">{x.name}</b>
        <span className="block truncate text-[12px] text-muted">
          {[x.club_name || x.location, tournamentWhen(x, t, i18n.language)].filter(Boolean).join(' · ')}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-ink-900 px-2 py-[2px] text-[10px] font-bold text-white">{t('comunidade.tournament_tag')}</span>
          {x.categories_open > 0 && (
            <span className="text-[11px] text-muted">{t('comunidade.tournament_categories', { count: x.categories_open })}</span>
          )}
          {Number.isFinite(x.days_to_deadline) && x.days_to_deadline >= 0 && (
            <span className="text-[11px] font-semibold text-ink-700">{t('comunidade.tournament_deadline', { count: x.days_to_deadline })}</span>
          )}
          {x.spots_left != null && x.spots_left <= 6 && (
            <span className="text-[11px] font-semibold text-ink-700">{t('comunidade.tournament_spots', { count: x.spots_left })}</span>
          )}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </Link>
  )

  const busy = loading || ((tab === 'teachers' || searching) && teachersLoading) || ((tab === 'play' || searching) && tournamentsLoading)
  const nothing = !busy
    && (!showPlay || listedTournaments.length === 0)
    && (!showOrgs || listedOrgs.length === 0)
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

      {/* Três, larguras iguais, e existem sempre — mesmo vazios. Com a
          pesquisa a funcionar em cima, o separador escolhido deixa de mandar
          e mostram-se os resultados dos três. */}
      {!searching && (
        <div className="grid grid-cols-3 gap-1.5">
          {TABS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setTab(f.key)}
              className={`inline-flex items-center justify-center truncate px-3 min-h-[36px] rounded-full text-[13px] font-extrabold border transition-colors duration-fast ${
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
        /* O vazio fala do separador onde se está. Dizer «ainda não há clubes
           ou grupos» a quem abriu «Para jogar» é responder a outra pergunta. */
        <EmptyState
          icon={tab === 'teachers' ? GraduationCap : tab === 'play' ? Trophy : Users}
          title={searching || tab !== 'play' ? t('comunidade.nothing_found_title') : t('comunidade.play_empty_title')}
          subtitle={searching ? t('comunidade.try_another_name')
            : tab === 'play' ? t('comunidade.play_empty_subtitle')
            : t('comunidade.no_clubs_subtitle')}
        />
      ) : (
        <>
          {/* Para jogar: o que está aberto a quem quiser entrar. Vem primeiro
              porque é a resposta à pergunta com que as pessoas entram aqui. */}
          {showPlay && listedTournaments.length > 0 && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">{t('comunidade.tab_play')}</p>
              <div className="space-y-2">{listedTournaments.map(renderTournament)}</div>
              {!searching && (
                <p className="mt-2 text-[11.5px] text-muted">{t('comunidade.play_note')}</p>
              )}
            </section>
          )}

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

          {showOrgs && listedOrgs.length > 0 && (
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">
                {searching
                  ? t('comunidade.results_count', { count: listedOrgs.length + (showTeachers ? approvedTeachers.length : 0) })
                  : t('comunidade.tab_orgs')}
              </p>
              <div className="grid grid-cols-2 gap-3">{listedOrgs.map(renderOrgCard)}</div>
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
